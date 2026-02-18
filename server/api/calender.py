import json
import logging
from datetime import datetime, time, timedelta, timezone
from typing import List, Optional

from core.authentication import get_current_user_payload
from core.db import AsyncSessionLocal
from core.http_client import get_http_client
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException
from integrations.entra import get_valid_microsoft_token
from integrations.google import get_valid_google_token
from models.calendar_events import CalendarEvent as CalendarEventModel
from models.integrations import Integration
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger(__name__)


class CalendarEvent(BaseModel):
    id: str
    subject: str | None
    start_time: datetime | None
    end_time: datetime | None
    location: str | None
    join_url: str | None
    body_content: str | None
    web_link: str | None
    organizer: str | None
    is_cancelled: bool


def create_calender_router() -> APIRouter:
    """
    Creates the REST API router for users calenders.
    """
    router = APIRouter(
        prefix="/api/calender",
    )
    LOG_STEP = "API-CALENDER"

    async def _fetch_microsoft_events(user_id: str, start_str: str, end_str: str):
        access_token = await get_valid_microsoft_token(user_id)
        if not access_token:
            return None

        url = (
            f"https://graph.microsoft.com/v1.0/me/calendarView"
            f"?startDateTime={start_str}"
            f"&endDateTime={end_str}"
            f"&$top=50"
            f"&$orderby=start/dateTime"
        )

        client = get_http_client()
        response = await client.get(
            url, headers={"Authorization": f"Bearer {access_token}"}
        )

        if response.status_code != 200:
            logger.error(f"Microsoft Graph API Error: {response.text}")
            return None

        data = response.json()
        return data.get("value", [])

    async def _fetch_google_events(user_id: str, start_dt: datetime, end_dt: datetime):
        access_token = await get_valid_google_token(user_id)
        if not access_token:
            return None

        time_min = start_dt.isoformat().replace("+00:00", "Z")
        time_max = end_dt.isoformat().replace("+00:00", "Z")

        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events"
            f"?timeMin={time_min}"
            f"&timeMax={time_max}"
            f"&singleEvents=true"
            f"&orderBy=startTime"
        )

        client = get_http_client()
        response = await client.get(
            url, headers={"Authorization": f"Bearer {access_token}"}
        )

        if response.status_code != 200:
            logger.error(f"Google Calendar API Error: {response.text}")
            return None

        data = response.json()
        return data.get("items", [])

    def _parse_microsoft_event(event):
        event_id = event.get("id")
        subject = event.get("subject")
        is_cancelled = event.get("isCancelled", False)

        start_raw = (event.get("start") or {}).get("dateTime")
        end_raw = (event.get("end") or {}).get("dateTime")

        start_time = (
            datetime.fromisoformat(start_raw).replace(tzinfo=timezone.utc)
            if start_raw
            else None
        )
        end_time = (
            datetime.fromisoformat(end_raw).replace(tzinfo=timezone.utc)
            if end_raw
            else None
        )

        location_obj = event.get("location") or {}
        location = location_obj.get("displayName")
        if not location:
            locs = event.get("locations", [])
            if locs:
                location = locs[0].get("displayName")

        web_link = event.get("webLink")
        organizer = event.get("organizer", {}).get("emailAddress", {}).get("name")
        body_content = (event.get("body") or {}).get("content")

        join_url = None
        if location and "zoom.us" in location:
            join_url = location

        return {
            "id": event_id,
            "subject": subject,
            "body": body_content,
            "start": start_time,
            "end": end_time,
            "location": location,
            "join_url": join_url,
            "web_link": web_link,
            "organizer": organizer,
            "is_cancelled": is_cancelled,
            "raw": event,
        }

    def _parse_google_event(event):
        try:
            event_id = event.get("id")
            subject = event.get("summary")
            status = event.get("status")
            is_cancelled = status == "cancelled"

            start_raw = event.get("start", {}).get("dateTime")
            end_raw = event.get("end", {}).get("dateTime")

            start_time = None
            if start_raw:
                try:
                    dt = datetime.fromisoformat(start_raw)
                    start_time = dt.astimezone(timezone.utc)
                except ValueError:
                    if start_raw.endswith("Z"):
                        start_raw = start_raw[:-1] + "+00:00"
                        dt = datetime.fromisoformat(start_raw)
                        start_time = dt.astimezone(timezone.utc)
                    else:
                        start_time = datetime.fromisoformat(start_raw).replace(
                            tzinfo=timezone.utc
                        )

            end_time = None
            if end_raw:
                try:
                    dt = datetime.fromisoformat(end_raw)
                    end_time = dt.astimezone(timezone.utc)
                except ValueError:
                    if end_raw.endswith("Z"):
                        end_raw = end_raw[:-1] + "+00:00"
                        dt = datetime.fromisoformat(end_raw)
                        end_time = dt.astimezone(timezone.utc)
                    else:
                        end_time = datetime.fromisoformat(end_raw).replace(
                            tzinfo=timezone.utc
                        )

            location = event.get("location")
            web_link = event.get("htmlLink")
            organizer = event.get("organizer", {}).get("email")
            body_content = event.get("description")

            join_url = None
            if location and "zoom.us" in location:
                join_url = location

            return {
                "id": event_id,
                "subject": subject,
                "body": body_content,
                "start": start_time,
                "end": end_time,
                "location": location,
                "join_url": join_url,
                "web_link": web_link,
                "organizer": organizer,
                "is_cancelled": is_cancelled,
                "raw": event,
            }
        except Exception as e:
            logger.error(
                f"Error parsing google event {event.get('id')}: {e}", exc_info=True
            )
            return None

    # NOTE: Requires User Auth
    @router.get("/sync", response_model=List[CalendarEvent])
    async def sync_calendar(payload: dict = Depends(get_current_user_payload)):
        """
        Syncs calendar events from either Microsoft or Google depending on user integration.
        Stores them in the DB and returns the list.
        """
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid user session.")

            platforms = []
            async with AsyncSessionLocal() as session:
                rows = await session.execute(
                    select(Integration.platform).where(Integration.user_id == user_id)
                )
                platforms = [r.platform for r in rows]

            today_date = datetime.now(timezone.utc).date()
            start_dt = datetime.combine(today_date, time.min).replace(
                tzinfo=timezone.utc
            )
            end_dt = start_dt + timedelta(days=30)

            ms_start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            ms_end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            raw_events = []
            provider_type = "none"

            if "microsoft" in platforms:
                provider_type = "microsoft"
                ms_data = await _fetch_microsoft_events(
                    user_id, ms_start_str, ms_end_str
                )
                if ms_data:
                    raw_events = [_parse_microsoft_event(e) for e in ms_data]

            if "google" in platforms:
                provider_type = "google"
                g_data = await _fetch_google_events(user_id, start_dt, end_dt)
                if g_data:
                    g_parsed = []
                    for e in g_data:
                        p = _parse_google_event(e)
                        if p:
                            g_parsed.append(p)
                    raw_events.extend(g_parsed)

            if not raw_events and provider_type == "none":
                raise HTTPException(
                    status_code=403, detail="No calendar integration found."
                )

            parsed_events = []

            async with AsyncSessionLocal() as session:
                for ev in raw_events:
                    if not ev["join_url"]:
                        logger.debug(
                            f"Skipping event '{ev['subject']}': No Zoom link. (Loc: {ev.get('location')})"
                        )
                        continue

                    display_loc = ev["location"]
                    if display_loc and (
                        display_loc.startswith("http") or "zoom.us" in display_loc
                    ):
                        display_loc = "Zoom Meeting"

                    stmt = insert(CalendarEventModel).values(
                        id=ev["id"],
                        user_id=user_id,
                        subject=ev["subject"],
                        body_content=ev["body"],
                        start_time=ev["start"],
                        end_time=ev["end"],
                        location=display_loc,
                        join_url=ev["join_url"],
                        web_link=ev["web_link"],
                        organizer=ev["organizer"],
                        is_cancelled=ev["is_cancelled"],
                        full_event_data=ev["raw"],
                    )
                    stmt = stmt.on_conflict_do_update(
                        index_elements=[CalendarEventModel.id],
                        set_={
                            "subject": stmt.excluded.subject,
                            "body_content": stmt.excluded.body_content,
                            "start_time": stmt.excluded.start_time,
                            "end_time": stmt.excluded.end_time,
                            "location": stmt.excluded.location,
                            "join_url": stmt.excluded.join_url,
                            "web_link": stmt.excluded.web_link,
                            "organizer": stmt.excluded.organizer,
                            "is_cancelled": stmt.excluded.is_cancelled,
                            "full_event_data": stmt.excluded.full_event_data,
                        },
                    )
                    await session.execute(stmt)

                    parsed_events.append(
                        CalendarEvent(
                            id=ev["id"],
                            subject=ev["subject"],
                            body_content=ev["body"],
                            start_time=ev["start"],
                            end_time=ev["end"],
                            location=display_loc,
                            join_url=ev["join_url"],
                            web_link=ev["web_link"],
                            organizer=ev["organizer"],
                            is_cancelled=ev["is_cancelled"],
                        )
                    )
                await session.commit()

            logger.info(
                f"Synced {len(parsed_events)} events via {provider_type} for {user_id}."
            )
            return parsed_events

    # NOTE: Requires User Auth
    @router.get("/", response_model=List[CalendarEvent])
    async def get_calendar(
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        payload: dict = Depends(get_current_user_payload),
    ):
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid user session.")

            clauses = [CalendarEventModel.user_id == user_id]
            if start is not None:
                clauses.append(CalendarEventModel.start_time >= start)
            if end is not None:
                clauses.append(CalendarEventModel.start_time <= end)
            async with AsyncSessionLocal() as session:
                rows = await session.execute(
                    select(CalendarEventModel)
                    .where(and_(*clauses))
                    .order_by(CalendarEventModel.start_time.asc())
                )
                records = rows.scalars().all()

            events = []
            for row in records:
                events.append(
                    CalendarEvent(
                        id=row.id,
                        subject=row.subject,
                        body_content=row.body_content,
                        start_time=row.start_time,
                        end_time=row.end_time,
                        location=row.location,
                        join_url=row.join_url,
                        web_link=row.web_link,
                        organizer=row.organizer,
                        is_cancelled=row.is_cancelled,
                    )
                )

            return events

    return router
