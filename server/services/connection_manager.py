import asyncio
from datetime import datetime
from typing import Any, Dict, List, Set

from fastapi import WebSocket

from .cache import TranscriptCache
from .debug import log_pipeline_step


class ConnectionManager:
    """Manages active WebSocket connections, segmented by session_id."""

    def __init__(self, cache: TranscriptCache):
        """Initializes the manager with connections and a transcript cache."""
        self.sessions: Dict[str, List[WebSocket]] = {}
        self.active_transcription_sessions: Dict[str, Dict[str, Any]] = {}
        self.cache = cache
        log_pipeline_step("MANAGER", "ConnectionManager initialized.", detailed=True)

    def get_all_clients(self) -> List[Dict[str, Any]]:
        """Returns a list of all active transcription sessions."""
        return [
            {"session_id": sid, **data}
            for sid, data in self.active_transcription_sessions.items()
        ]

    def get_clients_by_integration(self, integration: str) -> List[Dict[str, Any]]:
        """Returns a list of active sessions filtered by integration."""
        return [
            {"session_id": sid, **data}
            for sid, data in self.active_transcription_sessions.items()
            if data.get("integration") == integration
        ]

    def is_session_active(self, session_id: str) -> bool:
        """Checks if a transcription session is currently active."""
        return session_id in self.active_transcription_sessions

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

    def register_transcription_session(self, session_id: str, integration: str):
        """Marks a transcription session as active."""
        session_data = {
            "integration": integration,
            "start_time": datetime.utcnow().isoformat(),
        }
        self.active_transcription_sessions[session_id] = session_data
        log_pipeline_step(
            "MANAGER",
            f"Transcription session '{session_id}' registered as active.",
            extra={"session": session_id, "integration": integration},
        )

    def deregister_transcription_session(self, session_id: str):
        """Marks a transcription session as inactive."""
        if session_id in self.active_transcription_sessions:
            session_data = self.active_transcription_sessions.pop(session_id)
            integration = session_data.get("integration", "unknown")
            log_pipeline_step(
                "MANAGER",
                f"Transcription session '{session_id}' deregistered.",
                extra={"session": session_id, "integration": integration},
            )
