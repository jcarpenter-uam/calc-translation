import asyncio
import logging
import threading
from datetime import datetime
from typing import Any, Dict, List, Set

from core.logging_setup import log_step, session_id_var
from fastapi import WebSocket

from .cache import TranscriptCache

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections, segmented by session_id."""

    def __init__(self, cache: TranscriptCache):
        """Initializes the manager with connections and a transcript cache."""
        self.sessions: Dict[str, List[WebSocket]] = {}
        self.active_transcription_sessions: Dict[str, Dict[str, Any]] = {}
        self.cache = cache

        self._session_lock = threading.Lock()

        with log_step("MANAGER"):
            logger.debug("ConnectionManager initialized.")

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

        session_token = session_id_var.set(session_id)

        try:
            await websocket.accept()

            if session_id not in self.sessions:
                self.sessions[session_id] = []
            self.sessions[session_id].append(websocket)

            history = self.cache.get_history(session_id)

            with log_step("WEBSOCKET"):
                logger.info(
                    f"New viewer connecting. Replaying {len(history)} cached messages."
                )

            if history:
                for payload in history:
                    await websocket.send_json(payload)

            with log_step("WEBSOCKET"):
                logger.info(
                    f"Viewer connected and is now live. "
                    f"Total viewers: {len(self.sessions[session_id])}"
                )
        finally:
            session_id_var.reset(session_token)

    def disconnect(self, websocket: WebSocket, session_id: str):
        """Removes a WebSocket connection from the active list for a session."""

        session_token = session_id_var.set(session_id)

        try:
            if session_id in self.sessions:
                if websocket in self.sessions[session_id]:
                    self.sessions[session_id].remove(websocket)
                if not self.sessions[session_id]:
                    del self.sessions[session_id]

            with log_step("WEBSOCKET"):
                logger.info(
                    f"Viewer disconnected. "
                    f"Remaining viewers: {len(self.sessions.get(session_id, []))}"
                )
        finally:
            session_id_var.reset(session_token)

    async def broadcast_to_session(self, session_id: str, payload: Dict[str, Any]):
        """
        Broadcasts a JSON object to a specific session and caches it.
        (No logging here, so no changes needed)
        """
        if payload.get("message_id"):
            self.cache.process_message(session_id, payload)

        if session_id in self.sessions:
            tasks = [conn.send_json(payload) for conn in self.sessions[session_id]]
            await asyncio.gather(*tasks, return_exceptions=True)

    def register_transcription_session(self, session_id: str, integration: str) -> bool:
        """
        Atomically marks a transcription session as active.
        Returns:
            bool: True if registration was successful, False if session already exists.
        """
        session_token = session_id_var.set(session_id)
        try:
            with self._session_lock:
                if session_id in self.active_transcription_sessions:
                    with log_step("MANAGER"):
                        logger.warning(
                            f"Duplicate transcription session registration attempt for {session_id}."
                        )
                    return False

                session_data = {
                    "integration": integration,
                    "start_time": datetime.utcnow().isoformat(),
                }
                self.active_transcription_sessions[session_id] = session_data

                with log_step("MANAGER"):
                    logger.info(
                        f"Transcription session registered as active for integration '{integration}'."
                    )
                return True
        finally:
            session_id_var.reset(session_token)

    def deregister_transcription_session(self, session_id: str):
        """Atomically marks a transcription session as inactive."""

        session_token = session_id_var.set(session_id)
        try:
            with self._session_lock:
                if session_id in self.active_transcription_sessions:
                    session_data = self.active_transcription_sessions.pop(session_id)
                    integration = session_data.get("integration", "unknown")

                    with log_step("MANAGER"):
                        logger.info(
                            f"Transcription session deregistered for integration '{integration}'."
                        )
        finally:
            session_id_var.reset(session_token)
