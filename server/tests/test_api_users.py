from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from api import users
from tests.helpers import FakeResult, fake_session_local


def _endpoint(path: str, method: str):
    router = users.create_user_router()
    method = method.upper()
    return next(
        r.endpoint
        for r in router.routes
        if r.path == path and method in getattr(r, "methods", set())
    )


@pytest.mark.asyncio
async def test_get_me_returns_401_without_sub_claim():
    endpoint = _endpoint("/api/users/me", "GET")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(payload={})

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_me_returns_user(monkeypatch):
    user = SimpleNamespace(id="u1", name="Alice", email="a@example.com", is_admin=False, language_code="en")
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=user)))

    endpoint = _endpoint("/api/users/me", "GET")
    result = await endpoint(payload={"sub": "u1"})

    assert result.id == "u1"


@pytest.mark.asyncio
async def test_get_me_returns_404_when_user_missing(monkeypatch):
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    endpoint = _endpoint("/api/users/me", "GET")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(payload={"sub": "u1"})

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_my_language_success(monkeypatch):
    user = SimpleNamespace(id="u1", name="Alice", email="a@example.com", is_admin=False, language_code="es")
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(), FakeResult(scalar=user)))

    endpoint = _endpoint("/api/users/me/language", "PUT")
    result = await endpoint(users.UserLanguageUpdate(language_code="es"), payload={"sub": "u1"})

    assert result.language_code == "es"


@pytest.mark.asyncio
async def test_update_my_language_requires_sub_and_user_exists(monkeypatch):
    endpoint = _endpoint("/api/users/me/language", "PUT")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(users.UserLanguageUpdate(language_code="es"), payload={})
    assert exc_info.value.status_code == 401

    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(), FakeResult(scalar=None)))
    with pytest.raises(HTTPException) as exc_info2:
        await endpoint(users.UserLanguageUpdate(language_code="es"), payload={"sub": "u1"})
    assert exc_info2.value.status_code == 404


@pytest.mark.asyncio
async def test_update_my_onboarding_tour_success(monkeypatch):
    user = SimpleNamespace(
        id="u1",
        name="Alice",
        email="a@example.com",
        is_admin=False,
        language_code="en",
        onboarding_tour_completed=True,
    )
    monkeypatch.setattr(
        users,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(scalar=user)),
    )

    endpoint = _endpoint("/api/users/me/onboarding-tour", "PUT")
    result = await endpoint(
        users.UserOnboardingTourUpdate(onboarding_tour_completed=True),
        payload={"sub": "u1"},
    )

    assert result.onboarding_tour_completed is True


@pytest.mark.asyncio
async def test_update_my_onboarding_tour_requires_sub_and_user_exists(monkeypatch):
    endpoint = _endpoint("/api/users/me/onboarding-tour", "PUT")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            users.UserOnboardingTourUpdate(onboarding_tour_completed=True),
            payload={},
        )
    assert exc_info.value.status_code == 401

    monkeypatch.setattr(
        users, "AsyncSessionLocal", fake_session_local(FakeResult(), FakeResult(scalar=None))
    )
    with pytest.raises(HTTPException) as exc_info2:
        await endpoint(
            users.UserOnboardingTourUpdate(onboarding_tour_completed=True),
            payload={"sub": "u1"},
        )
    assert exc_info2.value.status_code == 404


@pytest.mark.asyncio
async def test_update_my_onboarding_tour_post_success(monkeypatch):
    user = SimpleNamespace(
        id="u1",
        name="Alice",
        email="a@example.com",
        is_admin=False,
        language_code="en",
        onboarding_tour_completed=False,
    )
    monkeypatch.setattr(
        users,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(), FakeResult(scalar=user)),
    )

    endpoint = _endpoint("/api/users/me/onboarding-tour", "POST")
    result = await endpoint(
        users.UserOnboardingTourUpdate(onboarding_tour_completed=False),
        payload={"sub": "u1"},
    )

    assert result.onboarding_tour_completed is False


@pytest.mark.asyncio
async def test_get_all_users_returns_rows(monkeypatch):
    rows = [
        SimpleNamespace(id="u1", name="A", email="a@x.com", is_admin=False, language_code="en"),
        SimpleNamespace(id="u2", name="B", email="b@x.com", is_admin=True, language_code="es"),
    ]
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalars_rows=rows)))

    endpoint = _endpoint("/api/users/", "GET")
    result = await endpoint()

    assert [u.id for u in result] == ["u1", "u2"]


@pytest.mark.asyncio
async def test_get_user_by_id_404(monkeypatch):
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    endpoint = _endpoint("/api/users/{user_id}", "GET")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint("missing")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_get_user_by_id_success(monkeypatch):
    user = SimpleNamespace(id="u1", name="A", email="a@x.com", is_admin=False, language_code="en")
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=user)))
    endpoint = _endpoint("/api/users/{user_id}", "GET")
    result = await endpoint("u1")
    assert result.id == "u1"


@pytest.mark.asyncio
async def test_update_user_upsert_and_return(monkeypatch):
    user = SimpleNamespace(id="u1", name="New", email="new@x.com", is_admin=False, language_code="en")
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(), FakeResult(scalar=user)))

    endpoint = _endpoint("/api/users/{user_id}", "PUT")
    result = await endpoint("u1", users.UserUpdate(name="New", email="new@x.com"))

    assert result.name == "New"


@pytest.mark.asyncio
async def test_update_user_404_when_missing_after_upsert(monkeypatch):
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(), FakeResult(scalar=None)))
    endpoint = _endpoint("/api/users/{user_id}", "PUT")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint("u1", users.UserUpdate(name="N", email="n@x.com"))
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_user_not_found(monkeypatch):
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    endpoint = _endpoint("/api/users/{user_id}", "DELETE")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint("missing")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_user_success(monkeypatch):
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=SimpleNamespace(id="u1")), FakeResult()))

    endpoint = _endpoint("/api/users/{user_id}", "DELETE")
    result = await endpoint("u1")

    assert isinstance(result, Response)
    assert result.status_code == 204


@pytest.mark.asyncio
async def test_set_admin_status_success(monkeypatch):
    user = SimpleNamespace(id="u1", name="A", email="a@x.com", is_admin=False, language_code="en")
    updated = SimpleNamespace(id="u1", name="A", email="a@x.com", is_admin=True, language_code="en")
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=user), FakeResult(), FakeResult(scalar=updated)))

    endpoint = _endpoint("/api/users/{user_id}/admin", "PUT")
    result = await endpoint("u1", users.UserAdminUpdate(is_admin=True))

    assert result.is_admin is True


@pytest.mark.asyncio
async def test_set_admin_status_user_missing_and_updated_missing(monkeypatch):
    endpoint = _endpoint("/api/users/{user_id}/admin", "PUT")

    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))
    with pytest.raises(HTTPException) as exc_info:
        await endpoint("u1", users.UserAdminUpdate(is_admin=True))
    assert exc_info.value.status_code == 404

    user = SimpleNamespace(id="u1", name="A", email="a@x.com", is_admin=False, language_code="en")
    monkeypatch.setattr(users, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=user), FakeResult(), FakeResult(scalar=None)))
    with pytest.raises(HTTPException) as exc_info2:
        await endpoint("u1", users.UserAdminUpdate(is_admin=True))
    assert exc_info2.value.status_code == 404
