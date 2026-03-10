import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from integrations import standalone
from tests.helpers import FakeResult, fake_session_local


@pytest.mark.asyncio
async def test_authenticate_standalone_requires_join_url():
    with pytest.raises(HTTPException) as exc_info:
        await standalone.authenticate_standalone_session(
            standalone.StandaloneAuthRequest(join_url=None)
        )

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_authenticate_standalone_found_by_path(monkeypatch):
    monkeypatch.setattr(
        standalone,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar="meeting-1")),
    )

    out = await standalone.authenticate_standalone_session(
        standalone.StandaloneAuthRequest(join_url="https://x/sessions/standalone/meeting-1")
    )

    assert out == "meeting-1"


@pytest.mark.asyncio
async def test_authenticate_standalone_fallback_on_parse_error(monkeypatch):
    monkeypatch.setattr(standalone, "urlparse", lambda _v: (_ for _ in ()).throw(ValueError("bad")))
    monkeypatch.setattr(
        standalone,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar="meeting-2")),
    )

    out = await standalone.authenticate_standalone_session(
        standalone.StandaloneAuthRequest(join_url="meeting-2")
    )

    assert out == "meeting-2"


@pytest.mark.asyncio
async def test_authenticate_standalone_uses_raw_url_when_path_missing(monkeypatch):
    monkeypatch.setattr(
        standalone,
        "urlparse",
        lambda _v: SimpleNamespace(path=""),
    )
    monkeypatch.setattr(
        standalone,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar="meeting-raw")),
    )

    out = await standalone.authenticate_standalone_session(
        standalone.StandaloneAuthRequest(join_url="meeting-raw")
    )

    assert out == "meeting-raw"


@pytest.mark.asyncio
async def test_authenticate_standalone_not_found(monkeypatch):
    monkeypatch.setattr(
        standalone,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=None)),
    )

    with pytest.raises(HTTPException) as exc_info:
        await standalone.authenticate_standalone_session(
            standalone.StandaloneAuthRequest(join_url="https://x/sessions/standalone/miss")
        )

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_create_standalone_requires_integration(monkeypatch):
    monkeypatch.setattr(
        standalone,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=None)),
    )

    with pytest.raises(HTTPException) as exc_info:
        await standalone.create_standalone_session("u1")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_standalone_success(monkeypatch):
    monkeypatch.setattr(
        standalone,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(scalar=SimpleNamespace(id=99)),
            FakeResult(),
        ),
    )
    monkeypatch.setattr(standalone.settings, "APP_BASE_URL", "https://app.example/")
    monkeypatch.setattr(standalone.uuid, "uuid4", lambda: uuid.UUID("12345678-1234-5678-1234-567812345678"))

    meeting_id, join_url = await standalone.create_standalone_session(
        "u1",
        language_hints=["en", "es"],
        translation_type="two_way",
        language_a="en",
        language_b="es",
    )

    assert meeting_id == "12345678-1234-5678-1234-567812345678"
    assert join_url == "https://app.example/sessions/standalone/12345678-1234-5678-1234-567812345678"
