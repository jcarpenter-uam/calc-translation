# /ws/monitoring || subscribe to status updates for clients

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from services.connection_manager import ConnectionManager


def create_monitoring_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the WebSocket router for the monitoring (Pub/Sub) endpoint.
    """
    router = APIRouter()

    @router.websocket("/ws/monitoring")
    async def websocket_monitoring_endpoint(
        websocket: WebSocket,
    ):
        """
        Handles the WebSocket connection for a monitoring client.
        """
        await viewer_manager.connect_monitor(websocket)
        try:
            while True:
                data = await websocket.receive_json()
                action = data.get("action")

                if action == "subscribe":
                    topic = data.get("topic")
                    if topic:
                        viewer_manager.add_subscription(websocket, topic)

        except WebSocketDisconnect:
            viewer_manager.disconnect_monitor(websocket)
        except Exception:
            viewer_manager.disconnect_monitor(websocket)

    return router
