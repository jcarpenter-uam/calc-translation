import logging
import uuid
from datetime import datetime
from typing import Optional, List
from urllib.parse import urlparse

from core import database
from core.config import settings
from core.database import SQL_GET_INTEGRATION, SQL_INSERT_MEETING
from core.logging_setup import log_step
from fastapi import HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

LOG_STEP = "INT-STANDALONE"


class StandaloneAuthRequest(BaseModel):
    """Matches the JSON body from the frontend for standalone auth"""

    join_url: Optional[str] = None
    host: bool = False
    language_hints: Optional[List[str]] = None


class StandaloneAuthResponse(BaseModel):
    """Matches the JSON response the frontend expects"""

    sessionId: str
    token: str
    type: str
    joinUrl: Optional[str] = None


async def authenticate_standalone_session(
    request: StandaloneAuthRequest,
) -> str:
    """
    Authenticates a standalone session using the Join URL.
    Parses the UUID from the URL and verifies it exists.
    """
    search_id = None

    if request.join_url:
        try:
            parsed = urlparse(request.join_url)
            if parsed.path:
                path_parts = parsed.path.strip("/").split("/")
                search_id = path_parts[-1]
            else:
                search_id = request.join_url
        except Exception:
            search_id = request.join_url

    if not search_id:
        raise HTTPException(status_code=400, detail="A Join URL is required.")

    async with database.DB_POOL.acquire() as conn:
        with log_step(LOG_STEP):
            logger.info(f"Authenticating standalone via UUID: {search_id}")

            row_by_uuid = await conn.fetchrow(
                "SELECT id FROM MEETINGS WHERE id = $1 AND platform = 'standalone'",
                search_id,
            )

            if row_by_uuid:
                logger.info(f"Auth successful via UUID: {search_id}")
                return row_by_uuid["id"]

            logger.warning(f"Auth failed: Meeting not found for input: {search_id}")
            raise HTTPException(status_code=404, detail="Meeting not found.")


async def create_standalone_session(user_id: str, language_hints: Optional[List[str]] = None) -> tuple[str, str]:
    """
    Creates a new standalone meeting record in the DB.
    Uses the host's existing 'microsoft' integration to link the meeting.

    Returns:
        tuple[str, str]: (meeting_uuid, join_url)
    """
    meeting_uuid = str(uuid.uuid4())

    base_url = settings.APP_BASE_URL.rstrip("/")
    join_url = f"{base_url}/sessions/standalone/{meeting_uuid}"

    now = datetime.now()

    with log_step(LOG_STEP):
        async with database.DB_POOL.acquire() as conn:
            row_integration = await conn.fetchrow(
                SQL_GET_INTEGRATION, user_id, "microsoft"
            )

            if not row_integration:
                row_integration = await conn.fetchrow(
                    SQL_GET_INTEGRATION, user_id, "google"
                )

            if not row_integration:
                logger.error(
                    f"User {user_id} has no valid integration (Microsoft/Google). Cannot create standalone session."
                )
                raise HTTPException(
                    status_code=400,
                    detail="User must be authenticated with a valid provider (Microsoft or Google) to host.",
                )

            integration_id = row_integration["id"]

            await conn.execute(
                SQL_INSERT_MEETING,
                meeting_uuid,
                integration_id,
                None,
                "standalone",
                None,
                now,
                join_url,
                None,
                language_hints,
            )

            logger.info(
                f"Created standalone meeting {meeting_uuid} for host {user_id} (Linked to IntID: {integration_id})"
            )

    return meeting_uuid, join_url
