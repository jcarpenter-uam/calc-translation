import logging

from core.logging_setup import log_step
from core.security import validate_server_token
from fastapi import APIRouter, Depends, HTTPException, Path, WebSocket
from integrations.zoom import get_meeting_data
from services.receiver import handle_receiver_session

logger = logging.getLogger(__name__)


def create_transcribe_router(viewer_manager):
    """
    Creates the WebSocket router for the transcription/translation endpoint.
    """
    router = APIRouter(
        prefix="/ws/transcribe",
    )
    LOG_STEP = "WS-TRANSCRIBE"

    # NOTE: Requires Server token
    @router.websocket("/{integration}/{session_id:path}")
    async def websocket_transcribe_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        payload: dict = Depends(validate_server_token),
    ):
        """
        Handles the WebSocket connection for a transcription session.
        """
        await websocket.accept()

        with log_step(LOG_STEP):
            try:
                logger.info(
                    f"New WebSocket connection for session: {session_id} (Integration: {integration})"
                )
                if integration == "zoom":
                    zoom_host_id = payload.get("zoom_host_id")
                    user_id = payload.get("sub")

                    if zoom_host_id:
                        logger.info(
                            f"Proactively fetching Zoom data using zoom_host_id: {zoom_host_id}"
                        )
                        await get_meeting_data(
                            meeting_uuid=session_id, zoom_host_id=zoom_host_id
                        )

                    elif user_id:
                        logger.info(
                            f"Proactively fetching Zoom data using user_id: {user_id}"
                        )
                        await get_meeting_data(meeting_uuid=session_id, user_id=user_id)

                    else:
                        logger.warning(
                            "Zoom connection rejected: Token has neither 'zoom_host_id' nor 'sub' (user_id)."
                        )
                        await websocket.close(
                            code=1008,
                            reason="Invalid authentication: missing required identifiers.",
                        )
                        return

                logger.info(f"Handing off session {session_id} to receiver.")
                await handle_receiver_session(
                    websocket=websocket,
                    integration=integration,
                    session_id=session_id,
                    viewer_manager=viewer_manager,
                )

            except HTTPException as e:
                logger.warning(
                    f"Failed to get Zoom meeting data for {session_id}: {e.detail}",
                )
                await websocket.close(code=1011, reason=f"Zoom Error: {e.detail}")
                return
            except Exception as e:
                logger.error(
                    f"Unexpected error during WebSocket setup for {session_id}: {e}",
                    exc_info=True,
                )
                await websocket.close(
                    code=1011, reason="Server error: Could not prepare session."
                )
                return

            logger.info(f"WebSocket session {session_id} closed.")

    return router
