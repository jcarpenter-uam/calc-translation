import logging

from core.authentication import get_current_user_payload, validate_client_token
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, Path, Query, WebSocket, status
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
        language: str | None = Query(None),
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

        language_code = language

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
