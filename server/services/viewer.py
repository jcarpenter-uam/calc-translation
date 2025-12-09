# NOTE: In combination with connection_manager we will track languages per session

import logging

from core import database
from core.database import SQL_GET_USER_BY_ID
from core.logging_setup import log_step, session_id_var
from fastapi import WebSocket, WebSocketDisconnect, status

from .connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


async def handle_viewer_session(
    websocket: WebSocket,
    session_id: str,
    viewer_manager: ConnectionManager,
    payload: dict,
):
    """
    Handles the business logic for a single viewer's WebSocket session.
    """
    session_token = session_id_var.set(session_id)
    user_id = payload.get("sub")

    try:
        if not database.DB_POOL:
            logger.error("Database not initialized. Cannot retrieve user language.")
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        language_code = None
        try:
            async with database.DB_POOL.acquire() as conn:
                user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)
                if user_row:
                    language_code = user_row.get("language_code")
        except Exception as e:
            logger.error(
                f"Error fetching user language for {user_id}: {e}", exc_info=True
            )
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

        if not language_code:
            with log_step("WEBSOCKET"):
                logger.error(
                    f"User {user_id} has no language_code set. Rejecting connection."
                )
            await websocket.close(
                code=status.WS_1008_POLICY_VIOLATION, reason="User language not set"
            )
            return

        with log_step("WEBSOCKET"):
            if not viewer_manager.is_session_active(session_id):
                logger.warning(
                    f"Viewer failed to connect: Session '{session_id}' not found."
                )
                await websocket.accept()
                await websocket.close(code=4004, reason="Session not found")
                return

            await viewer_manager.connect(websocket, session_id, language_code)
            logger.info(
                f"Viewer connected to session '{session_id}' with language '{language_code}'."
            )

            while True:
                await websocket.receive_text()

    except WebSocketDisconnect:
        with log_step("WEBSOCKET"):
            logger.info(f"Viewer disconnected from session '{session_id}'.")
        viewer_manager.disconnect(websocket, session_id)

    except Exception as e:
        with log_step("WEBSOCKET"):
            logger.error(
                f"An unexpected error occurred in viewer session '{session_id}': {e}",
                exc_info=True,
            )

    finally:
        session_id_var.reset(session_token)
