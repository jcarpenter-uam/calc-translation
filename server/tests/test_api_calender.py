from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api import calender
from tests.helpers import FakeResult, fake_session_local


def _endpoint(path: str):
    router = calender.create_calender_router()
    return next(r.endpoint for r in router.routes if r.path == path)


class FakeHTTPResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = "err"

    def json(self):
        return self._payload


class FakeHTTPClient:
    def __init__(self, response):
        self._response = response

    async def get(self, _url, headers=None):
        return self._response


def _setup_platform(monkeypatch, platform: str, *extra_results: FakeResult):
    results = [FakeResult(all_rows=[SimpleNamespace(platform=platform)])]
    results.extend(extra_results)
    monkeypatch.setattr(calender, "AsyncSessionLocal", fake_session_local(*results))


@pytest.mark.asyncio
async def test_sync_calendar_requires_user_payload():
    endpoint = _endpoint("/api/calender/sync")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(payload={})

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_sync_calendar_no_integration_returns_403(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")
    monkeypatch.setattr(calender, "AsyncSessionLocal", fake_session_local(FakeResult(all_rows=[])))

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(payload={"sub": "u1"})

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_sync_calendar_microsoft_zoom_only(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_ms_token(_user_id):
        return "token"

    monkeypatch.setattr(calender, "get_valid_microsoft_token", fake_ms_token)
    monkeypatch.setattr(calender, "get_http_client", lambda: FakeHTTPClient(FakeHTTPResponse(200, {
        "value": [
            {
                "id": "evt-1",
                "subject": "Daily",
                "isCancelled": False,
                "start": {"dateTime": "2026-03-06T12:00:00"},
                "end": {"dateTime": "2026-03-06T13:00:00"},
                "location": {"displayName": "https://zoom.us/j/123"},
                "webLink": "w",
                "organizer": {"emailAddress": {"name": "Org"}},
                "body": {"content": "Body"},
            },
            {
                "id": "evt-2",
                "subject": "No Zoom",
                "isCancelled": False,
                "start": {"dateTime": "2026-03-06T12:00:00"},
                "end": {"dateTime": "2026-03-06T13:00:00"},
                "location": {"displayName": "Room A"},
            },
        ]
    })))

    monkeypatch.setattr(
        calender,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(all_rows=[SimpleNamespace(platform="microsoft")]),
            FakeResult(),
        ),
    )

    result = await endpoint(payload={"sub": "u1"})

    assert len(result) == 1
    assert result[0].id == "evt-1"
    assert result[0].location == "Zoom Meeting"


@pytest.mark.asyncio
async def test_sync_calendar_google_parses_z_datetime(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_google_token(_user_id):
        return "token"

    monkeypatch.setattr(calender, "get_valid_google_token", fake_google_token)
    monkeypatch.setattr(calender, "get_http_client", lambda: FakeHTTPClient(FakeHTTPResponse(200, {
        "items": [
            {
                "id": "g-1",
                "summary": "Planning",
                "status": "cancelled",
                "start": {"dateTime": "2026-03-06T12:00:00Z"},
                "end": {"dateTime": "2026-03-06T13:00:00Z"},
                "location": "https://zoom.us/j/abc",
                "htmlLink": "h",
                "organizer": {"email": "x@example.com"},
                "description": "desc",
            }
        ]
    })))

    monkeypatch.setattr(
        calender,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(all_rows=[SimpleNamespace(platform="google")]),
            FakeResult(),
        ),
    )

    result = await endpoint(payload={"sub": "u1"})

    assert len(result) == 1
    assert result[0].is_cancelled is True
    assert result[0].start_time.tzinfo == timezone.utc


@pytest.mark.asyncio
async def test_sync_calendar_microsoft_token_missing_returns_empty(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_ms_token(_user_id):
        return None

    monkeypatch.setattr(calender, "get_valid_microsoft_token", fake_ms_token)
    _setup_platform(monkeypatch, "microsoft")

    result = await endpoint(payload={"sub": "u1"})

    assert result == []


@pytest.mark.asyncio
async def test_sync_calendar_microsoft_non_200_returns_empty(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_ms_token(_user_id):
        return "token"

    monkeypatch.setattr(calender, "get_valid_microsoft_token", fake_ms_token)
    monkeypatch.setattr(
        calender,
        "get_http_client",
        lambda: FakeHTTPClient(FakeHTTPResponse(500, {"value": []})),
    )
    _setup_platform(monkeypatch, "microsoft")

    result = await endpoint(payload={"sub": "u1"})

    assert result == []


@pytest.mark.asyncio
async def test_sync_calendar_google_token_missing_returns_empty(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_google_token(_user_id):
        return None

    monkeypatch.setattr(calender, "get_valid_google_token", fake_google_token)
    _setup_platform(monkeypatch, "google")

    result = await endpoint(payload={"sub": "u1"})

    assert result == []


@pytest.mark.asyncio
async def test_sync_calendar_google_non_200_returns_empty(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_google_token(_user_id):
        return "token"

    monkeypatch.setattr(calender, "get_valid_google_token", fake_google_token)
    monkeypatch.setattr(
        calender,
        "get_http_client",
        lambda: FakeHTTPClient(FakeHTTPResponse(500, {"items": []})),
    )
    _setup_platform(monkeypatch, "google")

    result = await endpoint(payload={"sub": "u1"})

    assert result == []


@pytest.mark.asyncio
async def test_sync_calendar_microsoft_uses_locations_fallback(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_ms_token(_user_id):
        return "token"

    monkeypatch.setattr(calender, "get_valid_microsoft_token", fake_ms_token)
    monkeypatch.setattr(
        calender,
        "get_http_client",
        lambda: FakeHTTPClient(
            FakeHTTPResponse(
                200,
                {
                    "value": [
                        {
                            "id": "evt-loc-fallback",
                            "subject": "Fallback",
                            "isCancelled": False,
                            "start": {"dateTime": "2026-03-06T12:00:00"},
                            "end": {"dateTime": "2026-03-06T13:00:00"},
                            "location": {"displayName": None},
                            "locations": [{"displayName": "https://zoom.us/j/xyz"}],
                        }
                    ]
                },
            )
        ),
    )
    _setup_platform(monkeypatch, "microsoft", FakeResult())

    result = await endpoint(payload={"sub": "u1"})

    assert len(result) == 1
    assert result[0].id == "evt-loc-fallback"
    assert result[0].location == "Zoom Meeting"


@pytest.mark.asyncio
async def test_sync_calendar_google_parse_error_and_valueerror_fallbacks(monkeypatch):
    endpoint = _endpoint("/api/calender/sync")

    async def fake_google_token(_user_id):
        return "token"

    class _FakeDateTime:
        _counts = {}

        @staticmethod
        def now(tz=None):
            return datetime.now(tz=tz)

        @staticmethod
        def combine(date_obj, time_obj):
            return datetime.combine(date_obj, time_obj)

        @staticmethod
        def fromisoformat(raw):
            key = str(raw)
            count = _FakeDateTime._counts.get(key, 0)
            _FakeDateTime._counts[key] = count + 1
            if key in {
                "BAD_NOZ_START",
                "BAD_NOZ_END",
                "BAD_Z_STARTZ",
                "BAD_Z_ENDZ",
            } and count == 0:
                raise ValueError("bad dt")
            if key in {"BAD_NOZ_START", "BAD_Z_START+00:00"}:
                return datetime(2026, 3, 6, 12, 0, tzinfo=timezone.utc)
            if key in {"BAD_NOZ_END", "BAD_Z_END+00:00"}:
                return datetime(2026, 3, 6, 13, 0, tzinfo=timezone.utc)
            return datetime.fromisoformat(raw)

    monkeypatch.setattr(calender, "get_valid_google_token", fake_google_token)
    monkeypatch.setattr(calender, "datetime", _FakeDateTime)
    monkeypatch.setattr(
        calender,
        "get_http_client",
        lambda: FakeHTTPClient(
            FakeHTTPResponse(
                200,
                {
                    "items": [
                        {"id": "bad", "start": {"dateTime": object()}, "end": {}},
                        {
                            "id": "g-z",
                            "summary": "z",
                            "start": {"dateTime": "BAD_Z_STARTZ"},
                            "end": {"dateTime": "BAD_Z_ENDZ"},
                            "location": "https://zoom.us/j/z",
                        },
                        {
                            "id": "g-noz",
                            "summary": "noz",
                            "start": {"dateTime": "BAD_NOZ_START"},
                            "end": {"dateTime": "BAD_NOZ_END"},
                            "location": "https://zoom.us/j/noz",
                        },
                    ]
                },
            )
        ),
    )
    _setup_platform(monkeypatch, "google", FakeResult(), FakeResult())

    result = await endpoint(payload={"sub": "u1"})

    assert {r.id for r in result} == {"g-z", "g-noz"}


@pytest.mark.asyncio
async def test_get_calendar_requires_user_payload():
    endpoint = _endpoint("/api/calender/")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(payload={})

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_get_calendar_returns_mapped_rows(monkeypatch):
    endpoint = _endpoint("/api/calender/")
    now = datetime(2026, 3, 6, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        calender,
        "AsyncSessionLocal",
        fake_session_local(
            FakeResult(
                scalars_rows=[
                    SimpleNamespace(
                        id="c1",
                        subject="S",
                        body_content="B",
                        start_time=now,
                        end_time=now,
                        location="Zoom Meeting",
                        join_url="https://zoom.us/j/1",
                        web_link="w",
                        organizer="Org",
                        is_cancelled=False,
                    )
                ]
            )
        ),
    )

    result = await endpoint(
        start=now,
        end=now,
        payload={"sub": "u1"},
    )

    assert len(result) == 1
    assert result[0].id == "c1"
