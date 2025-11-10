from fastapi import WebSocket, WebSocketDisconnect

from .connection_manager import ConnectionManager
from .debug import log_pipeline_step


async def handle_viewer_session(
    websocket: WebSocket, session_id: str, viewer_manager: ConnectionManager
):
    """
    Handles the business logic for a single viewer's WebSocket session.
    """
    if not viewer_manager.is_session_active(session_id):
        log_pipeline_step(
            "WEBSOCKET",
            f"Viewer failed to connect: Session '{session_id}' not found.",
            extra={"session": session_id},
        )
        await websocket.accept()
        await websocket.close(code=4004, reason="Session not found")
        return

    await viewer_manager.connect(websocket, session_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        viewer_manager.disconnect(websocket, session_id)
