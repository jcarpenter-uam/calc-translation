from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.responses import Response

from api import tenants
from tests.helpers import FakeResult, fake_session_local


def _endpoint(path: str, method: str):
    router = tenants.create_tenant_router()
    method = method.upper()
    return next(
        r.endpoint
        for r in router.routes
        if r.path == path and method in getattr(r, "methods", set())
    )


def _tenant_response(tenant_id: str = "t1"):
    return tenants.TenantResponse(
        tenant_id=tenant_id,
        organization_name="Org",
        domains=[tenants.DomainEntry(domain="example.com", provider="microsoft")],
        client_id="cid",
        has_secret=True,
        auth_methods={"microsoft": {"client_id": "cid", "has_secret": True, "tenant_hint": "t1"}},
    )


def test_tenant_create_parse_domains_handles_empty_and_dict():
    empty = tenants.TenantCreate(
        tenant_id="t1",
        organization_name="Org",
        domains=[],
        client_id="cid",
        client_secret="secret",
    )
    mixed = tenants.TenantCreate(
        tenant_id="t1",
        organization_name="Org",
        domains=[{"domain": "dict.example", "provider": "google"}],
        client_id="cid",
        client_secret="secret",
    )

    assert empty.domains == []
    assert mixed.domains[0].domain == "dict.example"


def test_tenant_update_parse_domains_handles_none_and_mixed_types():
    raw_entry = tenants.DomainEntry(domain="raw.example", provider="microsoft")
    model_none = tenants.TenantUpdate(domains=None)
    model_mixed = tenants.TenantUpdate(
        domains=["str.example", {"domain": "dict.example", "provider": "google"}, raw_entry]
    )

    assert model_none.domains is None
    assert [d.domain for d in model_mixed.domains] == [
        "str.example",
        "dict.example",
        "raw.example",
    ]


@pytest.mark.asyncio
async def test_build_tenant_response_missing_returns_none(monkeypatch):
    fake_local = fake_session_local(FakeResult(scalar=None))
    session = fake_local.session

    result = await tenants._build_tenant_response(session, "missing")

    assert result is None


@pytest.mark.asyncio
async def test_build_tenant_response_constructs_payload():
    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(tenant_id="t1", organization_name="Org")),
        FakeResult(
            scalars_rows=[
                SimpleNamespace(provider_type="google", client_id="g", client_secret_encrypted="x", tenant_hint="g-hint"),
                SimpleNamespace(provider_type="microsoft", client_id="m", client_secret_encrypted="y", tenant_hint="m-hint"),
            ]
        ),
        FakeResult(scalars_rows=[SimpleNamespace(domain="example.com", provider_type="google")]),
    )

    result = await tenants._build_tenant_response(fake_local.session, "t1", provider="google")

    assert result.tenant_id == "t1"
    assert result.client_id == "g"
    assert result.has_secret is True
    assert result.domains[0].domain == "example.com"


@pytest.mark.asyncio
async def test_build_tenant_response_provider_falls_back_to_microsoft():
    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(tenant_id="t1", organization_name="Org")),
        FakeResult(
            scalars_rows=[
                SimpleNamespace(
                    provider_type="microsoft",
                    client_id="m",
                    client_secret_encrypted="x",
                    tenant_hint="hint",
                )
            ]
        ),
        FakeResult(scalars_rows=[]),
    )

    result = await tenants._build_tenant_response(fake_local.session, "t1", provider="google")

    assert result.client_id == "m"
    assert result.has_secret is True


@pytest.mark.asyncio
async def test_build_tenant_response_provider_falls_back_to_first_auth_method():
    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(tenant_id="t1", organization_name="Org")),
        FakeResult(
            scalars_rows=[
                SimpleNamespace(
                    provider_type="saml",
                    client_id="saml-id",
                    client_secret_encrypted="x",
                    tenant_hint="hint",
                )
            ]
        ),
        FakeResult(scalars_rows=[]),
    )

    result = await tenants._build_tenant_response(fake_local.session, "t1", provider="google")

    assert result.client_id == "saml-id"


@pytest.mark.asyncio
async def test_build_tenant_response_provider_defaults_when_no_auth_methods():
    fake_local = fake_session_local(
        FakeResult(scalar=SimpleNamespace(tenant_id="t1", organization_name="Org")),
        FakeResult(scalars_rows=[]),
        FakeResult(scalars_rows=[]),
    )

    result = await tenants._build_tenant_response(fake_local.session, "t1", provider="google")

    assert result.client_id == ""
    assert result.has_secret is False


@pytest.mark.asyncio
async def test_post_tenant_success(monkeypatch):
    endpoint = _endpoint("/api/tenant/", "POST")

    monkeypatch.setattr(tenants, "encrypt", lambda value: f"enc:{value}")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(), FakeResult(), FakeResult(), FakeResult()),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return _tenant_response(tenant_id)

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint(
        tenants.TenantCreate(
            tenant_id="t1",
            organization_name="Org",
            domains=["example.com"],
            client_id="cid",
            client_secret="secret",
            provider_type="microsoft",
        )
    )

    assert result.tenant_id == "t1"


@pytest.mark.asyncio
async def test_get_tenants_filters_none(monkeypatch):
    endpoint = _endpoint("/api/tenant/", "GET")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalars_rows=["t1", "t2"])),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        if tenant_id == "t1":
            return _tenant_response("t1")
        return None

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint()

    assert len(result) == 1
    assert result[0].tenant_id == "t1"


@pytest.mark.asyncio
async def test_get_tenant_404(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "GET")
    monkeypatch.setattr(tenants, "AsyncSessionLocal", fake_session_local())

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return None

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    with pytest.raises(HTTPException) as exc_info:
        await endpoint("missing")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_patch_tenant_new_provider_requires_client_and_secret(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "PATCH")
    monkeypatch.setattr(tenants, "encrypt", lambda value: f"enc:{value}")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=None)),
    )

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            "t1",
            tenants.TenantUpdate(provider_type="google", client_id="cid"),
        )

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_delete_tenant_not_found(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "DELETE")
    monkeypatch.setattr(tenants, "AsyncSessionLocal", fake_session_local(FakeResult(rowcount=0)))

    with pytest.raises(HTTPException) as exc_info:
        await endpoint("missing")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_tenant_auth_invalid_provider():
    endpoint = _endpoint("/api/tenant/{tenant_id}/auth/{provider_type}", "DELETE")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint("t1", "bad")

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_delete_tenant_auth_returns_204_when_last_method(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}/auth/{provider_type}", "DELETE")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(), FakeResult(scalar=0), FakeResult()),
    )

    result = await endpoint("t1", "google")

    assert isinstance(result, Response)
    assert result.status_code == 204


@pytest.mark.asyncio
async def test_delete_tenant_auth_returns_updated_row(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}/auth/{provider_type}", "DELETE")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(), FakeResult(scalar=1)),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return _tenant_response(tenant_id)

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint("t1", "google")

    assert result.tenant_id == "t1"


@pytest.mark.asyncio
async def test_get_tenant_success(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "GET")
    monkeypatch.setattr(tenants, "AsyncSessionLocal", fake_session_local())

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return _tenant_response(tenant_id)

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint("t1")
    assert result.tenant_id == "t1"


@pytest.mark.asyncio
async def test_patch_tenant_existing_auth_and_domains(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "PATCH")
    monkeypatch.setattr(tenants, "encrypt", lambda value: f"enc:{value}")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(scalar=SimpleNamespace()), FakeResult(), FakeResult(), FakeResult()),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return _tenant_response(tenant_id)

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint(
        "t1",
        tenants.TenantUpdate(
            organization_name="Org 2",
            client_id="new-cid",
            client_secret="new-secret",
            domains=[{"domain": "new.example.com", "provider": "google"}],
            provider_type="google",
        ),
    )

    assert result.tenant_id == "t1"


@pytest.mark.asyncio
async def test_patch_tenant_updates_tenant_hint(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "PATCH")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=SimpleNamespace()), FakeResult()),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return _tenant_response(tenant_id)

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint(
        "t1",
        tenants.TenantUpdate(
            tenant_hint="hint-2",
            provider_type="microsoft",
        ),
    )

    assert result.tenant_id == "t1"


@pytest.mark.asyncio
async def test_patch_tenant_adds_new_provider_when_credentials_present(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "PATCH")
    monkeypatch.setattr(tenants, "encrypt", lambda value: f"enc:{value}")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=None), FakeResult()),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return _tenant_response(tenant_id)

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint(
        "t1",
        tenants.TenantUpdate(
            provider_type="google",
            client_id="google-id",
            client_secret="google-secret",
            tenant_hint="google-hint",
        ),
    )

    assert result.tenant_id == "t1"


@pytest.mark.asyncio
async def test_patch_tenant_returns_404_when_response_missing(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "PATCH")
    monkeypatch.setattr(tenants, "AsyncSessionLocal", fake_session_local(FakeResult()))

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return None

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    with pytest.raises(HTTPException) as exc_info:
        await endpoint("missing", tenants.TenantUpdate(organization_name="X"))

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_patch_tenant_internal_error_returns_500(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "PATCH")

    class BadSession:
        async def __aenter__(self):
            raise RuntimeError("db fail")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(tenants, "AsyncSessionLocal", lambda: BadSession())

    with pytest.raises(HTTPException) as exc_info:
        await endpoint("t1", tenants.TenantUpdate(organization_name="Org 2"))

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_post_tenant_internal_error_returns_500(monkeypatch):
    endpoint = _endpoint("/api/tenant/", "POST")

    class BadSession:
        async def __aenter__(self):
            raise RuntimeError("db fail")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(tenants, "AsyncSessionLocal", lambda: BadSession())
    monkeypatch.setattr(tenants, "encrypt", lambda value: f"enc:{value}")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            tenants.TenantCreate(
                tenant_id="t1",
                organization_name="Org",
                domains=["example.com"],
                client_id="cid",
                client_secret="secret",
                provider_type="microsoft",
            )
        )

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_delete_tenant_success_returns_204(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}", "DELETE")
    monkeypatch.setattr(tenants, "AsyncSessionLocal", fake_session_local(FakeResult(rowcount=1)))

    result = await endpoint("t1")

    assert isinstance(result, Response)
    assert result.status_code == 204


@pytest.mark.asyncio
async def test_delete_tenant_auth_returns_204_when_row_missing_after_commit(monkeypatch):
    endpoint = _endpoint("/api/tenant/{tenant_id}/auth/{provider_type}", "DELETE")
    monkeypatch.setattr(
        tenants,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(), FakeResult(scalar=1)),
    )

    async def fake_build(_session, tenant_id, provider="microsoft"):
        return None

    monkeypatch.setattr(tenants, "_build_tenant_response", fake_build)

    result = await endpoint("t1", "google")

    assert isinstance(result, Response)
    assert result.status_code == 204
