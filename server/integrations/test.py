import logging
from datetime import datetime

from core import database
from core.database import SQL_INSERT_MEETING
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class TestAuthRequest(BaseModel):
    session_id: str


async def authenticate_test_session(request: TestAuthRequest) -> str:
    """
    "Authenticates" a test session by retrieving its session_id.
    """
    try:
        session_id = request.session_id
        logger.info(f"Authenticating test session: {session_id}")

        await ensure_test_meeting(session_id)

        return session_id
    except Exception as e:
        logger.error(f"Error in test session authentication: {e}", exc_info=True)
        raise


async def ensure_test_meeting(session_id: str):
    """
    Ensures a meeting record exists for the test session so that
    transcripts can be saved (satisfying the Foreign Key constraint).
    """
    try:
        if not database.DB_POOL:
            logger.error("DB Pool not initialized, cannot save test meeting.")
            return

        async with database.DB_POOL.acquire() as conn:
            await conn.execute(
                SQL_INSERT_MEETING,
                session_id,
                None,
                "",
                "test",
                session_id,
                datetime.now(),
                None,
            )
        logger.debug(f"Ensured test meeting record exists for: {session_id}")
    except Exception as e:
        logger.error(f"Failed to create test meeting record: {e}", exc_info=True)
