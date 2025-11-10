from fastapi import WebSocket, WebSocketDisconnect

from .connection_manager import ConnectionManager


async def handle_viewer_session(
    websocket: WebSocket, session_id: str, viewer_manager: ConnectionManager
):
    """
    Handles the business logic for a single viewer's WebSocket session.
    """
    await viewer_manager.connect(websocket, session_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        viewer_manager.disconnect(websocket, session_id)
