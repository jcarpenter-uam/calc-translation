from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import summary
from tests.helpers import FakeResult, fake_session_local


class FakeOllamaClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def chat(self, model, messages):
        return {"message": {"content": f"summary:{model}:{len(messages)}"}}


@pytest.fixture
def summary_service(monkeypatch):
    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(summary.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(summary.ollama, "AsyncClient", FakeOllamaClient)
    svc = summary.SummaryService()
    return svc


def test_summary_service_init_with_api_key(monkeypatch):
    monkeypatch.setattr(summary.settings, "OLLAMA_API_KEY", " key ")
    monkeypatch.setattr(summary.settings, "OLLAMA_BASE_URL", "http://ollama")
    monkeypatch.setattr(summary.settings, "OLLAMA_MODEL", "model-x")
    captured = {}

    class CaptureClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def chat(self, model, messages):
            return {"message": {"content": "ok"}}

    monkeypatch.setattr(summary.ollama, "AsyncClient", CaptureClient)
    svc = summary.SummaryService()
    assert "headers" in captured
    assert "Authorization" in captured["headers"]
    assert svc.model == "model-x"


@pytest.mark.asyncio
async def test_read_and_write_text_file(summary_service, tmp_path):
    p = tmp_path / "a.txt"
    await summary_service._write_text_file(str(p), "hello")
    assert await summary_service._read_text_file(str(p)) == "hello"


def test_clean_vtt_content_formats_lines(summary_service):
    raw = """WEBVTT

1
00:00:01.000 --> 00:00:02.000
Alice: Hello

2
00:00:02.000 --> 00:00:03.000
World
"""
    out = summary_service._clean_vtt_content(raw)
    assert "*00:00:01* - **Alice:** Hello" in out
    assert "*00:00:02* - World" in out


def test_clean_vtt_content_handles_bad_timestamp(summary_service):
    raw = "WEBVTT\nbad --> timestamp\nAlice: Hi\n"
    out = summary_service._clean_vtt_content(raw)
    assert "**Alice:** Hi" in out


def test_clean_vtt_content_timestamp_parse_exception_branch(summary_service):
    class BadStr(str):
        def split(self, *args, **kwargs):
            raise ValueError("bad split")

        def strip(self):
            return self

    class WeirdContent:
        def splitlines(self):
            return [BadStr("00:00:01.000 --> 00:00:02.000"), "Alice: Hi"]

    out = summary_service._clean_vtt_content(WeirdContent())
    assert "**Alice:** Hi" in out


@pytest.mark.asyncio
async def test_generate_single_summary_success(monkeypatch, summary_service, tmp_path):
    writes = {}

    async def fake_write(path, content):
        writes[path] = content

    summary_service._write_text_file = fake_write
    monkeypatch.setattr(summary, "AsyncSessionLocal", fake_session_local(FakeResult()))

    ok = await summary_service._generate_single_summary("text", "en", str(tmp_path), "s1")

    assert ok is True
    assert any("summary_en.txt" in k for k in writes)


@pytest.mark.asyncio
async def test_generate_single_summary_failure(monkeypatch, summary_service):
    async def bad_chat(model, messages):
        raise RuntimeError("ollama down")

    summary_service.client.chat = bad_chat
    ok = await summary_service._generate_single_summary("text", "en", "/tmp", "s1")

    assert ok is False


@pytest.mark.asyncio
async def test_generate_summaries_no_attendees(monkeypatch, summary_service):
    monkeypatch.setattr(
        summary,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=SimpleNamespace(attendees=[]))),
    )

    await summary_service.generate_summaries_for_attendees("s1", "zoom")


@pytest.mark.asyncio
async def test_generate_summaries_no_source_transcript(monkeypatch, summary_service, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        summary,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(scalar=SimpleNamespace(attendees=["u1"], platform="zoom", translation_type="one_way")),
            FakeResult(all_rows=[SimpleNamespace(email="a@example.com", language_code="es")]),
        ),
    )

    await summary_service.generate_summaries_for_attendees("s1", "zoom")


@pytest.mark.asyncio
async def test_generate_summaries_happy_path(monkeypatch, summary_service, tmp_path):
    monkeypatch.chdir(tmp_path)
    out_dir = tmp_path / "output" / "zoom" / "s1"
    out_dir.mkdir(parents=True)
    (out_dir / "transcript_en.vtt").write_text("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nA: hi\n", encoding="utf-8")

    monkeypatch.setattr(
        summary,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(scalar=SimpleNamespace(attendees=["u1", "u2"], platform="zoom", translation_type="one_way")),
            FakeResult(all_rows=[SimpleNamespace(email="a@example.com", language_code="es"), SimpleNamespace(email="b@example.com", language_code=None)]),
        ),
    )

    called = []

    async def fake_generate(source_text, lang, output_dir, session_id):
        called.append((lang, session_id, output_dir))
        return True

    monkeypatch.setattr(summary_service, "_generate_single_summary", fake_generate)

    await summary_service.generate_summaries_for_attendees("s1", "zoom")

    langs = {c[0] for c in called}
    assert langs == {"en", "es"}


@pytest.mark.asyncio
async def test_generate_summaries_empty_after_cleaning(monkeypatch, summary_service, tmp_path):
    monkeypatch.chdir(tmp_path)
    out_dir = tmp_path / "output" / "zoom" / "s1"
    out_dir.mkdir(parents=True)
    (out_dir / "transcript_en.vtt").write_text("WEBVTT\n", encoding="utf-8")
    monkeypatch.setattr(
        summary,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(scalar=SimpleNamespace(attendees=["u1"], platform="zoom", translation_type="one_way")),
            FakeResult(all_rows=[SimpleNamespace(email="a@example.com", language_code="en")]),
        ),
    )
    monkeypatch.setattr(summary_service, "_clean_vtt_content", lambda _raw: "")
    await summary_service.generate_summaries_for_attendees("s1", "zoom")


@pytest.mark.asyncio
async def test_generate_summaries_top_level_error_is_caught(monkeypatch, summary_service):
    class BadSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(summary, "AsyncSessionLocal", lambda: BadSession())
    await summary_service.generate_summaries_for_attendees("s1", "zoom")
