import asyncio
from typing import Any, Dict, List

from fastapi import WebSocket

from .cache_service import TranscriptCache
from .debug_service import log_pipeline_step


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
        """
        Broadcasts a JSON object and passes it to the cache service for processing.
        """
        if data.get("message_id"):
            self.cache.process_message(data)

        # Broadcast the message to all currently connected viewers.
        if self.active_connections:
            tasks = [conn.send_json(data) for conn in self.active_connections]
            await asyncio.gather(*tasks)
