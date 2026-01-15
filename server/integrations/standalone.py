import logging
import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from core import database
from core.config import settings
from core.database import SQL_INSERT_MEETING, SQL_UPDATE_MEETING_START
from core.logging_setup import log_step
from fastapi import HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

LOG_STEP = "INT-STANDALONE"


class StandaloneAuthRequest(BaseModel):
    """Matches the JSON body from the frontend for standalone auth"""

    join_url: Optional[str] = None
    host: bool = False


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


async def create_standalone_session() -> tuple[str, str]:
    """
    Creates a new standalone meeting record in the DB.
    Generates and stores the Join URL.

    Returns:
        tuple[str, str]: (meeting_uuid, join_url)
    """
    meeting_uuid = str(uuid.uuid4())

    base_url = settings.APP_BASE_URL.rstrip("/")
    join_url = f"{base_url}/sessions/standalone/{meeting_uuid}"

    now = datetime.now()

    with log_step(LOG_STEP):
        async with database.DB_POOL.acquire() as conn:
            await conn.execute(
                SQL_INSERT_MEETING,
                meeting_uuid,
                None,
                None,
                "standalone",
                None,
                now,
                join_url,
            )

            await conn.execute(SQL_UPDATE_MEETING_START, now, meeting_uuid)

            logger.info(f"Created standalone meeting {meeting_uuid}")

    return meeting_uuid, join_url
