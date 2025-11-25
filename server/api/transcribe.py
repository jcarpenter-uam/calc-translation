# NOTE: This name is slighty misleading as our app does translation and transcription, might change naming later for a better term
import logging

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

    # BUG: Chicken and egg problem
    # This is attempting to fetch data from zoom and save to DB, but how can I link it back to a given user?
    @router.websocket(
        "/{integration}/{session_id:path}"
    )  # Dont know if im a fan of this method
    async def websocket_transcribe_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        payload: dict = Depends(validate_server_token),
    ):
        """
        Handles the WebSocket connection for per transcription session.
        """
        if integration == "zoom":
            user_id = payload.get("sub")

            if not user_id:
                logger.error("WebSocket auth token missing 'sub' (user_id) claim.")
                await websocket.accept()
                await websocket.close(code=1008, reason="Invalid authentication token.")
                return

            try:
                await get_meeting_data(meeting_uuid=session_id, user_id=user_id)

            except HTTPException as e:
                logger.error(
                    f"Failed to get Zoom meeting data for {session_id}: {e.detail}",
                    exc_info=True,
                )
                await websocket.accept()
                await websocket.close(code=1011, reason=f"Zoom Error: {e.detail}")
                return
            except Exception as e:
                logger.error(
                    f"Unexpected error fetching Zoom data for {session_id}: {e}",
                    exc_info=True,
                )
                await websocket.accept()
                await websocket.close(
                    code=1011, reason="Server error: Could not prepare Zoom session."
                )
                return
        await handle_receiver_session(
            websocket=websocket,
            integration=integration,
            session_id=session_id,
            viewer_manager=viewer_manager,
        )

    return router
