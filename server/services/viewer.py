# TODO: This endpoint will be protected

from fastapi import APIRouter, Depends, Path, WebSocket, WebSocketDisconnect

# from .auth_service import validate_token
from .connection_manager import ConnectionManager


def create_viewer_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates a router for the WebSocket viewer endpoint,
    including authentication.
    """
    router = APIRouter()

    @router.websocket("/ws/view/{integration}/{session_id}")
    async def websocket_viewer_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        # auth_ok: bool = Depends(validate_token),
    ):
        """
        WebSocket endpoint for clients to connect and view
        real-time transcriptions for a specific session.
        """
        await viewer_manager.connect(websocket, session_id)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            viewer_manager.disconnect(websocket, session_id)

    return router
