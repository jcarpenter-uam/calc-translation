import asyncio
import os
from typing import Any, Dict, List

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from services.rtms_receiver_service import create_transcribe_router
from services.debug_service import log_pipeline_step

load_dotenv()

app = FastAPI(
    title="Real-Time Transcription and Translation API",
    description="A WebSocket API to stream audio for real-time transcription and translation.",
)

DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() == "true"
log_pipeline_step(
    "SYSTEM",
    f"Debug mode is: {'ON' if DEBUG_MODE else 'OFF'}",
    detailed=False,
)


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        log_pipeline_step(
            "WEBSOCKET",
            "Viewer connected.",
            extra={"total_viewers": len(self.active_connections)},
            detailed=False,
        )

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        log_pipeline_step(
            "WEBSOCKET",
            "Viewer disconnected.",
            extra={"total_viewers": len(self.active_connections)},
            detailed=False,
        )

    async def broadcast(self, data: Dict[str, Any]):
        """Broadcasts a JSON object to all connected viewers."""
        if self.active_connections:
            tasks = [conn.send_json(data) for conn in self.active_connections]
            await asyncio.gather(*tasks)


viewer_manager = ConnectionManager()

rtms_router = create_transcribe_router(
    viewer_manager=viewer_manager,
    DEBUG_MODE=DEBUG_MODE,
)
app.include_router(rtms_router)


@app.websocket("/ws/view_transcript")
async def websocket_viewer_endpoint(websocket: WebSocket):
    await viewer_manager.connect(websocket)
    try:
        # Keep the connection alive indefinitely.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        viewer_manager.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
