from core.authentication import get_current_user_payload, validate_client_token
from fastapi import APIRouter, Depends, Path, WebSocket, status
from services.connection_manager import ConnectionManager
from services.viewer import handle_viewer_session


def create_viewer_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the router for the WebSocket viewer endpoint.
    """
    router = APIRouter(
        prefix="/ws/view",
    )

    # NOTE: Requires Client token AND User Cookie match
    @router.websocket("/{integration}/{session_id:path}")
    async def websocket_viewer_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
        token_payload: dict = Depends(validate_client_token),
        user_cookie: dict = Depends(get_current_user_payload),
    ):
        """
        WebSocket endpoint for clients to connect and view
        real-time transcriptions for a specific session.
        """
        token_user_id = token_payload.get("user_id") or token_payload.get("sub")
        cookie_user_id = user_cookie.get("sub")

        if token_user_id != cookie_user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if token_payload.get("session_id") != session_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await handle_viewer_session(
            websocket=websocket,
            session_id=session_id,
            viewer_manager=viewer_manager,
            payload=token_payload,
        )

    return router
