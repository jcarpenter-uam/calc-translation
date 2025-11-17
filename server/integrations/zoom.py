import base64
import logging
import time

import aiosqlite
import httpx
from core.config import settings
from core.database import (
    DB_PATH,
    SQL_GET_INTEGRATION,
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

    meetingid: str
    meetingpass: str | None = None


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
            logger.error(
                f"Failed to get/refresh Zoom token for user {user_id}: {e}",
                exc_info=True,
            )
            raise HTTPException(
                status_code=500,
                detail="Failed to get valid Zoom token. Please reinstall app if problem persists.",
            )


async def verify_zoom_credentials(request: ZoomAuthRequest, user_id: str) -> str:
    """
    Checks the meeting ID and passcode against the Zoom API
    using the user's specific OAuth token.
    Saves the meeting to the MEETINGS table if valid.

    Returns:
        str: The meeting UUID.
    """
    normalized_id = request.meetingid.replace(" ", "")
    request_passcode = request.meetingpass or ""

    try:
        access_token, integration_id = await get_valid_access_token(user_id)

        meeting_url = f"https://api.zoom.us/v2/meetings/{normalized_id}"
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(meeting_url, headers=headers)

        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Meeting ID not found")

        response.raise_for_status()
        meeting_data = response.json()

        logger.info(f"Full Zoom API response for {normalized_id}: {meeting_data}")

        real_passcode = meeting_data.get("password", "")
        real_uuid = meeting_data.get("uuid")
        start_time = meeting_data.get(
            "created_at"
        )  # TODO: Ensure this is robut for one time and reoccuring meetings
        join_url = meeting_data.get("join_url")

        if not real_uuid:
            logger.error(f"Zoom API did not return a UUID for meeting {normalized_id}")
            raise HTTPException(
                500, "Could not retrieve meeting's unique ID from Zoom."
            )

        if request_passcode != real_passcode:
            raise HTTPException(status_code=401, detail="Invalid Passcode")

        async with db_lock:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    SQL_INSERT_MEETING,
                    (
                        real_uuid,
                        integration_id,
                        "zoom",
                        normalized_id,
                        start_time,
                        join_url,
                    ),
                )
                await db.commit()
                logger.info(
                    f"Successfully verified and saved/updated meeting {real_uuid}."
                )

        return real_uuid

    except HTTPException as e:
        raise e
    except Exception as e:
        with log_step("ZOOM"):
            logger.error(f"Failed to verify Zoom credentials: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="An internal error occurred while verifying meeting"
        )
