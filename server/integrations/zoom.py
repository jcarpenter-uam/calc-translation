import base64
import logging
import re
import time
import urllib.parse
from datetime import datetime, timezone

import httpx
from core import database
from core.config import settings
from core.database import (
    SQL_GET_MEETING_AUTH_BY_READABLE_ID,
    SQL_GET_MEETING_BY_JOIN_URL,
    SQL_INSERT_MEETING,
    SQL_UPSERT_INTEGRATION,
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
LOG_STEP = "INT-ZOOM"


async def exchange_code_for_token(code: str, redirect_uri: str, user_id: str):
    """
    Exchanges an authorization code for an access token and refresh token.
    Stores them in the INTEGRATIONS table for the specific user.
    """
    with log_step(LOG_STEP):
        logger.info(f"Exchanging Zoom OAuth code for user {user_id}.")
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

            async with database.DB_POOL.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        SQL_UPSERT_INTEGRATION,
                        user_id,
                        "zoom",
                        zoom_user_id,
                        token_data["access_token"],
                        token_data["refresh_token"],
                        expires_at,
                    )

            logger.info(
                f"Successfully received and stored Zoom tokens in DB for user {user_id}."
            )

        except httpx.HTTPStatusError as e:
            logger.error(
                f"HTTP error exchanging Zoom token: {e.response.text}", exc_info=True
            )
            raise HTTPException(
                status_code=500, detail="Failed to exchange token with Zoom"
            )
        except Exception as e:
            logger.error(
                f"An unexpected error occurred during token exchange: {e}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail="An internal error occurred")


async def _ensure_active_token(integration_row) -> tuple[str, int]:
    """
    Takes a DB row (id, access_token, refresh_token, expires_at, user_id),
    checks expiry, refreshes if needed, and returns valid (access_token, integration_id).
    """
    integration_id, access_token, refresh_token, expires_at, user_id = integration_row
    expires_at = expires_at or 0

    if time.time() < (expires_at - 60):
        logger.debug(f"Zoom token for integration {integration_id} is still valid.")
        return access_token, integration_id

    with log_step(LOG_STEP):
        logger.info(
            f"Zoom token for integration {integration_id} (User {user_id}) expired. Refreshing..."
        )

        if not refresh_token:
            logger.error(
                f"Zoom refresh token missing for integration {integration_id}."
            )
            raise HTTPException(
                status_code=500,
                detail="Zoom refresh token missing. Please reinstall app.",
            )

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
                    data={
                        "grant_type": "refresh_token",
                        "refresh_token": refresh_token,
                    },
                )

            response.raise_for_status()
            new_data = response.json()

            new_access_token = new_data["access_token"]
            new_refresh_token = new_data.get("refresh_token", refresh_token)
            new_expires_at = int(time.time()) + new_data["expires_in"]

            async with database.DB_POOL.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE INTEGRATIONS 
                    SET access_token = $1, refresh_token = $2, expires_at = $3
                    WHERE id = $4
                    """,
                    new_access_token,
                    new_refresh_token,
                    new_expires_at,
                    integration_id,
                )

            logger.info(
                f"Successfully refreshed and stored new Zoom tokens for integration {integration_id}."
            )

            return new_access_token, integration_id

        except httpx.HTTPStatusError as e:
            logger.error(
                f"HTTP error refreshing Zoom token for integration {integration_id}: {e.response.text}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail="Failed to refresh Zoom token.")
        except Exception as e:
            logger.error(
                f"Unexpected error refreshing Zoom token for integration {integration_id}: {e}",
                exc_info=True,
            )
            raise HTTPException(
                status_code=500,
                detail="Failed to get valid Zoom token. Please reinstall app if problem persists.",
            )


async def get_access_token_by_zoom_id(zoom_user_id: str) -> tuple[str, int]:
    """
    Finds an integration record using the Zoom User ID (host_id)
    and returns a valid access token, refreshing if needed.
    """
    SQL_GET_BY_PLATFORM_ID = """
        SELECT id, access_token, refresh_token, expires_at, user_id
        FROM INTEGRATIONS
        WHERE platform = 'zoom' AND platform_user_id = $1
    """
    async with database.DB_POOL.acquire() as conn:
        row = await conn.fetchrow(SQL_GET_BY_PLATFORM_ID, zoom_user_id)

    if not row:
        with log_step(LOG_STEP):
            logger.warning(f"No integration found for Zoom User ID {zoom_user_id}")
        raise HTTPException(
            status_code=404,
            detail=f"No integration found for Zoom User ID {zoom_user_id}",
        )

    return await _ensure_active_token(row)


async def get_valid_access_token(user_id: str) -> tuple[str, int]:
    """
    Gets a valid access token from the DB for a specific internal user_id,
    refreshing it if necessary.

    Returns:
        tuple[str, int]: (access_token, integration_id)
    """
    async with database.DB_POOL.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, access_token, refresh_token, expires_at, user_id FROM INTEGRATIONS WHERE user_id = $1 AND platform = 'zoom'",
            user_id,
        )

    if not row:
        with log_step(LOG_STEP):
            logger.warning(f"No Zoom integration found for user {user_id}.")
        raise HTTPException(
            status_code=404,
            detail="Zoom integration not found for this user. Please (re)install the app.",
        )

    return await _ensure_active_token(row)


async def get_meeting_data(
    meeting_uuid: str, user_id: str = None, zoom_host_id: str = None
) -> str:
    """
    Queries the Zoom API for meeting data using the meeting UUID.
    If the fetch fails for ANY reason (404, 500, network, auth), it falls back
    to creating a placeholder meeting record so the transcription session can proceed.
    """
    first_pass = urllib.parse.quote(meeting_uuid, safe="")
    encoded_uuid = urllib.parse.quote(first_pass, safe="")

    integration_id = None

    with log_step(LOG_STEP):
        try:
            if zoom_host_id:
                logger.debug(f"Getting meeting data using zoom_host_id: {zoom_host_id}")
                access_token, integration_id = await get_access_token_by_zoom_id(
                    zoom_host_id
                )
            elif user_id:
                logger.debug(f"Getting meeting data using user_id: {user_id}")
                access_token, integration_id = await get_valid_access_token(user_id)
            else:
                raise Exception(
                    "Must provide user_id or zoom_host_id to fetch Zoom data."
                )

            meeting_url = f"https://api.zoom.us/v2/meetings/{encoded_uuid}"
            headers = {"Authorization": f"Bearer {access_token}"}

            logger.info(
                f"Calling Zoom API: GET {meeting_url} for integration {integration_id}"
            )

            async with httpx.AsyncClient() as client:
                response = await client.get(meeting_url, headers=headers)

            if response.status_code != 200:
                logger.warning(
                    f"Zoom API returned status {response.status_code} for {encoded_uuid}. Triggering fallback."
                )
                raise Exception(f"Zoom API returned status {response.status_code}")

            meeting_data = response.json()

            real_uuid = meeting_data.get("uuid", meeting_uuid)
            meeting_id = meeting_data.get("id", "")
            start_time_str = meeting_data.get("created_at")
            join_url = meeting_data.get("join_url")
            passcode = meeting_data.get("pstn_password", "")

            parsed_start_time = None
            if start_time_str:
                parsed_start_time = datetime.fromisoformat(start_time_str)

            async with database.DB_POOL.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        SQL_INSERT_MEETING,
                        real_uuid,
                        integration_id,
                        passcode,
                        "zoom",
                        str(meeting_id),
                        parsed_start_time,
                        join_url,
                    )

            logger.info(
                f"Successfully fetched and saved/updated meeting {real_uuid} from Zoom API."
            )
            return real_uuid

        except Exception as e:
            logger.warning(
                f"Failed to fetch Zoom data for {encoded_uuid}: {e}. Creating fallback meeting record."
            )

            real_uuid = meeting_uuid

            try:
                async with database.DB_POOL.acquire() as conn:
                    async with conn.transaction():
                        await conn.execute(
                            SQL_INSERT_MEETING,
                            real_uuid,
                            integration_id,
                            "",
                            "zoom",
                            real_uuid,
                            datetime.now(),
                            None,
                        )

                logger.info(f"Created fallback meeting record for {real_uuid}")
                return real_uuid

            except Exception as db_e:
                logger.error(
                    f"Critical failure creating fallback meeting: {db_e}", exc_info=True
                )
                raise HTTPException(
                    status_code=500,
                    detail="Server error: Could not initialize meeting session.",
                )


async def authenticate_zoom_session(
    request: ZoomAuthRequest, user_id: str = None
) -> str:
    """
    Authenticates a session against the database using either
    Join URL or Meeting ID/Passcode.
    If not found in DB, attempts to fetch from Zoom API using the user's credentials.

    Returns:
        str: The meeting UUID if authentication is successful.
    Raises:
        HTTPException: If authentication fails (e.g., not found, wrong passcode).
    """
    async with database.DB_POOL.acquire() as conn:
        with log_step(LOG_STEP):
            if request.join_url:
                logger.info(f"Authenticating via join_url...")
                row = await conn.fetchrow(SQL_GET_MEETING_BY_JOIN_URL, request.join_url)

                if not row:
                    logger.warning(
                        f"Auth failed in DB for join_url. Attempting Zoom API fallback..."
                    )

                    match = re.search(r"/j/(\d+)", request.join_url)

                    if match and user_id:
                        readable_id = match.group(1)
                        try:
                            logger.info(
                                f"Detected Readable ID {readable_id}. Fetching from Zoom..."
                            )
                            meeting_uuid = await get_meeting_data(
                                meeting_uuid=readable_id,
                                user_id=user_id,
                            )
                            return meeting_uuid
                        except Exception as e:
                            logger.error(f"Zoom API fallback failed: {e}")
                    else:
                        logger.warning(
                            "Could not parse ID from URL or no user_id provided for fallback."
                        )

                    raise HTTPException(
                        status_code=404,
                        detail="Meeting not found for the provided Join URL.",
                    )

                meeting_uuid = row[0]
                logger.info(f"Auth successful for join_url. UUID: {meeting_uuid}")
                return meeting_uuid

            elif request.meetingid:
                logger.info(f"Authenticating via meetingid: {request.meetingid}")
                row = await conn.fetchrow(
                    SQL_GET_MEETING_AUTH_BY_READABLE_ID,
                    "zoom",
                    request.meetingid,
                )

                if not row:
                    logger.info(
                        f"Meeting ID {request.meetingid} not in DB. Attempting Zoom API fallback..."
                    )
                    if user_id:
                        try:
                            meeting_uuid = await get_meeting_data(
                                meeting_uuid=request.meetingid,
                                user_id=user_id,
                            )
                            return meeting_uuid
                        except Exception as e:
                            logger.warning(
                                f"Zoom API fallback failed for Meeting ID: {e}"
                            )
                            pass

                    logger.warning(
                        f"Auth failed: Meeting ID not found: {request.meetingid}"
                    )
                    raise HTTPException(status_code=404, detail="Meeting ID not found.")

                meeting_uuid, stored_passcode = row[0], row[1]

                if stored_passcode != (request.meetingpass or ""):
                    logger.warning(
                        f"Auth failed: Incorrect passcode for meeting {meeting_uuid}"
                    )
                    raise HTTPException(
                        status_code=401, detail="Incorrect passcode for the meeting."
                    )

                logger.info(f"Auth successful for meetingid. UUID: {meeting_uuid}")
                return meeting_uuid

            else:
                logger.warning("Auth request missing 'join_url' and 'meetingid'.")
                raise HTTPException(
                    status_code=400,
                    detail="Either 'join_url' or 'meetingid' must be provided.",
                )
