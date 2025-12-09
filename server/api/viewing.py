import logging

from core import database
from core.authentication import get_current_user_payload, validate_client_token
from core.database import SQL_ADD_MEETING_LANGUAGE, SQL_GET_USER_BY_ID
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, Path, WebSocket, status
from services.connection_manager import ConnectionManager
from services.viewer import handle_viewer_session

logger = logging.getLogger(__name__)


def create_viewer_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the router for the WebSocket viewer endpoint.
    """
    router = APIRouter(
        prefix="/ws/view",
    )

    LOG_STEP = "WS-VIEWER"

    # NOTE: Requires Client token AND User Cookie match
    @router.websocket("/{integration}/{session_id:path}")
    async def websocket_viewer_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        token_payload: dict = Depends(validate_client_token),
        user_cookie: dict = Depends(get_current_user_payload),
    ):
        """
        WebSocket endpoint for clients to connect and view
        real-time transcriptions for a specific session.
        """
        token_user_id = token_payload.get("user_id") or token_payload.get("sub")
        cookie_user_id = user_cookie.get("sub")

        token_session_id = token_payload.get("session_id") or token_payload.get(
            "resource"
        )

        if token_user_id != cookie_user_id:
            with log_step(LOG_STEP):
                logger.warning(
                    f"WS Denied: Token user {token_user_id} != Cookie user {cookie_user_id}"
                )
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

        if token_session_id != session_id:
            with log_step(LOG_STEP):
                logger.warning(
                    f"WS Denied: Token session {token_session_id} != URL session {session_id}"
                )
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                return

        if database.DB_POOL:
            try:
                async with database.DB_POOL.acquire() as conn:
                    user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, cookie_user_id)

                    if user_row and user_row.get("language_code"):
                        language_code = user_row.get("language_code")

                        await conn.execute(
                            SQL_ADD_MEETING_LANGUAGE, session_id, language_code
                        )

                        logger.info(
                            f"Registered language '{language_code}' for session '{session_id}' based on user profile."
                        )
                    else:
                        logger.warning(
                            f"User {cookie_user_id} has no 'language_code' in database. Skipping meeting language registration."
                        )

            except Exception as e:
                logger.error(f"Failed to register meeting language from DB: {e}")

        await handle_viewer_session(
            websocket=websocket,
            session_id=session_id,
            viewer_manager=viewer_manager,
            payload=token_payload,
        )

    return router
