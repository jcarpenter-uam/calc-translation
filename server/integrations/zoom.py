import base64
import logging
import re
import time
import urllib.parse
from datetime import datetime

import httpx
from core.config import settings
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import HTTPException
from models.integrations import Integration
from models.meetings import Meeting
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger(__name__)


class ZoomAuthRequest(BaseModel):
    meetingid: str | None = None
    meetingpass: str | None = None
    join_url: str | None = None


class ZoomAuthResponse(BaseModel):
    meetinguuid: str
    token: str


ZM_RTMS_CLIENT = settings.ZM_RTMS_CLIENT
ZM_RTMS_SECRET = settings.ZM_RTMS_SECRET
LOG_STEP = "INT-ZOOM"


async def exchange_code_for_token(code: str, redirect_uri: str, user_id: str):
    with log_step(LOG_STEP):
        creds = f"{ZM_RTMS_CLIENT}:{ZM_RTMS_SECRET}"
        basic_auth_header = f"Basic {base64.b64encode(creds.encode()).decode()}"

        token_url = "https://zoom.us/oauth/token"
        headers = {
            "Authorization": basic_auth_header,
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(token_url, headers=headers, data=data)
            response.raise_for_status()
            token_data = response.json()

            async with httpx.AsyncClient() as client:
                user_resp = await client.get(
                    "https://api.zoom.us/v2/users/me",
                    headers={"Authorization": f"Bearer {token_data['access_token']}"},
                )
                user_resp.raise_for_status()
                zoom_user_id = user_resp.json().get("id")

            expires_at = int(time.time()) + token_data["expires_in"]

            async with AsyncSessionLocal() as session:
                stmt = insert(Integration).values(
                    user_id=user_id,
                    platform="zoom",
                    platform_user_id=zoom_user_id,
                    access_token=token_data["access_token"],
                    refresh_token=token_data["refresh_token"],
                    expires_at=expires_at,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=[Integration.user_id, Integration.platform],
                    set_={
                        "platform_user_id": stmt.excluded.platform_user_id,
                        "access_token": stmt.excluded.access_token,
                        "refresh_token": stmt.excluded.refresh_token,
                        "expires_at": stmt.excluded.expires_at,
                    },
                )
                await session.execute(stmt)
                await session.commit()

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error exchanging Zoom token: {e.response.text}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to exchange token with Zoom")
        except Exception as e:
            logger.error(f"An unexpected error occurred during token exchange: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="An internal error occurred")


async def _ensure_active_token(integration: Integration) -> tuple[str, int]:
    expires_at = integration.expires_at or 0
    if time.time() < (expires_at - 60):
        return integration.access_token, integration.id

    with log_step(LOG_STEP):
        if not integration.refresh_token:
            raise HTTPException(status_code=500, detail="Zoom refresh token missing. Please reinstall app.")

        creds = f"{ZM_RTMS_CLIENT}:{ZM_RTMS_SECRET}"
        basic_auth_header = f"Basic {base64.b64encode(creds.encode()).decode()}"

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://zoom.us/oauth/token",
                    headers={
                        "Authorization": basic_auth_header,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data={"grant_type": "refresh_token", "refresh_token": integration.refresh_token},
                )
            response.raise_for_status()
            new_data = response.json()

            new_access_token = new_data["access_token"]
            new_refresh_token = new_data.get("refresh_token", integration.refresh_token)
            new_expires_at = int(time.time()) + new_data["expires_in"]

            async with AsyncSessionLocal() as session:
                await session.execute(
                    update(Integration)
                    .where(Integration.id == integration.id)
                    .values(
                        access_token=new_access_token,
                        refresh_token=new_refresh_token,
                        expires_at=new_expires_at,
                    )
                )
                await session.commit()

            return new_access_token, integration.id

        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error refreshing Zoom token: {e.response.text}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to refresh Zoom token.")
        except Exception as e:
            logger.error(f"Unexpected error refreshing Zoom token: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to get valid Zoom token.")


async def get_access_token_by_zoom_id(zoom_user_id: str) -> tuple[str, int]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Integration).where(
                Integration.platform == "zoom",
                Integration.platform_user_id == zoom_user_id,
            )
        )
        integration = result.scalar_one_or_none()

    if not integration:
        raise HTTPException(status_code=404, detail=f"No integration found for Zoom User ID {zoom_user_id}")

    return await _ensure_active_token(integration)


async def get_valid_access_token(user_id: str) -> tuple[str, int]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Integration).where(
                Integration.user_id == user_id,
                Integration.platform == "zoom",
            )
        )
        integration = result.scalar_one_or_none()

    if not integration:
        raise HTTPException(status_code=404, detail="Zoom integration not found for this user.")

    return await _ensure_active_token(integration)


async def get_meeting_data(
    meeting_uuid: str | None = None,
    user_id: str = None,
    zoom_host_id: str = None,
    meeting_identifier: str | None = None,
    is_waiting_room: bool | None = None,
) -> str:
    if meeting_identifier and not meeting_uuid:
        meeting_uuid = meeting_identifier

    first_pass = urllib.parse.quote(meeting_uuid, safe="")
    encoded_uuid = urllib.parse.quote(first_pass, safe="")

    integration_id = None

    with log_step(LOG_STEP):
        try:
            if zoom_host_id:
                access_token, integration_id = await get_access_token_by_zoom_id(zoom_host_id)
            elif user_id:
                access_token, integration_id = await get_valid_access_token(user_id)
            else:
                raise Exception("Must provide user_id or zoom_host_id to fetch Zoom data.")

            meeting_url = f"https://api.zoom.us/v2/meetings/{encoded_uuid}"
            headers = {"Authorization": f"Bearer {access_token}"}

            async with httpx.AsyncClient() as client:
                response = await client.get(meeting_url, headers=headers)

            if response.status_code != 200:
                raise Exception(f"Zoom API returned status {response.status_code}")

            meeting_data = response.json()
            real_uuid = meeting_data.get("uuid", meeting_uuid)
            meeting_id = meeting_data.get("id", "")
            start_time_str = meeting_data.get("created_at")
            join_url = meeting_data.get("join_url")
            passcode = meeting_data.get("pstn_password", "")
            topic = meeting_data.get("topic", "")

            parsed_start_time = datetime.fromisoformat(start_time_str) if start_time_str else None

            async with AsyncSessionLocal() as session:
                stmt = insert(Meeting).values(
                    id=real_uuid,
                    integration_id=integration_id,
                    passcode=passcode,
                    platform="zoom",
                    readable_id=str(meeting_id),
                    meeting_time=parsed_start_time,
                    join_url=join_url,
                    topic=topic,
                    language_hints=[],
                )
                stmt = stmt.on_conflict_do_nothing(index_elements=[Meeting.id])
                await session.execute(stmt)
                await session.commit()

            return real_uuid

        except Exception:
            real_uuid = meeting_uuid
            try:
                async with AsyncSessionLocal() as session:
                    stmt = insert(Meeting).values(
                        id=real_uuid,
                        integration_id=integration_id,
                        passcode="",
                        platform="zoom",
                        readable_id=real_uuid,
                        meeting_time=datetime.now(),
                        join_url=None,
                        topic=None,
                        language_hints=[],
                    )
                    stmt = stmt.on_conflict_do_nothing(index_elements=[Meeting.id])
                    await session.execute(stmt)
                    await session.commit()
                return real_uuid
            except Exception as db_e:
                logger.error(f"Critical failure creating fallback meeting: {db_e}", exc_info=True)
                raise HTTPException(status_code=500, detail="Server error: Could not initialize meeting session.")


async def authenticate_zoom_session(request: ZoomAuthRequest, user_id: str = None) -> str:
    with log_step(LOG_STEP):
        async with AsyncSessionLocal() as session:
            if request.join_url:
                row = await session.execute(
                    select(Meeting.id)
                    .where(Meeting.join_url.contains(request.join_url))
                    .order_by(Meeting.started_at.desc())
                    .limit(1)
                )
                meeting_uuid = row.scalar_one_or_none()

                if not meeting_uuid:
                    match = re.search(r"/j/(\d+)", request.join_url)
                    if match and user_id:
                        return await get_meeting_data(meeting_uuid=match.group(1), user_id=user_id)
                    raise HTTPException(status_code=404, detail="Meeting not found for the provided Join URL.")
                return meeting_uuid

            if request.meetingid:
                row = await session.execute(
                    select(Meeting.id, Meeting.passcode)
                    .where(Meeting.platform == "zoom", Meeting.readable_id == request.meetingid)
                    .order_by(Meeting.started_at.desc())
                    .limit(1)
                )
                rec = row.first()

                if not rec:
                    if user_id:
                        try:
                            return await get_meeting_data(meeting_uuid=request.meetingid, user_id=user_id)
                        except Exception:
                            pass
                    raise HTTPException(status_code=404, detail="Meeting ID not found.")

                if rec.passcode != (request.meetingpass or ""):
                    raise HTTPException(status_code=401, detail="Incorrect passcode for the meeting.")
                return rec.id

            raise HTTPException(status_code=400, detail="Either 'join_url' or 'meetingid' must be provided.")
