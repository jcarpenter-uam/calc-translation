# /ws/transcribe/{integration}/{id} || Receives audio from clients and sends through pipeline

# This name is slighty misleading as our app does translation and transcription, might change naming later for a better term

from core.security import validate_token_http
from fastapi import APIRouter, Depends, Path, WebSocket
from services.receiver import handle_receiver_session


def create_transcribe_router(viewer_manager):
    """
    Creates the WebSocket router for the transcription/translation endpoint.
    """
    router = APIRouter()

    @router.websocket("/ws/transcribe/{integration}/{session_id}")
    async def websocket_transcribe_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        payload: dict = Depends(validate_token_http),
    ):
        """
        Handles the WebSocket connection for per transcription session.
        """
        await handle_receiver_session(
            websocket=websocket,
            integration=integration,
            session_id=session_id,
            viewer_manager=viewer_manager,
        )

    return router
