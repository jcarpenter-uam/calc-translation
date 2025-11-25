from core.authentication import validate_client_token
from fastapi import APIRouter, Depends, Path, WebSocket
from services.connection_manager import ConnectionManager
from services.viewer import handle_viewer_session


def create_viewer_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the router for the WebSocket viewer endpoint.
    """
    router = APIRouter(
        prefix="/ws/view",
    )

    @router.websocket("/{integration}/{session_id:path}")
    async def websocket_viewer_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        payload: dict = Depends(validate_client_token),
    ):
        """
        WebSocket endpoint for clients to connect and view
        real-time transcriptions for a specific session.
        """
        await handle_viewer_session(
            websocket=websocket,
            session_id=session_id,
            viewer_manager=viewer_manager,
            payload=payload,
        )

    return router
