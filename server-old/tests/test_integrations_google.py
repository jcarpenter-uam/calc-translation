import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from integrations import google
from tests.helpers import FakeResult, fake_session_local


class _Req:
    def __init__(self, query_params=None, cookies=None):
        self.query_params = query_params or {}
        self.cookies = cookies or {}


class _Resp:
    def __init__(self):
        self.cookies_set = []
        self.cookies_deleted = []

    def set_cookie(self, **kwargs):
        self.cookies_set.append(kwargs)

    def delete_cookie(self, key):
        self.cookies_deleted.append(key)


class _HTTPResp:
    def __init__(self, status_code, payload=None, text="err"):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class _HTTPClient:
    def __init__(self, post_resp=None, get_resp=None):
        self._post = post_resp
        self._get = get_resp

    async def post(self, *_a, **_k):
        return self._post

    async def get(self, *_a, **_k):
        return self._get


@pytest.mark.asyncio
async def test_get_config_helpers(monkeypatch):
    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(first_row=None), FakeResult(first_row=None)),
    )
    assert await google.get_config_for_domain("x.com") is None
    assert await google.get_config_for_tenant("t1") is None

    row_domain = SimpleNamespace(
        tenant_hint="cust",
        client_id="cid",
        client_secret_encrypted="enc",
        tenant_id="tid",
    )
    row_tenant = SimpleNamespace(
        tenant_hint="cust2",
        client_id="cid2",
        client_secret_encrypted="enc2",
    )
    monkeypatch.setattr(google, "decrypt", lambda v: f"dec:{v}")
    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(first_row=row_domain), FakeResult(first_row=row_tenant)),
    )
    assert (await google.get_config_for_domain("x.com"))["client_secret"] == "dec:enc"
    assert (await google.get_config_for_tenant("t1"))["client_secret"] == "dec:enc2"


@pytest.mark.asyncio
async def test_get_valid_google_token_branches(monkeypatch):
    monkeypatch.setattr(google, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    assert await google.get_valid_google_token("u1") is None

    integ = SimpleNamespace(access_token="tok", expires_at=9999999999, refresh_token="r1")
    monkeypatch.setattr(google, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=integ)))
    monkeypatch.setattr(google.time, "time", lambda: 1)
    assert await google.get_valid_google_token("u1") == "tok"

    integ2 = SimpleNamespace(access_token="old", expires_at=0, refresh_token=None)
    monkeypatch.setattr(google, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=integ2)))
    assert await google.get_valid_google_token("u1") is None

    integ3 = SimpleNamespace(id=5, access_token="old", expires_at=0, refresh_token="r")
    user = SimpleNamespace(id="u1", email="u1@example.com")
    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=user), FakeResult()),
    )
    async def cfg_ok(_d):
        return {"client_id": "cid", "client_secret": "sec"}

    monkeypatch.setattr(google, "get_config_for_domain", cfg_ok)
    monkeypatch.setattr(
        google,
        "get_http_client",
        lambda: _HTTPClient(post_resp=_HTTPResp(200, {"access_token": "new", "expires_in": 10})),
    )
    monkeypatch.setattr(google.time, "time", lambda: 100)
    assert await google.get_valid_google_token("u1") == "new"

    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=SimpleNamespace(id="u1", email=None))),
    )
    assert await google.get_valid_google_token("u1") is None

    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=user)),
    )
    async def cfg_none(_d):
        return None

    monkeypatch.setattr(google, "get_config_for_domain", cfg_none)
    assert await google.get_valid_google_token("u1") is None

    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=user)),
    )
    monkeypatch.setattr(google, "get_config_for_domain", cfg_ok)
    monkeypatch.setattr(google, "get_http_client", lambda: _HTTPClient(post_resp=_HTTPResp(500)))
    assert await google.get_valid_google_token("u1") is None


@pytest.mark.asyncio
async def test_google_login_paths(monkeypatch):
    response = _Resp()
    with pytest.raises(HTTPException):
        await google.handle_login(google.GoogleLoginRequest(email="bad", language="en"), response)

    async def login_cfg_none(_d):
        return None

    monkeypatch.setattr(google, "get_config_for_domain", login_cfg_none)
    with pytest.raises(HTTPException) as exc_info:
        await google.handle_login(google.GoogleLoginRequest(email="a@b.com", language="en"), response)
    assert exc_info.value.status_code == 403

    async def login_cfg_ok(_d):
        return {"internal_id": "tid", "client_id": "cid"}

    monkeypatch.setattr(google, "get_config_for_domain", login_cfg_ok)
    monkeypatch.setattr(google.uuid, "uuid4", lambda: "state-1")
    monkeypatch.setattr(google.settings, "APP_BASE_URL", "https://app.example")
    out = await google.handle_login(google.GoogleLoginRequest(email="a@b.com", language="en"), response)
    assert "login_url" in out
    assert response.cookies_set


@pytest.mark.asyncio
async def test_google_callback_paths(monkeypatch):
    with pytest.raises(HTTPException):
        await google.handle_callback(_Req(query_params={"error": "access_denied"}))

    with pytest.raises(HTTPException):
        await google.handle_callback(_Req(query_params={}, cookies={}))

    with pytest.raises(HTTPException):
        await google.handle_callback(_Req(query_params={"state": "s", "code": "c"}, cookies={"google_auth_state": "bad-json"}))

    with pytest.raises(HTTPException):
        await google.handle_callback(
            _Req(
                query_params={"state": "s1", "code": "c"},
                cookies={"google_auth_state": json.dumps({"state": "s2"})},
            )
        )

    async def tenant_cfg_none(_t):
        return None

    monkeypatch.setattr(google, "get_config_for_tenant", tenant_cfg_none)
    with pytest.raises(HTTPException):
        await google.handle_callback(
            _Req(
                query_params={"state": "s", "code": "c"},
                cookies={"google_auth_state": json.dumps({"state": "s", "tenant_id": "t1"})},
            )
        )

    async def tenant_cfg_ok(_t):
        return {"client_id": "cid", "client_secret": "sec"}

    monkeypatch.setattr(google, "get_config_for_tenant", tenant_cfg_ok)
    monkeypatch.setattr(google, "get_http_client", lambda: _HTTPClient(post_resp=_HTTPResp(500)))
    with pytest.raises(HTTPException):
        await google.handle_callback(
            _Req(
                query_params={"state": "s", "code": "c"},
                cookies={"google_auth_state": json.dumps({"state": "s", "tenant_id": "t1"})},
            )
        )

    monkeypatch.setattr(
        google,
        "get_http_client",
        lambda: _HTTPClient(
            post_resp=_HTTPResp(200, {"access_token": "at", "refresh_token": "rt", "expires_in": 10}),
            get_resp=_HTTPResp(500),
        ),
    )
    with pytest.raises(HTTPException):
        await google.handle_callback(
            _Req(
                query_params={"state": "s", "code": "c"},
                cookies={"google_auth_state": json.dumps({"state": "s", "tenant_id": "t1"})},
            )
        )

    monkeypatch.setattr(
        google,
        "get_http_client",
        lambda: _HTTPClient(
            post_resp=_HTTPResp(200, {"access_token": "at", "refresh_token": "rt", "expires_in": 10}),
            get_resp=_HTTPResp(200, {"sub": "u1", "email": "u1@example.com", "name": "User"}),
        ),
    )
    monkeypatch.setattr(google, "generate_jwt_token", lambda **_k: "app-token")
    monkeypatch.setattr(google.settings, "APP_BASE_URL", "https://app.example")
    monkeypatch.setattr(
        google,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult()),
    )
    resp = await google.handle_callback(
        _Req(
            query_params={"state": "s", "code": "c"},
            cookies={"google_auth_state": json.dumps({"state": "s", "tenant_id": "t1", "language": "en"})},
        )
    )
    assert resp.status_code in (302, 307)


@pytest.mark.asyncio
async def test_google_logout():
    response = _Resp()
    out = await google.handle_logout(response, {"sub": "u1"})
    assert out["logout_url"] == "/"
    assert "app_auth_token" in response.cookies_deleted
