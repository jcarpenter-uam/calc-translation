from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api import sessions
from tests.helpers import FakeResult, fake_session_local


def _endpoint(path: str):
    router = sessions.create_sessions_router()
    return next(r.endpoint for r in router.routes if r.path == path)


@pytest.mark.asyncio
async def test_download_rejects_user_mismatch():
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            integration="zoom",
            session_id="s1",
            language="en",
            user_payload={"sub": "u1"},
            token_payload={"user_id": "u2", "session_id": "s1"},
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_download_rejects_session_mismatch():
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            integration="zoom",
            session_id="s1",
            language="en",
            user_payload={"sub": "u1"},
            token_payload={"user_id": "u1", "session_id": "other"},
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_download_returns_404_when_transcript_not_found(monkeypatch, tmp_path):
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(readable_id=None, platform="zoom", translation_type="one_way", started_at=None, meeting_time=None)),
        FakeResult(first_row=None),
    )
    monkeypatch.setattr(sessions, "AsyncSessionLocal", fake_local)
    monkeypatch.setattr(sessions, "OUTPUT_DIR", str(tmp_path))

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            integration="zoom",
            session_id="s1",
            language="en",
            user_payload={"sub": "u1"},
            token_payload={"user_id": "u1", "session_id": "s1"},
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_download_returns_404_when_file_missing(monkeypatch, tmp_path):
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(readable_id=None, platform="zoom", translation_type="one_way", started_at=datetime(2025, 1, 2), meeting_time=None)),
        FakeResult(first_row=SimpleNamespace(file_name="missing.vtt")),
    )
    monkeypatch.setattr(sessions, "AsyncSessionLocal", fake_local)
    monkeypatch.setattr(sessions, "OUTPUT_DIR", str(tmp_path))

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            integration="zoom",
            session_id="s1",
            language="en",
            user_payload={"sub": "u1"},
            token_payload={"user_id": "u1", "session_id": "s1"},
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_download_returns_file_response(monkeypatch, tmp_path):
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    output_dir = tmp_path / "zoom" / "s1"
    output_dir.mkdir(parents=True)
    file_path = output_dir / "transcript.vtt"
    file_path.write_text("WEBVTT\n\n", encoding="utf-8")

    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(readable_id=None, platform="zoom", translation_type="one_way", started_at=datetime(2025, 1, 2), meeting_time=None)),
        FakeResult(first_row=SimpleNamespace(file_name="transcript.vtt")),
    )
    monkeypatch.setattr(sessions, "AsyncSessionLocal", fake_local)
    monkeypatch.setattr(sessions, "OUTPUT_DIR", str(tmp_path))

    response = await endpoint(
        integration="zoom",
        session_id="s1",
        language="en",
        user_payload={"sub": "u1"},
        token_payload={"user_id": "u1", "session_id": "s1"},
    )

    assert response.media_type == "text/vtt"
    assert "zoom_01-02-25_en.vtt" == response.filename


@pytest.mark.asyncio
async def test_download_readable_id_resolution_prefers_latest(monkeypatch, tmp_path):
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    output_dir = tmp_path / "zoom" / "resolved-session"
    output_dir.mkdir(parents=True)
    (output_dir / "latest.vtt").write_text("WEBVTT\n\n", encoding="utf-8")

    fake_local = fake_session_local(
        FakeResult(
            scalar=SimpleNamespace(
                readable_id="readable-1",
                platform="zoom",
                translation_type="one_way",
                started_at=datetime(2025, 1, 2),
                meeting_time=None,
            )
        ),
        FakeResult(
            first_row=SimpleNamespace(
                file_name="latest.vtt",
                meeting_id="resolved-session",
                started_at=datetime(2025, 2, 2),
                meeting_time=None,
            )
        ),
    )
    monkeypatch.setattr(sessions, "AsyncSessionLocal", fake_local)
    monkeypatch.setattr(sessions, "OUTPUT_DIR", str(tmp_path))

    response = await endpoint(
        integration="zoom",
        session_id="s1",
        language="en",
        user_payload={"sub": "u1"},
        token_payload={"user_id": "u1", "session_id": "s1"},
    )

    assert response.filename == "zoom_02-02-25_en.vtt"


@pytest.mark.asyncio
async def test_download_standalone_two_way_uses_two_way_language(monkeypatch, tmp_path):
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    output_dir = tmp_path / "standalone" / "s1"
    output_dir.mkdir(parents=True)
    (output_dir / "two-way.vtt").write_text("WEBVTT\n\n", encoding="utf-8")

    fake_local = fake_session_local(
        FakeResult(
            scalar=SimpleNamespace(
                readable_id=None,
                platform="standalone",
                translation_type="two_way",
                started_at=datetime(2025, 1, 2),
                meeting_time=None,
            )
        ),
        FakeResult(first_row=SimpleNamespace(file_name="two-way.vtt")),
    )
    monkeypatch.setattr(sessions, "AsyncSessionLocal", fake_local)
    monkeypatch.setattr(sessions, "OUTPUT_DIR", str(tmp_path))

    response = await endpoint(
        integration="standalone",
        session_id="s1",
        language="en",
        user_payload={"sub": "u1"},
        token_payload={"user_id": "u1", "session_id": "s1"},
    )

    assert response.filename == "standalone_01-02-25_two_way.vtt"


@pytest.mark.asyncio
async def test_download_unexpected_error_returns_500(monkeypatch):
    endpoint = _endpoint("/api/session/{integration}/{session_id:path}/download/vtt")

    class BadSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(sessions, "AsyncSessionLocal", lambda: BadSession())

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            integration="zoom",
            session_id="s1",
            language="en",
            user_payload={"sub": "u1"},
            token_payload={"user_id": "u1", "session_id": "s1"},
        )

    assert exc_info.value.status_code == 500
