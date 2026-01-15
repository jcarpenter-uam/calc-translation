import logging
import random
import uuid
from datetime import datetime
from typing import Optional

from core import database
from core.database import (
    SQL_GET_MEETING_AUTH_BY_READABLE_ID,
    SQL_INSERT_MEETING,
    SQL_UPDATE_MEETING_START,
)
from core.logging_setup import log_step
from fastapi import HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

LOG_STEP = "INT-STANDALONE"


class StandaloneAuthRequest(BaseModel):
    """Matches the JSON body from the frontend for standalone auth"""

    meeting_id: Optional[str] = None
    passcode: Optional[str] = None
    host: bool = False


class StandaloneAuthResponse(BaseModel):
    """Matches the JSON response the frontend expects"""

    sessionId: str
    token: str
    type: str
    readableId: Optional[str] = None


async def authenticate_standalone_session(
    request: StandaloneAuthRequest,
) -> str:
    """
    Authenticates a standalone session against the database using
    Meeting ID (readable) and Passcode.

    Returns:
        str: The meeting UUID if authentication is successful.
    """
    if not request.meeting_id:
        raise HTTPException(
            status_code=400, detail="Meeting ID is required for joining."
        )

    async with database.DB_POOL.acquire() as conn:
        with log_step(LOG_STEP):
            logger.info(f"Authenticating via meeting_id: {request.meeting_id}")
            row = await conn.fetchrow(
                SQL_GET_MEETING_AUTH_BY_READABLE_ID,
                "standalone",
                request.meeting_id,
            )

            if not row:
                logger.warning(
                    f"Auth failed: Meeting ID not found: {request.meeting_id}"
                )
                raise HTTPException(status_code=404, detail="Meeting ID not found.")

            meeting_uuid, stored_passcode = row[0], row[1]

            if stored_passcode and stored_passcode != (request.passcode or ""):
                logger.warning(
                    f"Auth failed: Incorrect passcode for meeting {meeting_uuid}"
                )
                raise HTTPException(
                    status_code=401, detail="Incorrect passcode for the meeting."
                )

            logger.info(f"Auth successful for standalone. UUID: {meeting_uuid}")
            return meeting_uuid


async def create_standalone_session() -> tuple[str, str]:
    """
    Creates a new standalone meeting record in the DB.

    Returns:
        tuple[str, str]: (meeting_uuid, readable_id)
    """
    meeting_uuid = str(uuid.uuid4())
    readable_id = str(random.randint(100000000, 999999999))
    now = datetime.now()

    with log_step(LOG_STEP):
        async with database.DB_POOL.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM MEETINGS WHERE platform = 'standalone' AND readable_id = $1",
                readable_id,
            )
            if row:
                readable_id = str(random.randint(100000000, 999999999))

            await conn.execute(
                SQL_INSERT_MEETING,
                meeting_uuid,
                None,
                "",
                "standalone",
                readable_id,
                now,
                None,
            )

            await conn.execute(SQL_UPDATE_MEETING_START, now, meeting_uuid)

            logger.info(
                f"Created standalone meeting {meeting_uuid} (ID: {readable_id})"
            )

    return meeting_uuid, readable_id
