from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from api import auth
from tests.helpers import FakeResult, fake_session_local


def _endpoint(path: str, method: str):
    router = auth.create_auth_router()
    method = method.upper()
    return next(
        r.endpoint
        for r in router.routes
        if r.path == path and method in getattr(r, "methods", set())
    )


@pytest.mark.asyncio
async def test_login_with_explicit_microsoft_provider(monkeypatch):
    async def fake_login(_request, _response):
        return {"provider": "microsoft"}

    monkeypatch.setattr(auth.entra, "handle_login", fake_login)

    endpoint = _endpoint("/api/auth/login", "POST")
    result = await endpoint(auth.LoginRequest(email="user@example.com", language="en", provider="microsoft"), Response())

    assert result == {"provider": "microsoft"}


@pytest.mark.asyncio
async def test_login_with_explicit_google_provider(monkeypatch):
    async def fake_login(_request, _response):
        return {"provider": "google"}

    monkeypatch.setattr(auth.google, "handle_login", fake_login)

    endpoint = _endpoint("/api/auth/login", "POST")
    result = await endpoint(auth.LoginRequest(email="user@example.com", language="en", provider="google"), Response())

    assert result == {"provider": "google"}


@pytest.mark.asyncio
async def test_login_invalid_email_returns_400():
    endpoint = _endpoint("/api/auth/login", "POST")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.LoginRequest(email="bad-email", language="en"), Response())

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_login_domain_not_configured_returns_403(monkeypatch):
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=[])))

    endpoint = _endpoint("/api/auth/login", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.LoginRequest(email="user@example.com", language="en"), Response())

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_login_pinned_provider_missing_credentials_returns_500(monkeypatch):
    rows = [SimpleNamespace(provider_type="google", pinned_provider="microsoft")]
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=rows)))

    endpoint = _endpoint("/api/auth/login", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.LoginRequest(email="user@example.com", language="en"), Response())

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_login_multiple_providers_returns_selector(monkeypatch):
    rows = [
        SimpleNamespace(provider_type="google", pinned_provider=None),
        SimpleNamespace(provider_type="microsoft", pinned_provider=None),
    ]
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=rows)))

    endpoint = _endpoint("/api/auth/login", "POST")
    result = await endpoint(auth.LoginRequest(email="user@example.com", language="en"), Response())

    assert result["action"] == "select_provider"
    assert set(result["providers"]) == {"google", "microsoft"}


@pytest.mark.asyncio
async def test_login_single_google_provider_redirects_to_google_login(monkeypatch):
    rows = [SimpleNamespace(provider_type="google", pinned_provider=None)]

    async def fake_google_login(_request, _response):
        return {"provider": "google"}

    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=rows)))
    monkeypatch.setattr(auth.google, "handle_login", fake_google_login)

    endpoint = _endpoint("/api/auth/login", "POST")
    result = await endpoint(auth.LoginRequest(email="user@example.com", language="en"), Response())

    assert result == {"provider": "google"}


@pytest.mark.asyncio
async def test_login_single_microsoft_provider_redirects_to_entra(monkeypatch):
    rows = [SimpleNamespace(provider_type="microsoft", pinned_provider=None)]

    async def fake_ms_login(_request, _response):
        return {"provider": "microsoft"}

    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=rows)))
    monkeypatch.setattr(auth.entra, "handle_login", fake_ms_login)

    endpoint = _endpoint("/api/auth/login", "POST")
    result = await endpoint(auth.LoginRequest(email="user@example.com", language="en"), Response())

    assert result == {"provider": "microsoft"}


@pytest.mark.asyncio
async def test_login_pinned_provider_is_honored(monkeypatch):
    rows = [
        SimpleNamespace(provider_type="google", pinned_provider="google"),
        SimpleNamespace(provider_type="microsoft", pinned_provider="google"),
    ]

    async def fake_google_login(_request, _response):
        return {"provider": "google"}

    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=rows)))
    monkeypatch.setattr(auth.google, "handle_login", fake_google_login)

    endpoint = _endpoint("/api/auth/login", "POST")
    result = await endpoint(auth.LoginRequest(email="user@example.com", language="en"), Response())

    assert result == {"provider": "google"}


@pytest.mark.asyncio
async def test_entra_callback_delegates(monkeypatch):
    async def fake_callback(_request):
        return {"ok": True}

    monkeypatch.setattr(auth.entra, "handle_callback", fake_callback)

    endpoint = _endpoint("/api/auth/entra/callback", "GET")
    result = await endpoint(SimpleNamespace())

    assert result == {"ok": True}


@pytest.mark.asyncio
async def test_google_callback_delegates(monkeypatch):
    async def fake_callback(_request):
        return {"ok": True}

    monkeypatch.setattr(auth.google, "handle_callback", fake_callback)

    endpoint = _endpoint("/api/auth/google/callback", "GET")
    result = await endpoint(SimpleNamespace())

    assert result == {"ok": True}


@pytest.mark.asyncio
async def test_logout_delegates(monkeypatch):
    async def fake_logout(response, payload):
        return {"logged_out": payload.get("sub")}

    monkeypatch.setattr(auth.entra, "handle_logout", fake_logout)
    endpoint = _endpoint("/api/auth/logout", "POST")

    result = await endpoint(Response(), user_payload={"sub": "u1"})
    assert result == {"logged_out": "u1"}


@pytest.mark.asyncio
async def test_calendar_join_event_not_found(monkeypatch):
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    endpoint = _endpoint("/api/auth/calendar-join", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.CalendarJoinRequest(meetingId="m1"), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_calendar_join_missing_join_url(monkeypatch):
    row = SimpleNamespace(id="m1", user_id="u1", join_url=None, subject="Meeting")
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=row)))

    endpoint = _endpoint("/api/auth/calendar-join", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.CalendarJoinRequest(meetingId="m1"), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_calendar_join_unsupported_platform(monkeypatch):
    row = SimpleNamespace(id="m1", user_id="u1", join_url="https://teams.microsoft.com/abc", subject="Meeting")
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=row)))

    endpoint = _endpoint("/api/auth/calendar-join", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.CalendarJoinRequest(meetingId="m1"), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_calendar_join_unhandled_error_returns_500(monkeypatch):
    row = SimpleNamespace(id="m1", user_id="u1", join_url="https://zoom.us/j/123", subject="Meeting")
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=row)))

    async def bad_auth_zoom(request, user_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "authenticate_zoom_session", bad_auth_zoom)

    endpoint = _endpoint("/api/auth/calendar-join", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.CalendarJoinRequest(meetingId="m1"), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_calendar_join_zoom_success(monkeypatch):
    row = SimpleNamespace(id="m1", user_id="u1", join_url="https://zoom.us/j/123", subject="Meeting")
    monkeypatch.setattr(auth, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=row)))

    async def fake_auth_zoom(request, user_id):
        assert user_id == "u1"
        assert request.join_url.endswith("/123")
        return "sess-1"

    monkeypatch.setattr(auth, "authenticate_zoom_session", fake_auth_zoom)
    monkeypatch.setattr(auth, "generate_jwt_token", lambda user_id, session_id: f"jwt-{user_id}-{session_id}")

    endpoint = _endpoint("/api/auth/calendar-join", "POST")
    result = await endpoint(auth.CalendarJoinRequest(meetingId="m1"), user_payload={"sub": "u1"})

    assert result.sessionId == "sess-1"
    assert result.token == "jwt-u1-sess-1"
    assert result.type == "zoom"


@pytest.mark.asyncio
async def test_zoom_auth_requires_join_url_or_meeting_id():
    endpoint = _endpoint("/api/auth/zoom", "POST")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.ZoomAuthRequest(join_url=None, meetingid=None, meetingpass=None, topic=None), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_zoom_auth_http_exception_passes_through(monkeypatch):
    async def bad_auth_zoom(request, user_id):
        raise HTTPException(status_code=404, detail="missing")

    monkeypatch.setattr(auth, "authenticate_zoom_session", bad_auth_zoom)

    endpoint = _endpoint("/api/auth/zoom", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.ZoomAuthRequest(join_url="https://zoom.us/j/123", meetingid=None, meetingpass=None, topic=None), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_zoom_auth_unhandled_error_returns_500(monkeypatch):
    async def bad_auth_zoom(request, user_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "authenticate_zoom_session", bad_auth_zoom)

    endpoint = _endpoint("/api/auth/zoom", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.ZoomAuthRequest(join_url="https://zoom.us/j/123", meetingid=None, meetingpass=None, topic=None), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_zoom_auth_success(monkeypatch):
    async def fake_auth_zoom(request, user_id):
        assert user_id == "u1"
        return "z-session"

    monkeypatch.setattr(auth, "authenticate_zoom_session", fake_auth_zoom)
    monkeypatch.setattr(auth, "generate_jwt_token", lambda user_id, session_id: f"tok-{user_id}-{session_id}")

    endpoint = _endpoint("/api/auth/zoom", "POST")
    result = await endpoint(auth.ZoomAuthRequest(join_url="https://zoom.us/j/123", meetingid=None, meetingpass=None, topic=None), user_payload={"sub": "u1"})

    assert result.sessionId == "z-session"
    assert result.token == "tok-u1-z-session"


@pytest.mark.asyncio
async def test_zoom_callback_requires_code():
    endpoint = _endpoint("/api/auth/zoom/callback", "GET")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(SimpleNamespace(query_params={}, cookies={}), Response())

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_zoom_callback_logged_in_exchanges_token(monkeypatch):
    async def fake_get_current_user_payload(_request):
        return {"sub": "u1"}

    called = {}

    async def fake_exchange(code, redirect_uri, user_id):
        called.update({"code": code, "redirect_uri": redirect_uri, "user_id": user_id})

    monkeypatch.setattr(auth, "get_current_user_payload", fake_get_current_user_payload)
    monkeypatch.setattr(auth, "exchange_code_for_token", fake_exchange)

    endpoint = _endpoint("/api/auth/zoom/callback", "GET")
    response = await endpoint(SimpleNamespace(query_params={"code": "abc"}, cookies={}), Response())

    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/"
    assert called["code"] == "abc"
    assert called["user_id"] == "u1"


@pytest.mark.asyncio
async def test_zoom_callback_logged_out_stashes_code_in_cookie(monkeypatch):
    async def fake_user_payload(_request):
        raise HTTPException(status_code=401, detail="Not authenticated")

    monkeypatch.setattr(auth, "get_current_user_payload", fake_user_payload)

    endpoint = _endpoint("/api/auth/zoom/callback", "GET")
    response = await endpoint(SimpleNamespace(query_params={"code": "abc"}, cookies={}), Response())

    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/login?reason=zoom_link_required"
    assert "zoom_oauth_pending_code=abc" in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_zoom_callback_propagates_non_auth_http_exception(monkeypatch):
    async def bad_user_payload(_request):
        raise HTTPException(status_code=500, detail="bad")

    monkeypatch.setattr(auth, "get_current_user_payload", bad_user_payload)

    endpoint = _endpoint("/api/auth/zoom/callback", "GET")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(SimpleNamespace(query_params={"code": "abc"}, cookies={}), Response())

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_zoom_callback_http_exception_from_exchange(monkeypatch):
    async def fake_get_current_user_payload(_request):
        return {"sub": "u1"}

    async def bad_exchange(code, redirect_uri, user_id):
        raise HTTPException(status_code=400, detail="invalid code")

    monkeypatch.setattr(auth, "get_current_user_payload", fake_get_current_user_payload)
    monkeypatch.setattr(auth, "exchange_code_for_token", bad_exchange)

    endpoint = _endpoint("/api/auth/zoom/callback", "GET")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(SimpleNamespace(query_params={"code": "abc"}, cookies={}), Response())

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_zoom_callback_unhandled_error_returns_500(monkeypatch):
    async def fake_get_current_user_payload(_request):
        return {"sub": "u1"}

    async def bad_exchange(code, redirect_uri, user_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "get_current_user_payload", fake_get_current_user_payload)
    monkeypatch.setattr(auth, "exchange_code_for_token", bad_exchange)

    endpoint = _endpoint("/api/auth/zoom/callback", "GET")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(SimpleNamespace(query_params={"code": "abc"}, cookies={}), Response())

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_link_pending_zoom_without_cookie_returns_no_code():
    endpoint = _endpoint("/api/auth/zoom/link-pending", "POST")

    result = await endpoint(Response(), user_payload={"sub": "u1"}, pending_code=None)

    assert result == {"status": "no_code_found"}


@pytest.mark.asyncio
async def test_link_pending_zoom_success(monkeypatch):
    called = {}

    async def fake_exchange(code, redirect_uri, user_id):
        called.update({"code": code, "redirect_uri": redirect_uri, "user_id": user_id})

    monkeypatch.setattr(auth, "exchange_code_for_token", fake_exchange)

    endpoint = _endpoint("/api/auth/zoom/link-pending", "POST")
    response = Response()
    result = await endpoint(response, user_payload={"sub": "u1"}, pending_code="abc")

    assert result == {"status": "success"}
    assert called["code"] == "abc"
    assert called["user_id"] == "u1"
    assert "zoom_oauth_pending_code=" in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_link_pending_zoom_http_exception_clears_cookie(monkeypatch):
    async def bad_exchange(code, redirect_uri, user_id):
        raise HTTPException(status_code=400, detail="bad code")

    monkeypatch.setattr(auth, "exchange_code_for_token", bad_exchange)

    endpoint = _endpoint("/api/auth/zoom/link-pending", "POST")
    response = Response()
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(response, user_payload={"sub": "u1"}, pending_code="abc")

    assert exc_info.value.status_code == 400
    assert "zoom_oauth_pending_code=" in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
async def test_link_pending_zoom_unhandled_error_returns_500(monkeypatch):
    async def bad_exchange(code, redirect_uri, user_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "exchange_code_for_token", bad_exchange)

    endpoint = _endpoint("/api/auth/zoom/link-pending", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(Response(), user_payload={"sub": "u1"}, pending_code="abc")

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_standalone_host_two_way_requires_different_languages():
    endpoint = _endpoint("/api/auth/standalone", "POST")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            auth.StandaloneAuthRequest(
                host=True,
                translation_type="two_way",
                language_a="en",
                language_b="en",
            ),
            user_payload={"sub": "u1"},
        )

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_standalone_host_two_way_requires_both_languages():
    endpoint = _endpoint("/api/auth/standalone", "POST")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            auth.StandaloneAuthRequest(
                host=True,
                translation_type="two_way",
                language_a="en",
                language_b=None,
            ),
            user_payload={"sub": "u1"},
        )

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_standalone_host_success(monkeypatch):
    async def fake_create(user_id, language_hints=None, translation_type="one_way", language_a=None, language_b=None):
        return "s1", "https://example/s1"

    monkeypatch.setattr(auth, "create_standalone_session", fake_create)
    monkeypatch.setattr(auth, "generate_jwt_token", lambda user_id, session_id: f"tok-{user_id}-{session_id}")

    endpoint = _endpoint("/api/auth/standalone", "POST")
    result = await endpoint(
        auth.StandaloneAuthRequest(host=True, translation_type="one_way"),
        user_payload={"sub": "u1"},
    )

    assert result.sessionId == "s1"
    assert result.joinUrl == "https://example/s1"
    assert result.token == "tok-u1-s1"


@pytest.mark.asyncio
async def test_standalone_host_http_exception_passes_through(monkeypatch):
    async def bad_create(user_id, language_hints=None, translation_type="one_way", language_a=None, language_b=None):
        raise HTTPException(status_code=403, detail="denied")

    monkeypatch.setattr(auth, "create_standalone_session", bad_create)

    endpoint = _endpoint("/api/auth/standalone", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.StandaloneAuthRequest(host=True), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_standalone_auth_unhandled_error_returns_500(monkeypatch):
    async def bad_auth_standalone(_request):
        raise RuntimeError("boom")

    monkeypatch.setattr(auth, "authenticate_standalone_session", bad_auth_standalone)

    endpoint = _endpoint("/api/auth/standalone", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(auth.StandaloneAuthRequest(host=False, join_url="https://x/s2"), user_payload={"sub": "u1"})

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_standalone_join_success(monkeypatch):
    async def fake_auth_standalone(_request):
        return "s2"

    monkeypatch.setattr(auth, "authenticate_standalone_session", fake_auth_standalone)
    monkeypatch.setattr(auth, "generate_jwt_token", lambda user_id, session_id: f"tok-{user_id}-{session_id}")

    endpoint = _endpoint("/api/auth/standalone", "POST")
    result = await endpoint(
        auth.StandaloneAuthRequest(host=False, join_url="https://x/s2"),
        user_payload={"sub": "u1"},
    )

    assert result.sessionId == "s2"
    assert result.type == "standalone"
