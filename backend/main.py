import asyncio
import os
from typing import List

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from services.rtms_receiver_service import create_transcribe_router

load_dotenv()

app = FastAPI(
    title="Real-Time Transcription and Translation API",
    description="A WebSocket API to stream audio for real-time transcription (iFlyTek) and translation (Alibaba Qwen).",
)

# It defaults to "False" if the variable is not set.
DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() == "true"
print(f"  - Debug mode is: {'ON' if DEBUG_MODE else 'OFF'}")


class ConnectionManager:
    """Manages active WebSocket connections."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"Viewer connected. Total viewers: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        print(f"Viewer disconnected. Total viewers: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        """Broadcasts a message to all connected viewers."""
        if self.active_connections:
            tasks = [conn.send_text(message) for conn in self.active_connections]
            await asyncio.gather(*tasks)


# Define shared managers here
transcription_manager = ConnectionManager()
translation_manager = ConnectionManager()

# Create the router by calling the function and passing the dependencies
rtms_router = create_transcribe_router(
    transcription_manager=transcription_manager,
    translation_manager=translation_manager,
    DEBUG_MODE=DEBUG_MODE,
)
# Include the returned router in the main app
app.include_router(rtms_router)


@app.websocket("/ws/view_transcription")
async def websocket_viewer_endpoint(websocket: WebSocket):
    await transcription_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        transcription_manager.disconnect(websocket)


@app.websocket("/ws/view_translation")
async def websocket_translation_viewer_endpoint(websocket: WebSocket):
    await translation_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        translation_manager.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
