# NOTE: In combination with connection_manager we will track languages per session

import logging

from core.logging_setup import log_step, session_id_var
from fastapi import WebSocket, WebSocketDisconnect, status

from .connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


async def handle_viewer_session(
    websocket: WebSocket,
    session_id: str,
    viewer_manager: ConnectionManager,
    language_code: str,
):
    """
    Handles the business logic for a single viewer's WebSocket session.
    """
    session_token = session_id_var.set(session_id)

    try:
        with log_step("WEBSOCKET"):
            if not viewer_manager.is_session_active(session_id):
                logger.warning(
                    f"Viewer failed to connect: Session '{session_id}' not found."
                )
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
