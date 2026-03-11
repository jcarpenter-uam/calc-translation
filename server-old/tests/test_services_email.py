from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from services import email


class FakeMsalApp:
    def __init__(self, silent=None, client=None):
        self.silent = silent
        self.client = client

    def acquire_token_silent(self, scope, account=None):
        return self.silent

    def acquire_token_for_client(self, scopes):
        return self.client or {}


class FakeResp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class FakeHttpClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def post(self, endpoint, json=None, headers=None):
        self.calls.append((endpoint, json, headers))
        if self.responses:
            return self.responses.pop(0)
        return FakeResp(500, "no response")


@pytest.fixture
def svc(monkeypatch):
    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(email.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(email.msal, "ConfidentialClientApplication", lambda *a, **k: FakeMsalApp())
    return email.EmailService()


def test_get_access_token_silent(svc):
    svc.app = FakeMsalApp(silent={"access_token": "tok"})
    assert svc._get_access_token() == "tok"


def test_get_access_token_fallback(svc):
    svc.app = FakeMsalApp(silent=None, client={"access_token": "tok2"})
    assert svc._get_access_token() == "tok2"


def test_get_access_token_failure_raises(svc):
    svc.app = FakeMsalApp(silent=None, client={"error": "x", "error_description": "y"})
    with pytest.raises(Exception):
        svc._get_access_token()


@pytest.mark.asyncio
async def test_read_text_and_binary(svc, tmp_path):
    t = tmp_path / "a.txt"
    b = tmp_path / "a.bin"
    t.write_text("hello", encoding="utf-8")
    b.write_bytes(b"abc")

    assert await svc._read_text_file(str(t)) == "hello"
    assert await svc._read_binary_file(str(b)) == b"abc"


@pytest.mark.asyncio
async def test_send_graph_email_success_with_attachment(monkeypatch, svc, tmp_path):
    attachment = tmp_path / "t.vtt"
    attachment.write_text("WEBVTT", encoding="utf-8")

    fake_http = FakeHttpClient([FakeResp(202)])
    monkeypatch.setattr(email, "get_http_client", lambda: fake_http)

    ok = await svc._send_graph_email(
        to_email="a@example.com",
        token="tok",
        subject="Subj",
        body_html="<p>x</p>",
        attachment_path=str(attachment),
        attachment_name="t.vtt",
    )

    assert ok is True
    payload = fake_http.calls[0][1]
    assert payload["message"]["attachments"][0]["name"] == "t.vtt"


@pytest.mark.asyncio
async def test_send_graph_email_handles_non_202(monkeypatch, svc):
    fake_http = FakeHttpClient([FakeResp(400, "bad")])
    monkeypatch.setattr(email, "get_http_client", lambda: fake_http)

    ok = await svc._send_graph_email("a@example.com", "tok", "s", "b")
    assert ok is False


@pytest.mark.asyncio
async def test_send_graph_email_attachment_read_error_still_posts(monkeypatch, svc, tmp_path):
    attachment = tmp_path / "t.vtt"
    attachment.write_text("WEBVTT", encoding="utf-8")
    fake_http = FakeHttpClient([FakeResp(202)])
    monkeypatch.setattr(email, "get_http_client", lambda: fake_http)

    async def bad_read(_path):
        raise RuntimeError("cannot read")

    monkeypatch.setattr(svc, "_read_binary_file", bad_read)
    ok = await svc._send_graph_email(
        "a@example.com", "tok", "s", "b", str(attachment), "t.vtt"
    )
    assert ok is True
    assert "attachments" not in fake_http.calls[0][1]["message"]


@pytest.mark.asyncio
async def test_send_graph_email_client_exception_returns_false(monkeypatch, svc):
    class BrokenClient:
        async def post(self, *args, **kwargs):
            raise RuntimeError("http down")

    monkeypatch.setattr(email, "get_http_client", lambda: BrokenClient())
    ok = await svc._send_graph_email("a@example.com", "tok", "s", "b")
    assert ok is False


@pytest.mark.asyncio
async def test_send_session_transcripts_no_attendees_returns(svc):
    await svc.send_session_transcripts("s1", "zoom", [])


@pytest.mark.asyncio
async def test_send_session_transcripts_token_failure(monkeypatch, svc):
    monkeypatch.setattr(svc, "_get_access_token", lambda: (_ for _ in ()).throw(RuntimeError("no token")))
    await svc.send_session_transcripts("s1", "zoom", [{"id": "u1", "email": "a@example.com", "language_code": "en"}])


@pytest.mark.asyncio
async def test_send_session_transcripts_happy_path(monkeypatch, svc, tmp_path):
    monkeypatch.chdir(tmp_path)

    out_dir = tmp_path / "output" / "zoom" / "s1"
    out_dir.mkdir(parents=True)
    (out_dir / "transcript_en.vtt").write_text("WEBVTT", encoding="utf-8")
    (out_dir / "summary_en.txt").write_text("Summary line", encoding="utf-8")

    monkeypatch.setattr(svc, "_get_access_token", lambda: "tok")
    monkeypatch.setattr(email, "generate_review_token", lambda user_id, session_id: "review-token")

    sent = []

    async def fake_send(to_email, token, subject, body_html, attachment_path=None, attachment_name=None):
        sent.append((to_email, token, subject, body_html, attachment_name))
        return True

    monkeypatch.setattr(svc, "_send_graph_email", fake_send)

    attendees = [{"id": "u1", "email": "a@example.com", "language_code": "en"}]
    await svc.send_session_transcripts(
        session_id="s1",
        integration="zoom",
        attendees=attendees,
        topic="Team Sync",
        meeting_start_time=datetime(2026, 1, 1, 15, 30),
    )

    assert len(sent) == 1
    assert sent[0][0] == "a@example.com"
    assert "Team Sync" in sent[0][2]
    assert "review?token=" in sent[0][3]
    assert sent[0][4] == "transcript_en.vtt"


@pytest.mark.asyncio
async def test_send_session_transcripts_no_topic_skip_missing_email_and_summary_read_error(
    monkeypatch, svc, tmp_path
):
    monkeypatch.chdir(tmp_path)
    out_dir = tmp_path / "output" / "standalone" / "s1"
    out_dir.mkdir(parents=True)
    (out_dir / "transcript_two_way.vtt").write_text("WEBVTT", encoding="utf-8")
    (out_dir / "summary_two_way.txt").write_text("Summary", encoding="utf-8")

    monkeypatch.setattr(svc, "_get_access_token", lambda: "tok")
    monkeypatch.setattr(email, "generate_review_token", lambda user_id, session_id: "review-token")

    async def bad_read(_path):
        raise RuntimeError("no read")

    monkeypatch.setattr(svc, "_read_text_file", bad_read)
    sent = []

    async def fake_send(to_email, token, subject, body_html, attachment_path=None, attachment_name=None):
        sent.append((to_email, subject, body_html, attachment_name))
        return True

    monkeypatch.setattr(svc, "_send_graph_email", fake_send)
    attendees = [
        {"id": "u-missing", "email": "", "language_code": "es"},
        {"id": None, "email": "a@example.com", "language_code": "es"},
    ]
    await svc.send_session_transcripts(
        session_id="s1",
        integration="standalone",
        attendees=attendees,
        topic=None,
        is_two_way_standalone=True,
    )

    assert len(sent) == 1
    assert "Summary & Transcript: Standalone - " in sent[0][1]
    assert "No summary available" in sent[0][2]
    assert "review?token=" not in sent[0][2]
    assert sent[0][3] == "transcript_two_way.vtt"


@pytest.mark.asyncio
async def test_send_session_transcripts_skips_when_no_transcript(monkeypatch, svc, tmp_path):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "output" / "zoom" / "s1").mkdir(parents=True)

    monkeypatch.setattr(svc, "_get_access_token", lambda: "tok")

    sent = []

    async def fake_send(*args, **kwargs):
        sent.append(1)
        return True

    monkeypatch.setattr(svc, "_send_graph_email", fake_send)

    attendees = [{"id": "u1", "email": "a@example.com", "language_code": "en"}]
    await svc.send_session_transcripts("s1", "zoom", attendees)

    assert sent == []
