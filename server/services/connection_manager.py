import asyncio
from typing import Any, Dict, List

from fastapi import WebSocket

from .cache import TranscriptCache
from .debug import log_pipeline_step


class ConnectionManager:
    """Manages active WebSocket connections, segmented by session_id."""

    def __init__(self, cache: TranscriptCache):
        """Initializes the manager with connections and a transcript cache."""
        self.sessions: Dict[str, List[WebSocket]] = {}
        self.cache = cache

    async def connect(self, websocket: WebSocket, session_id: str):
        """Accepts a new connection and replays the transcript history for a session."""
        await websocket.accept()

        if session_id not in self.sessions:
            self.sessions[session_id] = []
        self.sessions[session_id].append(websocket)

        history = self.cache.get_history(session_id)
        log_pipeline_step(
            "WEBSOCKET",
            f"New viewer connecting for session {session_id}. Replaying {len(history)} cached messages.",
            extra={"session": session_id},
            detailed=False,
        )
        if history:
            for payload in history:
                await websocket.send_json(payload)

        log_pipeline_step(
            "WEBSOCKET",
            "Viewer connected and is now live.",
            extra={
                "session": session_id,
                "total_viewers_for_session": len(self.sessions[session_id]),
            },
            detailed=False,
        )

    def disconnect(self, websocket: WebSocket, session_id: str):
        """Removes a WebSocket connection from the active list for a session."""
        if session_id in self.sessions:
            if websocket in self.sessions[session_id]:
                self.sessions[session_id].remove(websocket)
            if not self.sessions[session_id]:
                del self.sessions[session_id]

        log_pipeline_step(
            "WEBSOCKET",
            "Viewer disconnected.",
            extra={
                "session": session_id,
                "remaining_viewers": len(self.sessions.get(session_id, [])),
            },
            detailed=False,
        )

    async def broadcast_to_session(self, session_id: str, payload: Dict[str, Any]):
        """
        Broadcasts a JSON object to a specific session and caches it.
        """
        if payload.get("message_id"):
            self.cache.process_message(session_id, payload)

        if session_id in self.sessions:
            tasks = [conn.send_json(payload) for conn in self.sessions[session_id]]
            await asyncio.gather(*tasks, return_exceptions=True)
