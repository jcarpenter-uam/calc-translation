import logging

from core import database
from core.authentication import get_current_user_payload, validate_client_token
from core.database import (
    SQL_ADD_MEETING_LANGUAGE,
    SQL_GET_MEETING_LANGUAGES,
    SQL_GET_USER_BY_ID,
)
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, Path, WebSocket, status
from services.connection_manager import ConnectionManager
from services.viewer import handle_viewer_session

logger = logging.getLogger(__name__)


def create_viewer_router(viewer_manager: ConnectionManager) -> APIRouter:
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

        language_code = None

        if database.DB_POOL:
            try:
                async with database.DB_POOL.acquire() as conn:
                    user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, cookie_user_id)

                    if user_row and user_row.get("language_code"):
                        language_code = user_row.get("language_code")

                        await conn.execute(
                            SQL_ADD_MEETING_LANGUAGE, session_id, language_code
                        )

                        check_rows = await conn.fetch(
                            SQL_GET_MEETING_LANGUAGES, session_id
                        )
                        langs_in_db = [r["language_code"] for r in check_rows]

                        with log_step(LOG_STEP):
                            if language_code in langs_in_db:
                                logger.info(
                                    f"CONFIRMED: Language '{language_code}' is saved in DB for session '{session_id}'."
                                )
                            else:
                                logger.error(
                                    f"CRITICAL: Insert failed? Language '{language_code}' NOT found in DB check."
                                )
                    else:
                        with log_step(LOG_STEP):
                            logger.error(
                                f"User {cookie_user_id} has no 'language_code' in database."
                            )

            except Exception as e:
                with log_step(LOG_STEP):
                    logger.error(
                        f"Failed to register meeting language from DB: {e}",
                        exc_info=True,
                    )
        else:
            logger.error("DB Pool not initialized.")

        if not language_code:
            with log_step(LOG_STEP):
                logger.warning(
                    f"Connection rejected: Unable to determine language for user {cookie_user_id}."
                )
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION,
                reason="User language not set in DB",
            )
            return

        await handle_viewer_session(
            websocket=websocket,
            session_id=session_id,
            viewer_manager=viewer_manager,
            language_code=language_code,
        )

    return router
