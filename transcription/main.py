import asyncio
from typing import List

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from transcription_service import (
    STATUS_CONTINUE_FRAME,
    STATUS_FIRST_FRAME,
    TranscriptionService,
)

app = FastAPI(
    title="Real-Time Transcription API",
    description="A WebSocket API to stream audio for real-time transcription via iFlyTek.",
)


class ConnectionManager:
    """Manages active WebSocket connections for the viewer endpoint."""

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
        # We create a list of tasks to send messages concurrently
        tasks = [
            connection.send_text(message) for connection in self.active_connections
        ]
        await asyncio.gather(*tasks)


# Create a single instance of the manager
manager = ConnectionManager()


@app.websocket("/ws/view_transcription")
async def websocket_viewer_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Keep the connection alive and listen for disconnects
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"Error on viewer connection: {e}")
        manager.disconnect(websocket)


@app.websocket("/ws/transcribe")
async def websocket_transcribe_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Transcription client connected.")

    loop = asyncio.get_running_loop()

    async def on_message(result: str):
        # Send the result back to the transcribing client
        await websocket.send_text(result)
        # Broadcast the result to all viewers
        await manager.broadcast(result)

    async def on_error(error_message: str):
        print(error_message)
        await websocket.close(code=1011, reason=error_message)

    async def on_close():
        print("Transcription service closed the connection.")

    transcription_service = TranscriptionService(
        on_message_callback=on_message,
        on_error_callback=on_error,
        on_close_callback=on_close,
        loop=loop,
    )
    transcription_service.connect()

    try:
        status = STATUS_FIRST_FRAME
        while True:
            audio_chunk = await websocket.receive_bytes()
            transcription_service.send_audio(audio_chunk, status)
            if status == STATUS_FIRST_FRAME:
                status = STATUS_CONTINUE_FRAME

    except WebSocketDisconnect:
        print("Transcription client disconnected.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        transcription_service.close()
        print("Cleaned up transcription service.")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
