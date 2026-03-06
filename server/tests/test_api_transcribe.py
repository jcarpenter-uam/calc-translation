from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api import transcribe


class FakeWebSocket:
    def __init__(self, app=None, headers=None, cookies=None):
        self.app = app or SimpleNamespace(state=SimpleNamespace())
        self.headers = headers or {}
        self.cookies = cookies or {}
        self.accepted = False
        self.closed_code = None
        self.closed_reason = None

    async def accept(self):
        self.accepted = True

    async def close(self, code, reason=None):
        self.closed_code = code
        self.closed_reason = reason


@pytest.mark.asyncio
async def test_transcribe_ws_rejects_unknown_integration():
    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app)
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="unknown", session_id="session-1")

    assert ws.accepted is True
    assert ws.closed_code == 1003


@pytest.mark.asyncio
async def test_transcribe_zoom_rejects_missing_auth_header():
    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app)
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1008
    assert ws.closed_reason == "Missing Authorization header"


@pytest.mark.asyncio
async def test_transcribe_zoom_rejects_invalid_token(monkeypatch):
    def _raise(_token):
        raise RuntimeError("bad token")

    monkeypatch.setattr(transcribe, "validate_server_token", _raise)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1008
    assert ws.closed_reason == "Authentication failed"


@pytest.mark.asyncio
async def test_transcribe_zoom_requires_identifier_in_token(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {})

    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_ws_rejects_when_services_uninitialized(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)

    app = SimpleNamespace(state=SimpleNamespace())
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1011


@pytest.mark.asyncio
async def test_transcribe_ws_hands_off_to_receiver(monkeypatch):
    calls = {}

    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    async def fake_handle_receiver_session(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(transcribe, "handle_receiver_session", fake_handle_receiver_session)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert calls["integration"] == "zoom"
    assert calls["session_id"] == "session-1"
    assert calls["viewer_manager"] == "manager"
    assert calls["backfill_service"] == "backfill"
    assert calls["summary_service"] == "summary"


@pytest.mark.asyncio
async def test_transcribe_zoom_uses_zoom_host_id(monkeypatch):
    called = {}

    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"zoom_host_id": "zh-1"})

    async def fake_get_meeting_data(**kwargs):
        called.update(kwargs)

    async def fake_handle_receiver_session(**_kwargs):
        return None

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(transcribe, "handle_receiver_session", fake_handle_receiver_session)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert called["meeting_uuid"] == "session-1"
    assert called["zoom_host_id"] == "zh-1"


@pytest.mark.asyncio
async def test_transcribe_standalone_missing_cookie(monkeypatch):
    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="standalone", session_id="session-1")

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_standalone_invalid_cookie(monkeypatch):
    def bad_payload(token):
        raise RuntimeError("bad")

    monkeypatch.setattr(transcribe, "get_current_user_payload", bad_payload)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={"app_auth_token": "x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="standalone", session_id="session-1")

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_standalone_payload_missing_sub(monkeypatch):
    monkeypatch.setattr(transcribe, "get_current_user_payload", lambda token: {})
    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={"app_auth_token": "x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint
    await endpoint(ws, integration="standalone", session_id="session-1")
    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_zoom_http_exception_closes_with_zoom_error(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def raise_http_exc(**_kwargs):
        raise HTTPException(status_code=404, detail="meeting missing")

    monkeypatch.setattr(transcribe, "get_meeting_data", raise_http_exc)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1011
    assert ws.closed_reason == "Zoom Error: meeting missing"


@pytest.mark.asyncio
async def test_transcribe_unexpected_exception_during_setup(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    async def broken_receiver(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(transcribe, "handle_receiver_session", broken_receiver)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint
    await endpoint(ws, integration="zoom", session_id="session-1")
    assert ws.closed_code == 1011


@pytest.mark.asyncio
async def test_transcribe_standalone_success(monkeypatch):
    monkeypatch.setattr(transcribe, "get_current_user_payload", lambda token: {"sub": "u1"})
    calls = {}

    async def fake_handle_receiver_session(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(transcribe, "handle_receiver_session", fake_handle_receiver_session)
    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={"app_auth_token": "x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint
    await endpoint(ws, integration="standalone", session_id="session-1")
    assert calls["integration"] == "standalone"
