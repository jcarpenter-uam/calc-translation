from types import SimpleNamespace

import pytest

from api import viewing


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.closed_code = None
        self.closed_reason = None

    async def accept(self):
        self.accepted = True

    async def close(self, code, reason=None):
        self.closed_code = code
        self.closed_reason = reason


@pytest.mark.asyncio
async def test_viewer_ws_rejects_user_mismatch():
    ws = FakeWebSocket()
    router = viewing.create_viewer_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(
        ws,
        integration="zoom",
        session_id="sess-1",
        language="en",
        token_payload={"sub": "token-user", "resource": "sess-1"},
        user_cookie={"sub": "cookie-user"},
    )

    assert ws.accepted is True
    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_viewer_ws_rejects_missing_language():
    ws = FakeWebSocket()
    router = viewing.create_viewer_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(
        ws,
        integration="zoom",
        session_id="sess-1",
        language=None,
        token_payload={"sub": "user-1", "resource": "sess-1"},
        user_cookie={"sub": "user-1"},
    )

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_viewer_ws_rejects_session_mismatch():
    ws = FakeWebSocket()
    endpoint = viewing.create_viewer_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(
        ws,
        integration="zoom",
        session_id="sess-1",
        language="en",
        token_payload={"sub": "user-1", "resource": "other-sess"},
        user_cookie={"sub": "user-1"},
    )

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_viewer_ws_hands_off_to_viewer_service(monkeypatch):
    calls = {}

    async def fake_handle_viewer_session(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(viewing, "handle_viewer_session", fake_handle_viewer_session)

    ws = FakeWebSocket()
    router = viewing.create_viewer_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(
        ws,
        integration="zoom",
        session_id="sess-1",
        language="es",
        token_payload={"sub": "user-1", "resource": "sess-1"},
        user_cookie={"sub": "user-1"},
    )

    assert calls["session_id"] == "sess-1"
    assert calls["viewer_manager"] == "manager"
    assert calls["language_code"] == "es"
    assert calls["user_id"] == "user-1"
