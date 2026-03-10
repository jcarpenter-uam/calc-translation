import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from integrations import entra
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


@pytest.mark.asyncio
async def test_entra_config_helpers(monkeypatch):
    monkeypatch.setattr(
        entra,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(first_row=None), FakeResult(first_row=None)),
    )
    assert await entra.get_config_for_domain("x.com") is None
    assert await entra.get_config_for_tenant("t1") is None

    row_domain = SimpleNamespace(
        tenant_hint="tenant-hint",
        client_id="cid",
        client_secret_encrypted="enc",
        tenant_id="tid",
    )
    row_tenant = SimpleNamespace(
        tenant_hint="tenant-hint-2",
        client_id="cid2",
        client_secret_encrypted="enc2",
    )
    monkeypatch.setattr(entra, "decrypt", lambda v: f"dec:{v}")
    monkeypatch.setattr(
        entra,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(first_row=row_domain), FakeResult(first_row=row_tenant)),
    )
    assert (await entra.get_config_for_domain("x.com"))["client_secret"] == "dec:enc"
    assert (await entra.get_config_for_tenant("t1"))["client_secret"] == "dec:enc2"


def test_entra_build_auth_helpers(monkeypatch):
    class FakeMsal:
        def __init__(self, *_a, **_k):
            pass

        def get_authorization_request_url(self, *_a, **_k):
            return "url"

        def acquire_token_by_authorization_code(self, *_a, **_k):
            return {"access_token": "tok"}

    monkeypatch.setattr(entra.msal, "ConfidentialClientApplication", FakeMsal)
    monkeypatch.setattr(entra.settings, "APP_BASE_URL", "https://app.example")

    cfg = {"tenant_id": "t", "client_id": "c", "client_secret": "s"}
    assert entra._build_auth_url(cfg, "state") == "url"
    assert entra._get_token_from_code(cfg, "code")["access_token"] == "tok"


@pytest.mark.asyncio
async def test_get_valid_microsoft_token_branches(monkeypatch):
    monkeypatch.setattr(entra, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    assert await entra.get_valid_microsoft_token("u1") is None

    integ = SimpleNamespace(access_token="tok", expires_at=9999999999, refresh_token="r")
    monkeypatch.setattr(entra, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=integ)))
    monkeypatch.setattr(entra.time, "time", lambda: 1)
    assert await entra.get_valid_microsoft_token("u1") == "tok"

    integ2 = SimpleNamespace(access_token="old", expires_at=0, refresh_token=None)
    monkeypatch.setattr(entra, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=integ2)))
    assert await entra.get_valid_microsoft_token("u1") is None

    integ3 = SimpleNamespace(id=5, access_token="old", expires_at=0, refresh_token="r")
    user = SimpleNamespace(id="u1", email="u1@example.com")
    monkeypatch.setattr(
        entra,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=user), FakeResult()),
    )

    async def cfg_ok(_d):
        return {"tenant_id": "t", "client_id": "cid", "client_secret": "sec"}

    class AppOK:
        def acquire_token_by_refresh_token(self, *_a, **_k):
            return {"access_token": "new", "refresh_token": "newr", "expires_in": 10}

    monkeypatch.setattr(entra, "get_config_for_domain", cfg_ok)
    monkeypatch.setattr(entra, "_build_msal_app", lambda _cfg: AppOK())
    monkeypatch.setattr(entra.time, "time", lambda: 100)
    assert await entra.get_valid_microsoft_token("u1") == "new"

    monkeypatch.setattr(
        entra,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=SimpleNamespace(id="u1", email=None))),
    )
    assert await entra.get_valid_microsoft_token("u1") is None

    async def cfg_none(_d):
        return None

    monkeypatch.setattr(
        entra,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=user)),
    )
    monkeypatch.setattr(entra, "get_config_for_domain", cfg_none)
    assert await entra.get_valid_microsoft_token("u1") is None

    class AppErr:
        def acquire_token_by_refresh_token(self, *_a, **_k):
            return {"error": "bad", "error_description": "boom"}

    monkeypatch.setattr(
        entra,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=integ3), FakeResult(scalar=user)),
    )
    monkeypatch.setattr(entra, "get_config_for_domain", cfg_ok)
    monkeypatch.setattr(entra, "_build_msal_app", lambda _cfg: AppErr())
    assert await entra.get_valid_microsoft_token("u1") is None


@pytest.mark.asyncio
async def test_entra_login_paths(monkeypatch):
    response = _Resp()
    with pytest.raises(HTTPException):
        await entra.handle_login(entra.EntraLoginRequest(email="bad", language="en"), response)

    async def cfg_none(_d):
        return None

    monkeypatch.setattr(entra, "get_config_for_domain", cfg_none)
    with pytest.raises(HTTPException) as exc_info:
        await entra.handle_login(entra.EntraLoginRequest(email="a@b.com", language="en"), response)
    assert exc_info.value.status_code == 403

    async def cfg_ok(_d):
        return {"internal_id": "tid", "tenant_id": "tenant", "client_id": "cid", "client_secret": "sec"}

    monkeypatch.setattr(entra, "get_config_for_domain", cfg_ok)
    monkeypatch.setattr(entra.uuid, "uuid4", lambda: "state-1")
    monkeypatch.setattr(entra, "_build_auth_url", lambda *_a, **_k: "https://login")
    monkeypatch.setattr(entra.settings, "APP_BASE_URL", "https://app.example")
    out = await entra.handle_login(entra.EntraLoginRequest(email="a@b.com", language="en"), response)
    assert out["login_url"] == "https://login"
    assert response.cookies_set


@pytest.mark.asyncio
async def test_entra_callback_paths(monkeypatch):
    with pytest.raises(HTTPException):
        await entra.handle_callback(_Req(query_params={}, cookies={}))

    with pytest.raises(HTTPException):
        await entra.handle_callback(_Req(query_params={"state": "s", "code": "c"}, cookies={"entra_auth_state": "bad-json"}))

    with pytest.raises(HTTPException):
        await entra.handle_callback(
            _Req(
                query_params={"state": "s1", "code": "c"},
                cookies={"entra_auth_state": json.dumps({"state": "s2"})},
            )
        )

    async def cfg_none(_t):
        return None

    monkeypatch.setattr(entra, "get_config_for_tenant", cfg_none)
    with pytest.raises(HTTPException):
        await entra.handle_callback(
            _Req(
                query_params={"state": "s", "code": "c"},
                cookies={"entra_auth_state": json.dumps({"state": "s", "tenant_id": "t1"})},
            )
        )

    async def cfg_ok(_t):
        return {"tenant_id": "t", "client_id": "cid", "client_secret": "sec"}

    monkeypatch.setattr(entra, "get_config_for_tenant", cfg_ok)
    monkeypatch.setattr(entra, "_get_token_from_code", lambda *_a, **_k: {"error": "bad", "error_description": "boom"})
    with pytest.raises(HTTPException):
        await entra.handle_callback(
            _Req(
                query_params={"state": "s", "code": "c"},
                cookies={"entra_auth_state": json.dumps({"state": "s", "tenant_id": "t1"})},
            )
        )

    monkeypatch.setattr(
        entra,
        "_get_token_from_code",
        lambda *_a, **_k: {"id_token_claims": {}, "access_token": "at", "refresh_token": "rt", "expires_in": 10},
    )
    with pytest.raises(HTTPException):
        await entra.handle_callback(
            _Req(
                query_params={"state": "s", "code": "c"},
                cookies={"entra_auth_state": json.dumps({"state": "s", "tenant_id": "t1"})},
            )
        )

    monkeypatch.setattr(
        entra,
        "_get_token_from_code",
        lambda *_a, **_k: {
            "id_token_claims": {"oid": "u1", "preferred_username": "u1@example.com", "name": "User"},
            "access_token": "at",
            "refresh_token": "rt",
            "expires_in": 10,
        },
    )
    monkeypatch.setattr(entra, "generate_jwt_token", lambda **_k: "app-token")
    monkeypatch.setattr(entra.settings, "APP_BASE_URL", "https://app.example")
    monkeypatch.setattr(entra, "AsyncSessionLocal", fake_session_local(FakeResult(), FakeResult()))
    resp = await entra.handle_callback(
        _Req(
            query_params={"state": "s", "code": "c"},
            cookies={"entra_auth_state": json.dumps({"state": "s", "tenant_id": "t1", "language": "en"})},
        )
    )
    assert resp.status_code in (302, 307)


@pytest.mark.asyncio
async def test_entra_logout(monkeypatch):
    response = _Resp()
    monkeypatch.setattr(entra.settings, "APP_BASE_URL", "https://app.example")
    out = await entra.handle_logout(response, {"sub": "u1"})
    assert out["logout_url"].startswith("https://login.microsoftonline.com/common/oauth2/v2.0/logout")
    assert "app_auth_token" in response.cookies_deleted
