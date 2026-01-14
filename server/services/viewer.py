import logging

from core import database
from core.database import SQL_GET_LATEST_ACTIVE_SIBLING, SQL_GET_MEETING_BY_ID
from core.logging_setup import log_step, session_id_var
from fastapi import WebSocket, WebSocketDisconnect, status
from integrations.zoom import get_meeting_data

from .connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


async def handle_viewer_session(
    websocket: WebSocket,
    session_id: str,
    viewer_manager: ConnectionManager,
    language_code: str,
    user_id: str,
):
    """
    Handles the business logic for a single viewer's WebSocket session.
    Also handles "early join" logic where we verify the meeting via Zoom API if not in DB.
    """
    resolved_session_id = session_id
    session_token = session_id_var.set(session_id)

    try:
        with log_step("WEBSOCKET"):
            if not viewer_manager.is_session_active(session_id):
                logger.info(
                    f"Session '{session_id}' not currently active. Checking DB for meeting record..."
                )
                meeting_exists = False
                async with database.DB_POOL.acquire() as conn:
                    row = await conn.fetchrow(SQL_GET_MEETING_BY_ID, session_id)
                    if row:
                        meeting_exists = True

                        # TODO: START OF JANK SOLUTION
                        # It needs to be improved when im not on a deadline
                        readable_id = row.get("readable_id")
                        platform = row.get("platform")

                    if readable_id and platform:
                        sibling = await conn.fetchrow(
                            SQL_GET_LATEST_ACTIVE_SIBLING,
                            readable_id,
                            platform,
                            session_id,
                        )

                        if sibling:
                            candidate_session_id = sibling["id"]
                            if viewer_manager.is_session_active(candidate_session_id):
                                logger.info(
                                    f"Found active sibling session. Redirecting {session_id} -> {candidate_session_id}"
                                )
                                resolved_session_id = candidate_session_id
                                session_id_var.set(resolved_session_id)
                        # TODO: END OF JANK SOLUTION

                if not meeting_exists:
                    logger.info(
                        f"Meeting '{session_id}' not found in DB. Attempting to fetch from Zoom API..."
                    )
                    try:
                        resolved_session_id = await get_meeting_data(
                            meeting_identifier=session_id,
                            is_waiting_room=True,
                            user_id=user_id,
                        )
                        logger.info(
                            f"Resolved meeting '{session_id}' to UUID '{resolved_session_id}'."
                        )

                    except Exception as e:
                        logger.warning(
                            f"Viewer failed to connect: Session '{session_id}' not found and Zoom fetch failed: {e}"
                        )
                        await websocket.close(code=4004, reason="Session not found")
                        return

                if resolved_session_id != session_id:
                    logger.info(
                        f"Switching session context from {session_id} to {resolved_session_id}"
                    )
                    session_id_var.set(resolved_session_id)

            await viewer_manager.connect(
                websocket, resolved_session_id, language_code, user_id
            )

            status_msg = (
                "active"
                if viewer_manager.is_session_active(resolved_session_id)
                else "waiting"
            )

            logger.debug(
                f"Viewer connected to session '{resolved_session_id}' (Status: {status_msg}) with language '{language_code}'."
            )

            await websocket.send_json({"type": "status", "status": status_msg})

            while True:
                await websocket.receive_text()

    except WebSocketDisconnect:
        with log_step("WEBSOCKET"):
            logger.debug(f"Viewer disconnected from session '{resolved_session_id}'.")
        viewer_manager.disconnect(websocket, resolved_session_id)

    except Exception as e:
        with log_step("WEBSOCKET"):
            logger.error(
                f"An unexpected error occurred in viewer session '{resolved_session_id}': {e}",
                exc_info=True,
            )

    finally:
        session_id_var.reset(session_token)
