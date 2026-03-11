from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

from integrations import zoom
from tests.helpers import FakeResult, fake_session_local


class _HTTPResp:
    def __init__(self, status_code=200, payload=None, text="err", raise_http=False):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text
        self._raise_http = raise_http

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self._raise_http:
            req = httpx.Request("GET", "https://example.com")
            resp = httpx.Response(500, request=req, text=self.text)
            raise httpx.HTTPStatusError("boom", request=req, response=resp)


class _HTTPClient:
    def __init__(self, post_resps=None, get_resps=None):
        self.post_resps = list(post_resps or [])
        self.get_resps = list(get_resps or [])

    async def post(self, *_a, **_k):
        return self.post_resps.pop(0)

    async def get(self, *_a, **_k):
        return self.get_resps.pop(0)


@pytest.mark.asyncio
async def test_exchange_code_for_token_paths(monkeypatch):
    monkeypatch.setattr(
        zoom,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(),),
    )
    monkeypatch.setattr(zoom.time, "time", lambda: 100)
    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(
            post_resps=[_HTTPResp(200, {"access_token": "a", "refresh_token": "r", "expires_in": 10})],
            get_resps=[_HTTPResp(200, {"id": "zoom-user"})],
        ),
    )
    await zoom.exchange_code_for_token("code", "https://cb", "u1")

    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(post_resps=[_HTTPResp(500, raise_http=True)]),
    )
    with pytest.raises(HTTPException):
        await zoom.exchange_code_for_token("code", "https://cb", "u1")

    monkeypatch.setattr(zoom, "get_http_client", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(HTTPException):
        await zoom.exchange_code_for_token("code", "https://cb", "u1")


@pytest.mark.asyncio
async def test_ensure_active_token_paths(monkeypatch):
    integ = SimpleNamespace(id=1, access_token="active", expires_at=9999999999, refresh_token="r")
    monkeypatch.setattr(zoom.time, "time", lambda: 1)
    token, integration_id = await zoom._ensure_active_token(integ)
    assert token == "active"
    assert integration_id == 1

    with pytest.raises(HTTPException):
        await zoom._ensure_active_token(SimpleNamespace(id=1, access_token="x", expires_at=0, refresh_token=None))

    monkeypatch.setattr(zoom.time, "time", lambda: 100)
    monkeypatch.setattr(
        zoom,
        "AsyncSessionLocal",
        fake_session_local(FakeResult()),
    )
    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(post_resps=[_HTTPResp(200, {"access_token": "new", "refresh_token": "newr", "expires_in": 10})]),
    )
    token2, integration_id2 = await zoom._ensure_active_token(
        SimpleNamespace(id=2, access_token="old", expires_at=0, refresh_token="r")
    )
    assert token2 == "new"
    assert integration_id2 == 2

    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(post_resps=[_HTTPResp(500, raise_http=True)]),
    )
    with pytest.raises(HTTPException):
        await zoom._ensure_active_token(SimpleNamespace(id=2, access_token="old", expires_at=0, refresh_token="r"))

    monkeypatch.setattr(zoom, "get_http_client", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(HTTPException):
        await zoom._ensure_active_token(SimpleNamespace(id=2, access_token="old", expires_at=0, refresh_token="r"))


@pytest.mark.asyncio
async def test_get_access_token_by_zoom_id_and_user(monkeypatch):
    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    with pytest.raises(HTTPException):
        await zoom.get_access_token_by_zoom_id("z1")

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=SimpleNamespace(id=1))))
    async def ensure_tok(_i):
        return ("tok", 1)

    monkeypatch.setattr(zoom, "_ensure_active_token", ensure_tok)
    assert await zoom.get_access_token_by_zoom_id("z1") == ("tok", 1)

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    with pytest.raises(HTTPException):
        await zoom.get_valid_access_token("u1")

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=SimpleNamespace(id=2))))
    async def ensure_tok2(_i):
        return ("tok2", 2)

    monkeypatch.setattr(zoom, "_ensure_active_token", ensure_tok2)
    assert await zoom.get_valid_access_token("u1") == ("tok2", 2)


@pytest.mark.asyncio
async def test_get_meeting_data_paths(monkeypatch):
    async def get_valid(_u):
        return ("tok", 9)

    monkeypatch.setattr(zoom, "get_valid_access_token", get_valid)
    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(
            get_resps=[
                _HTTPResp(
                    200,
                    {
                        "uuid": "real-uuid",
                        "id": 1234,
                        "created_at": "2026-03-06T12:00:00",
                        "join_url": "https://zoom.us/j/1234",
                        "pstn_password": "p",
                        "topic": "Topic",
                    },
                )
            ]
        ),
    )
    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult()))
    out = await zoom.get_meeting_data(meeting_identifier="m1", user_id="u1")
    assert out == "real-uuid"

    async def get_by_zoom_id(_zid):
        return ("tok", 11)

    monkeypatch.setattr(zoom, "get_access_token_by_zoom_id", get_by_zoom_id)
    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(
            get_resps=[
                _HTTPResp(
                    200,
                    {
                        "uuid": "real-uuid-z",
                        "id": 555,
                        "created_at": "2026-03-06T12:00:00",
                        "join_url": "https://zoom.us/j/555",
                    },
                )
            ]
        ),
    )
    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult()))
    out_host = await zoom.get_meeting_data(meeting_uuid="m2", zoom_host_id="zh1")
    assert out_host == "real-uuid-z"

    monkeypatch.setattr(zoom, "get_valid_access_token", get_valid)
    monkeypatch.setattr(
        zoom,
        "get_http_client",
        lambda: _HTTPClient(get_resps=[_HTTPResp(500)]),
    )
    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult()))
    out2 = await zoom.get_meeting_data(meeting_uuid="fallback-id", user_id="u1")
    assert out2 == "fallback-id"

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult()))
    out3 = await zoom.get_meeting_data(meeting_uuid="need-fallback")
    assert out3 == "need-fallback"

    monkeypatch.setattr(
        zoom,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(),),
    )

    class BadSession:
        async def __aenter__(self):
            raise RuntimeError("db fail")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(zoom, "AsyncSessionLocal", lambda: BadSession())
    with pytest.raises(HTTPException):
        await zoom.get_meeting_data(meeting_uuid="x")


@pytest.mark.asyncio
async def test_authenticate_zoom_session_paths(monkeypatch):
    req = zoom.ZoomAuthRequest(join_url="https://zoom.us/j/123")
    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar="m1")))
    assert await zoom.authenticate_zoom_session(req) == "m1"

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    async def gd2(**_k):
        return "m2"

    monkeypatch.setattr(zoom, "get_meeting_data", gd2)
    assert await zoom.authenticate_zoom_session(req, user_id="u1") == "m2"

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    with pytest.raises(HTTPException):
        await zoom.authenticate_zoom_session(req)

    req2 = zoom.ZoomAuthRequest(meetingid="123", meetingpass="p")
    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(first_row=SimpleNamespace(id="m3", passcode="p"))))
    assert await zoom.authenticate_zoom_session(req2) == "m3"

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(first_row=SimpleNamespace(id="m3", passcode="x"))))
    with pytest.raises(HTTPException):
        await zoom.authenticate_zoom_session(req2)

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(first_row=None)))
    async def gd4(**_k):
        return "m4"

    monkeypatch.setattr(zoom, "get_meeting_data", gd4)
    assert await zoom.authenticate_zoom_session(zoom.ZoomAuthRequest(meetingid="777"), user_id="u1") == "m4"

    monkeypatch.setattr(zoom, "AsyncSessionLocal", fake_session_local(FakeResult(first_row=None)))
    async def gd_fail(**_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(zoom, "get_meeting_data", gd_fail)
    with pytest.raises(HTTPException):
        await zoom.authenticate_zoom_session(zoom.ZoomAuthRequest(meetingid="777"), user_id="u1")

    with pytest.raises(HTTPException):
        await zoom.authenticate_zoom_session(zoom.ZoomAuthRequest())
