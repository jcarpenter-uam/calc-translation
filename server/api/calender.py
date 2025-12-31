import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional

import core.database as database
import httpx
from core.authentication import get_current_user_payload
from core.database import SQL_GET_CALENDAR_EVENTS_BY_USER_ID, SQL_UPSERT_CALENDAR_EVENT
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException
from integrations.entra import get_valid_microsoft_token
from pydantic import BaseModel

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


def create_calender_router() -> APIRouter:
    """
    Creates the REST API router for users calenders.
    """
    router = APIRouter(
        prefix="/api/calender",
    )
    LOG_STEP = "API-CALENDER"

    # NOTE: Requires User Auth
    @router.get("/sync", response_model=List[CalendarEvent])
    async def sync_calendar(payload: dict = Depends(get_current_user_payload)):
        """
        Uses the stored tokens to query the microsoft api to fetch calender information for a given user.
        Stores the information in a new calenders table
        """
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid user session.")

            access_token = await get_valid_microsoft_token(user_id)
            if not access_token:
                logger.warning(f"Could not retrieve Microsoft token for user {user_id}")
                raise HTTPException(
                    status_code=403,
                    detail="Microsoft account not linked or token expired. Please login again.",
                )

            start_dt = datetime.utcnow()
            end_dt = start_dt + timedelta(days=30)

            start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            url = (
                f"https://graph.microsoft.com/v1.0/me/calendarView"
                f"?startDateTime={start_str}"
                f"&endDateTime={end_str}"
                f"&$top=50"
                f"&$orderby=start/dateTime"
            )

            try:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        url, headers={"Authorization": f"Bearer {access_token}"}
                    )

                if response.status_code != 200:
                    logger.error(f"Graph API Error: {response.text}")
                    raise HTTPException(
                        status_code=502,
                        detail="Failed to fetch calendar from Microsoft.",
                    )

                data = response.json()
                events = data.get("value", [])

            except httpx.RequestError as e:
                logger.error(f"Network error contacting Graph API: {e}")
                raise HTTPException(status_code=502, detail="Network error.")

            parsed_events = []

            if not database.DB_POOL:
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                async with conn.transaction():
                    for event in events:
                        event_id = event.get("id")
                        subject = event.get("subject")

                        start_raw = event.get("start", {}).get("dateTime")
                        end_raw = event.get("end", {}).get("dateTime")

                        start_time = (
                            datetime.fromisoformat(start_raw.rstrip("Z"))
                            if start_raw
                            else None
                        )
                        end_time = (
                            datetime.fromisoformat(end_raw.rstrip("Z"))
                            if end_raw
                            else None
                        )

                        location = event.get("location", {}).get("displayName")
                        web_link = event.get("webLink")
                        organizer = (
                            event.get("organizer", {})
                            .get("emailAddress", {})
                            .get("name")
                        )

                        body_data = event.get("body") or {}
                        body_content = body_data.get("content")

                        online_meeting = event.get("onlineMeeting") or {}
                        join_url = online_meeting.get("joinUrl")

                        if (
                            not join_url
                            and location
                            and (
                                location.startswith("http://")
                                or location.startswith("https://")
                            )
                        ):
                            join_url = location

                        if location and (
                            location.startswith("http://")
                            or location.startswith("https://")
                        ):
                            if "meet.google.com" in location:
                                location = "Google Meet Meeting"
                            elif "zoom.us" in location:
                                location = "Zoom Meeting"

                        full_event_json = json.dumps(event)

                        await conn.execute(
                            SQL_UPSERT_CALENDAR_EVENT,
                            event_id,
                            user_id,
                            subject,
                            body_content,
                            start_time,
                            end_time,
                            location,
                            join_url,
                            web_link,
                            organizer,
                            full_event_json,
                        )

                        parsed_events.append(
                            CalendarEvent(
                                id=event_id,
                                subject=subject,
                                body_content=body_content,
                                start_time=start_time,
                                end_time=end_time,
                                location=location,
                                join_url=join_url,
                                web_link=web_link,
                                organizer=organizer,
                            )
                        )

            logger.info(
                f"Synced {len(parsed_events)} calendar events for user {user_id}."
            )
            return parsed_events

    # NOTE: Requires User Auth
    @router.get("/", response_model=List[CalendarEvent])
    async def get_calendar(payload: dict = Depends(get_current_user_payload)):
        """
        Get the calender from our database
        """
        with log_step(LOG_STEP):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid user session.")

            if not database.DB_POOL:
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                rows = await conn.fetch(SQL_GET_CALENDAR_EVENTS_BY_USER_ID, user_id)

            events = []
            for row in rows:
                events.append(
                    CalendarEvent(
                        id=row["id"],
                        subject=row["subject"],
                        body_content=row["body_content"],
                        start_time=row["start_time"],
                        end_time=row["end_time"],
                        location=row["location"],
                        join_url=row["join_url"],
                        web_link=row["web_link"],
                        organizer=row["organizer"],
                    )
                )

            return events

    return router
