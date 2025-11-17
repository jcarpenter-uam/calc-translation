import base64
import logging
import os
import time

import httpx
from core.config import settings
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

TOKEN_STORE = {
    "access_token": None,
    "refresh_token": None,
    "expires_at": 0,
}


async def exchange_code_for_token(code: str, redirect_uri: str):
    """
    Exchanges an authorization code for an access token and refresh token.
    Stores them in the TOKEN_STORE.
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

        TOKEN_STORE["access_token"] = token_data["access_token"]
        TOKEN_STORE["refresh_token"] = token_data["refresh_token"]
        TOKEN_STORE["expires_at"] = int(time.time()) + token_data["expires_in"]

        # TODO: Persist these tokens in database/file
        with log_step("ZOOM"):
            logger.warning("Successfully received and stored Zoom tokens.")

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


async def get_valid_access_token() -> str:
    """
    Gets a valid access token, refreshing it if necessary.
    This is the core of the new auth logic.
    """

    if time.time() > (TOKEN_STORE["expires_at"] - 60):
        if not TOKEN_STORE["refresh_token"]:
            with log_step("ZOOM"):
                logger.error("No refresh token found. App needs to be re-installed.")
            raise HTTPException(
                status_code=500, detail="Zoom app not configured. Please (re)install."
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
            "refresh_token": TOKEN_STORE["refresh_token"],
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(token_url, headers=headers, data=data)

            response.raise_for_status()
            new_token_data = response.json()

            TOKEN_STORE["access_token"] = new_token_data["access_token"]
            TOKEN_STORE["refresh_token"] = new_token_data["refresh_token"]
            TOKEN_STORE["expires_at"] = int(time.time()) + new_token_data["expires_in"]

            # TODO: Persist these new tokens to your database/file

        except Exception as e:
            with log_step("ZOOM"):
                logger.error(f"Failed to refresh Zoom token: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail="Failed to refresh Zoom token. Please reinstall app.",
            )

    return TOKEN_STORE["access_token"]


async def verify_zoom_credentials(request: ZoomAuthRequest) -> str:
    """
    Checks the meeting ID and passcode against the Zoom API
    using the installed app's OAuth token.
    """
    normalized_id = request.meetingid.replace(" ", "")
    request_passcode = request.meetingpass or ""

    try:
        access_token = await get_valid_access_token()

        meeting_url = f"https://api.zoom.us/v2/meetings/{normalized_id}"
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(meeting_url, headers=headers)

        if response.status_code == 404:
            raise HTTPException(status_code=404, detail="Meeting ID not found")

        response.raise_for_status()
        meeting_data = response.json()

        real_passcode = meeting_data.get("password", "")
        real_uuid = meeting_data.get("uuid")

        if request_passcode != real_passcode:
            raise HTTPException(status_code=401, detail="Invalid Passcode")

        return real_uuid

    except HTTPException as e:
        raise e
    except Exception as e:
        with log_step("ZOOM"):
            logger.error(f"Failed to verify Zoom credentials: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="An internal error occurred while verifying meeting"
        )
