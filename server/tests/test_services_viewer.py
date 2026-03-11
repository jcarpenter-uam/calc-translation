from types import SimpleNamespace

import pytest
from fastapi import WebSocketDisconnect

from services import viewer
from tests.helpers import FakeResult, fake_session_local


class FakeWebSocket:
    def __init__(self):
        self.sent = []
        self.closed = None

    async def send_json(self, payload):
        self.sent.append(payload)

    async def receive_text(self):
        raise WebSocketDisconnect()

    async def close(self, code, reason=None):
        self.closed = (code, reason)


class FakeViewerManager:
    def __init__(self, active_map=None, meta=None):
        self.active_map = active_map or {}
        self.meta = meta or {}
        self.connected = []
        self.disconnected = []

    async def is_session_active_global(self, session_id):
        return self.active_map.get(session_id, False)

    async def connect(self, websocket, session_id, language_code, user_id):
        self.connected.append((session_id, language_code, user_id))

    async def get_session_metadata_global(self, session_id):
        return self.meta.get(session_id, {})

    async def disconnect(self, websocket, session_id):
        self.disconnected.append(session_id)


@pytest.mark.asyncio
async def test_handle_viewer_session_active_flow_disconnects():
    ws = FakeWebSocket()
    mgr = FakeViewerManager(active_map={"s1": True}, meta={"s1": {"shared_two_way_mode": False}})

    await viewer.handle_viewer_session(ws, "s1", mgr, "en", "u1")

    assert mgr.connected == [("s1", "en", "u1")]
    assert ws.sent[0]["status"] == "active"
    assert mgr.disconnected == ["s1"]


@pytest.mark.asyncio
async def test_handle_viewer_session_waiting_two_way_from_db(monkeypatch):
    row = SimpleNamespace(platform="standalone", translation_type="two_way", readable_id=None)
    monkeypatch.setattr(viewer, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=row)))

    ws = FakeWebSocket()
    mgr = FakeViewerManager(active_map={"s1": False}, meta={"s1": {"shared_two_way_mode": True}})

    await viewer.handle_viewer_session(ws, "s1", mgr, "en", "u1")

    assert ws.sent[0]["status"] == "waiting"
    assert ws.sent[0]["shared_two_way_mode"] is True


@pytest.mark.asyncio
async def test_handle_viewer_session_redirects_to_active_sibling(monkeypatch):
    row = SimpleNamespace(platform="zoom", translation_type="one_way", readable_id="rid-1")
    sibling = SimpleNamespace(id="s2")
    monkeypatch.setattr(
        viewer,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=row), FakeResult(all_rows=[sibling])),
    )

    ws = FakeWebSocket()
    mgr = FakeViewerManager(active_map={"s1": False, "s2": True}, meta={"s2": {"shared_two_way_mode": False}})

    await viewer.handle_viewer_session(ws, "s1", mgr, "en", "u1")

    assert mgr.connected[0][0] == "s2"
    assert mgr.disconnected == ["s2"]


@pytest.mark.asyncio
async def test_handle_viewer_session_meeting_missing_zoom_lookup_failure(monkeypatch):
    monkeypatch.setattr(viewer, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    async def bad_zoom_fetch(**kwargs):
        raise RuntimeError("not found")

    monkeypatch.setattr(viewer, "get_meeting_data", bad_zoom_fetch)

    ws = FakeWebSocket()
    mgr = FakeViewerManager(active_map={"s1": False})

    await viewer.handle_viewer_session(ws, "s1", mgr, "en", "u1")

    assert ws.closed == (4004, "Session not found")
    assert mgr.connected == []


@pytest.mark.asyncio
async def test_handle_viewer_session_meeting_missing_zoom_lookup_success(monkeypatch):
    monkeypatch.setattr(viewer, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    async def ok_zoom_fetch(**kwargs):
        return "resolved"

    monkeypatch.setattr(viewer, "get_meeting_data", ok_zoom_fetch)

    ws = FakeWebSocket()
    mgr = FakeViewerManager(active_map={"s1": False, "resolved": True}, meta={"resolved": {"shared_two_way_mode": False}})

    await viewer.handle_viewer_session(ws, "s1", mgr, "en", "u1")

    assert mgr.connected[0][0] == "resolved"
    assert mgr.disconnected == ["resolved"]


@pytest.mark.asyncio
async def test_handle_viewer_session_unexpected_error_is_caught(monkeypatch):
    class BadManager(FakeViewerManager):
        async def connect(self, websocket, session_id, language_code, user_id):
            raise RuntimeError("boom")

    ws = FakeWebSocket()
    mgr = BadManager(active_map={"s1": True})
    await viewer.handle_viewer_session(ws, "s1", mgr, "en", "u1")
    assert mgr.disconnected == []
