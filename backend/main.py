import asyncio
import os
from typing import Any, Dict, List

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from services.cache_service import TranscriptCache
from services.debug_service import log_pipeline_step
from services.rtms_receiver_service import create_transcribe_router

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

    # Accepts a TranscriptCache instance for dependency injection.
    def __init__(self, cache: TranscriptCache):
        """Initializes the manager with connections and a transcript cache."""
        self.active_connections: List[WebSocket] = []
        self.cache = cache  # <-- Store the cache instance

    async def connect(self, websocket: WebSocket):
        """Accepts a new connection and replays the transcript history."""
        await websocket.accept()

        # Use the cache service to get history.
        history = self.cache.get_history()
        log_pipeline_step(
            "WEBSOCKET",
            f"New viewer connecting. Replaying {len(history)} cached messages.",
            detailed=False,
        )
        if history:
            for payload in history:
                await websocket.send_json(payload)

        # After replay, add the connection to the active list for live updates.
        self.active_connections.append(websocket)
        log_pipeline_step(
            "WEBSOCKET",
            "Viewer connected and is now live.",
            extra={"total_viewers": len(self.active_connections)},
            detailed=False,
        )

    def disconnect(self, websocket: WebSocket):
        """Removes a WebSocket connection from the active list."""
        self.active_connections.remove(websocket)
        log_pipeline_step(
            "WEBSOCKET",
            "Viewer disconnected.",
            extra={"total_viewers": len(self.active_connections)},
            detailed=False,
        )

    async def broadcast(self, data: Dict[str, Any]):
        """Broadcasts a JSON object and caches it if it's a final payload."""

        # Use the cache service to add the message.
        if data.get("isfinalize"):
            self.cache.add_message(data)

        # Broadcast the message to all currently connected viewers.
        if self.active_connections:
            tasks = [conn.send_json(data) for conn in self.active_connections]
            await asyncio.gather(*tasks)


# Instantiate the cache first, then pass it to the manager.
transcript_cache = TranscriptCache()
viewer_manager = ConnectionManager(cache=transcript_cache)

rtms_router = create_transcribe_router(
    viewer_manager=viewer_manager,
    DEBUG_MODE=DEBUG_MODE,
)
app.include_router(rtms_router)


@app.websocket("/ws/view_transcript")
async def websocket_viewer_endpoint(websocket: WebSocket):
    await viewer_manager.connect(websocket)
    try:
        # Keep the connection alive to receive broadcasts.
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        viewer_manager.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
