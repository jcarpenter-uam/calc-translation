# /ws/view/{integration}/{id} || Endpoint for the web/desktop to connect to per session

from fastapi import APIRouter, Depends, Path, WebSocket
from services.connection_manager import ConnectionManager
from services.viewer import handle_viewer_session

# from services.auth_service import validate_token


def create_viewer_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the router for the WebSocket viewer endpoint.
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
        await handle_viewer_session(
            websocket=websocket, session_id=session_id, viewer_manager=viewer_manager
        )

    return router
