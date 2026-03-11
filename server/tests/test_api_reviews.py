from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api import reviews
from tests.helpers import FakeResult, fake_session_local


def _endpoint(path: str, method: str):
    router = reviews.create_review_router()
    method = method.upper()
    return next(
        r.endpoint
        for r in router.routes
        if r.path == path and method in getattr(r, "methods", set())
    )


@pytest.mark.asyncio
async def test_submit_review_requires_existing_user(monkeypatch):
    monkeypatch.setattr(reviews, "validate_review_token", lambda _token: {"sub": "u1", "resource": "m1"})
    monkeypatch.setattr(reviews, "AsyncSessionLocal", fake_session_local(FakeResult(scalar=None)))

    endpoint = _endpoint("/api/reviews/submit", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(reviews.ReviewSubmitRequest(token="abc", rating=5, note="Great"))

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_submit_review_rejects_blank_note(monkeypatch):
    monkeypatch.setattr(reviews, "validate_review_token", lambda _token: {"sub": "u1", "resource": "m1"})

    endpoint = _endpoint("/api/reviews/submit", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(reviews.ReviewSubmitRequest(token="abc", rating=4, note="   "))

    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_submit_review_rejects_invalid_token_payload(monkeypatch):
    monkeypatch.setattr(reviews, "validate_review_token", lambda _token: {"resource": "m1"})
    endpoint = _endpoint("/api/reviews/submit", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(reviews.ReviewSubmitRequest(token="abc", rating=4, note="ok"))
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_submit_review_persists_and_returns_review(monkeypatch):
    monkeypatch.setattr(reviews, "validate_review_token", lambda _token: {"sub": "u1", "resource": "m1"})

    fake_local = fake_session_local(FakeResult(scalar="u1"))
    monkeypatch.setattr(reviews, "AsyncSessionLocal", fake_local)

    endpoint = _endpoint("/api/reviews/submit", "POST")
    result = await endpoint(reviews.ReviewSubmitRequest(token="abc", rating=4, note=" Nice work "))

    assert result.user_id == "u1"
    assert result.meeting_id == "m1"
    assert result.rating == 4
    assert result.note == "Nice work"


@pytest.mark.asyncio
async def test_get_my_reviews_requires_sub():
    endpoint = _endpoint("/api/reviews/me", "GET")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(user_payload={})

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_my_reviews_returns_descending_rows(monkeypatch):
    now = datetime.now(timezone.utc)
    rows = [
        SimpleNamespace(id=2, user_id="u1", meeting_id="m2", rating=5, note="b", created_at=now),
        SimpleNamespace(id=1, user_id="u1", meeting_id="m1", rating=4, note="a", created_at=now),
    ]

    monkeypatch.setattr(reviews, "AsyncSessionLocal", fake_session_local(FakeResult(scalars_rows=rows)))

    endpoint = _endpoint("/api/reviews/me", "GET")
    result = await endpoint(user_payload={"sub": "u1"})

    assert [r.id for r in result] == [2, 1]


@pytest.mark.asyncio
async def test_get_all_reviews_maps_join_rows(monkeypatch):
    now = datetime.now(timezone.utc)
    rows = [
        (SimpleNamespace(id=1, user_id="u1", rating=5, note="great", created_at=now), "Alice", "a@example.com")
    ]
    monkeypatch.setattr(reviews, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=rows)))

    endpoint = _endpoint("/api/reviews/", "GET")
    result = await endpoint()

    assert len(result) == 1
    assert result[0].user_name == "Alice"
