import logging

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
        return session_id
    except Exception as e:
        logger.error(f"Error in test session authentication: {e}", exc_info=True)
        raise
