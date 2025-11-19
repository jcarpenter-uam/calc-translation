import base64
import logging
import time
import urllib.parse

import aiosqlite
import httpx
from core.config import settings
from core.database import (
    DB_PATH,
    SQL_GET_INTEGRATION,
    SQL_GET_MEETING_AUTH_BY_READABLE_ID,
    SQL_GET_MEETING_BY_JOIN_URL,
    SQL_INSERT_MEETING,
    SQL_UPSERT_INTEGRATION,
    db_lock,
)
from core.logging_setup import log_step
from fastapi import HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ZoomAuthRequest(BaseModel):
    """Matches the JSON body from the frontend"""

    meetingid: str | None = None
    meetingpass: str | None = None
    join_url: str | None = None


class ZoomAuthResponse(BaseModel):
    """Matches the JSON response the frontend expects"""

    meetinguuid: str
    token: str


ZM_RTMS_CLIENT = settings.ZM_RTMS_CLIENT
ZM_RTMS_SECRET = settings.ZM_RTMS_SECRET


async def exchange_code_for_token(code: str, redirect_uri: str, user_id: str):
    """
    Exchanges an authorization code for an access token and refresh token.
    Stores them in the INTEGRATIONS table for the specific user.
    """
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

        expires_at = int(time.time()) + token_data["expires_in"]

        async with db_lock:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    SQL_UPSERT_INTEGRATION,
                    (
                        user_id,
                        "zoom",
                        token_data["access_token"],
                        token_data["refresh_token"],
                        expires_at,
                    ),
                )
                await db.commit()

        with log_step("ZOOM"):
            logger.warning(
                f"Successfully received and stored Zoom tokens in DB for user {user_id}."
            )

    except httpx.HTTPStatusError as e:
        with log_step("ZOOM"):
            logger.error(
                f"HTTP error exchanging Zoom token: {e.response.text}", exc_info=True
            )
        raise HTTPException(
            status_code=500, detail="Failed to exchange token with Zoom"
        )
    except Exception as e:
        with log_step("ZOOM"):
            logger.error(
                f"An unexpected error occurred during token exchange: {e}",
                exc_info=True,
            )
        raise HTTPException(status_code=500, detail="An internal error occurred")


async def get_valid_access_token(user_id: str) -> tuple[str, int]:
    """
    Gets a valid access token from the DB for a specific user,
    refreshing it if necessary.

    Returns:
        tuple[str, int]: (access_token, integration_id)
    """
    async with db_lock:
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(SQL_GET_INTEGRATION, (user_id, "zoom")) as cursor:
                    integration_row = await cursor.fetchone()

            if not integration_row:
                with log_step("ZOOM"):
                    logger.error(f"No Zoom integration found for user {user_id}.")
                raise HTTPException(
                    status_code=404,
                    detail="Zoom integration not found. Please (re)install the app.",
                )

            integration_id, access_token, refresh_token, expires_at = integration_row
            expires_at = expires_at or 0

            if time.time() > (expires_at - 60):
                with log_step("ZOOM"):
                    logger.info(f"Zoom token for user {user_id} expired. Refreshing...")

                if not refresh_token:
                    with log_step("ZOOM"):
                        logger.error(
                            f"No refresh token found for user {user_id}. App needs to be re-installed."
                        )
                    raise HTTPException(
                        status_code=500,
                        detail="Zoom app not configured. Please (re)install.",
                    )

                creds = f"{ZM_RTMS_CLIENT}:{ZM_RTMS_SECRET}"
                basic_auth_header = f"Basic {base64.b64encode(creds.encode()).decode()}"
                token_url = "https://zoom.us/oauth/token"
                headers = {
                    "Authorization": basic_auth_header,
                    "Content-Type": "application/x-www-form-urlencoded",
                }
                data = {
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                }

                async with httpx.AsyncClient() as client:
                    response = await client.post(token_url, headers=headers, data=data)

                response.raise_for_status()
                new_token_data = response.json()

                new_access_token = new_token_data["access_token"]
                new_refresh_token = new_token_data["refresh_token"]
                new_expires_at = int(time.time()) + new_token_data["expires_in"]

                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        SQL_UPSERT_INTEGRATION,
                        (
                            user_id,
                            "zoom",
                            new_access_token,
                            new_refresh_token,
                            new_expires_at,
                        ),
                    )
                    await db.commit()

                with log_step("ZOOM"):
                    logger.info(
                        f"Successfully refreshed and stored new Zoom tokens for user {user_id}."
                    )

                return new_access_token, integration_id

            return access_token, integration_id

        except Exception as e:
            with log_step("ZOOM"):
                logger.error(
                    f"Failed to get/refresh Zoom token for user {user_id}: {e}",
                    exc_info=True,
                )
            raise HTTPException(
                status_code=500,
                detail="Failed to get valid Zoom token. Please reinstall app if problem persists.",
            )


async def get_meeting_data(meeting_uuid: str, user_id: str) -> str:
    """
    Queries the Zoom API for meeting data using the meeting UUID
    """
    unaltered_uuid = meeting_uuid.replace("_", "/")
    first_pass = urllib.parse.quote(unaltered_uuid, safe="")
    encoded_uuid = urllib.parse.quote(first_pass, safe="")

    try:
        access_token, integration_id = await get_valid_access_token(user_id)

        meeting_url = f"https://api.zoom.us/v2/meetings/{encoded_uuid}"
        headers = {"Authorization": f"Bearer {access_token}"}

        with log_step("ZOOM"):
            logger.info(f"Calling Zoom API: GET {meeting_url} for user {user_id}")

        async with httpx.AsyncClient() as client:
            response = await client.get(meeting_url, headers=headers)

        if response.status_code == 404:
            with log_step("ZOOM"):
                logger.error(
                    f"Meeting UUID {encoded_uuid} not found via Zoom API (URL: {meeting_url})."
                )
            raise HTTPException(status_code=404, detail="Meeting (UUID) not found")

        response.raise_for_status()
        meeting_data = response.json()

        real_uuid = meeting_data.get("uuid")
        meeting_id = meeting_data.get("id")
        start_time = meeting_data.get("created_at")
        join_url = meeting_data.get("join_url")
        passcode = meeting_data.get("pstn_password", "")

        if not real_uuid:
            with log_step("ZOOM"):
                logger.error(
                    f"Zoom API did not return a UUID for meeting {encoded_uuid}"
                )
            raise HTTPException(
                500, "Could not retrieve meeting's unique ID from Zoom."
            )

        async with db_lock:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    SQL_INSERT_MEETING,
                    (
                        real_uuid,
                        integration_id,
                        passcode,
                        "zoom",
                        str(meeting_id),
                        start_time,
                        join_url,
                    ),
                )
                await db.commit()
                with log_step("ZOOM"):
                    logger.info(
                        f"Successfully fetched and saved/updated meeting {encoded_uuid}"
                    )

        return real_uuid

    except HTTPException as e:
        raise e
    except Exception as e:
        with log_step("ZOOM"):
            logger.error(
                f"Failed to get_meeting_data for UUID {encoded_uuid}: {e}",
                exc_info=True,
            )
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while fetching meeting data",
        )


async def authenticate_zoom_session(request: ZoomAuthRequest) -> str:
    """
    Authenticates a session against the database using either
    Join URL or Meeting ID/Passcode. This is NOT scoped to a user.

    Returns:
        str: The meeting UUID if authentication is successful.
    Raises:
        HTTPException: If authentication fails (e.g., not found, wrong passcode).
    """
    async with db_lock:
        async with aiosqlite.connect(DB_PATH) as db:
            if request.join_url:
                with log_step("ZOOM"):
                    logger.info(f"Authenticating via join_url...")
                async with db.execute(
                    SQL_GET_MEETING_BY_JOIN_URL, (request.join_url,)
                ) as cursor:
                    row = await cursor.fetchone()

                if not row:
                    with log_step("ZOOM"):
                        logger.warning(
                            f"Auth failed: Meeting not found for join_url: {request.join_url}"
                        )
                    raise HTTPException(
                        status_code=404,
                        detail="Meeting not found for the provided Join URL.",
                    )

                meeting_uuid = row[0]
                logger.info(f"Auth successful for join_url. UUID: {meeting_uuid}")
                return meeting_uuid

            elif request.meetingid:
                with log_step("ZOOM"):
                    logger.info(f"Authenticating via meetingid: {request.meetingid}")
                async with db.execute(
                    SQL_GET_MEETING_AUTH_BY_READABLE_ID,
                    ("zoom", request.meetingid),
                ) as cursor:
                    row = await cursor.fetchone()

                if not row:
                    with log_step("ZOOM"):
                        logger.warning(
                            f"Auth failed: Meeting ID not found: {request.meetingid}"
                        )
                    raise HTTPException(status_code=404, detail="Meeting ID not found.")

                meeting_uuid, stored_passcode = row

                if stored_passcode != (request.meetingpass or ""):
                    with log_step("ZOOM"):
                        logger.warning(
                            f"Auth failed: Incorrect passcode for meeting {meeting_uuid}"
                        )
                    raise HTTPException(
                        status_code=401, detail="Incorrect passcode for the meeting."
                    )

                logger.info(f"Auth successful for meetingid. UUID: {meeting_uuid}")
                return meeting_uuid

            else:
                raise HTTPException(
                    status_code=400,
                    detail="Either 'join_url' or 'meetingid' must be provided.",
                )
