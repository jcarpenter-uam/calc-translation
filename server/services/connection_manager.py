import asyncio
import logging
import threading
from datetime import datetime
from typing import Any, Callable, Dict, List

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
        self.socket_languages: Dict[WebSocket, str] = {}

        self.language_request_callbacks: Dict[str, Callable[[str], Any]] = {}
        self.language_removal_callbacks: Dict[str, Callable[[str], Any]] = {}

        self.cleanup_tasks: Dict[str, Dict[str, asyncio.Task]] = {}

        self.cache = cache
        self._session_lock = threading.Lock()

        with log_step("CONN-MANAGER"):
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

    def register_language_callback(
        self, session_id: str, callback: Callable[[str], Any]
    ):
        """Registers a callback to be triggered when a new language is requested for a session."""
        self.language_request_callbacks[session_id] = callback

    def register_language_removal_callback(
        self, session_id: str, callback: Callable[[str], Any]
    ):
        """Registers a callback to be triggered when a language stream should be stopped."""
        self.language_removal_callbacks[session_id] = callback

    def get_viewer_count(self, session_id: str, language_code: str) -> int:
        """Returns the number of active viewers for a specific language in a session."""
        count = 0
        if session_id in self.sessions:
            for ws in self.sessions[session_id]:
                if self.socket_languages.get(ws) == language_code:
                    count += 1
        return count

    async def _cleanup_language_stream(self, session_id: str, language_code: str):
        """
        Waits for a grace period, then checks if viewers are still 0.
        If so, triggers the removal callback.
        """
        try:
            await asyncio.sleep(20)

            if not self.is_session_active(session_id):
                with log_step("CONN-MANAGER"):
                    logger.debug(
                        f"Session '{session_id}' is no longer active. Skipping cleanup for '{language_code}'."
                    )
                return

            if self.get_viewer_count(session_id, language_code) == 0:
                with log_step("CONN-MANAGER"):
                    logger.info(
                        f"Language '{language_code}' for session '{session_id}' idle for 20s. Triggering cleanup."
                    )

                if session_id in self.language_removal_callbacks:
                    try:
                        callback = self.language_removal_callbacks[session_id]
                        if asyncio.iscoroutinefunction(callback):
                            await callback(language_code)
                        else:
                            callback(language_code)
                    except Exception as e:
                        logger.error(
                            f"Error triggering language removal callback for session {session_id}: {e}"
                        )
        except asyncio.CancelledError:
            with log_step("CONN-MANAGER"):
                logger.debug(
                    f"Cleanup task for language '{language_code}' cancelled (viewers reconnected)."
                )
        finally:
            if (
                session_id in self.cleanup_tasks
                and language_code in self.cleanup_tasks[session_id]
            ):
                del self.cleanup_tasks[session_id][language_code]

    async def connect(self, websocket: WebSocket, session_id: str, language_code: str):
        """
        Accepts a new connection, registers their language,
        and replays the transcript history for that specific language.
        """

        session_token = session_id_var.set(session_id)

        try:
            if session_id not in self.sessions:
                self.sessions[session_id] = []
            self.sessions[session_id].append(websocket)

            self.socket_languages[websocket] = language_code

            if (
                session_id in self.cleanup_tasks
                and language_code in self.cleanup_tasks[session_id]
            ):
                self.cleanup_tasks[session_id][language_code].cancel()
                del self.cleanup_tasks[session_id][language_code]

            if session_id in self.language_request_callbacks:
                try:
                    callback = self.language_request_callbacks[session_id]
                    if asyncio.iscoroutinefunction(callback):
                        await callback(language_code)
                    else:
                        callback(language_code)
                except Exception as e:
                    logger.error(
                        f"Error triggering language request callback for session {session_id}: {e}"
                    )

            history = self.cache.get_history(session_id, language_code)

            with log_step("CONN-MANAGER"):
                logger.debug(
                    f"New viewer connecting (Language: {language_code}). "
                    f"Replaying {len(history)} cached messages."
                )

            if history:
                for payload in history:
                    await websocket.send_json(payload)

            total_count = len(self.sessions[session_id])
            lang_count = self.get_viewer_count(session_id, language_code)

            with log_step("CONN-MANAGER"):
                logger.info(
                    f"Viewer connected (Lang: {language_code}). "
                    f"Active Viewers: Total={total_count}, {language_code}={lang_count}"
                )
        finally:
            session_id_var.reset(session_token)

    def disconnect(self, websocket: WebSocket, session_id: str):
        """Removes a WebSocket connection from the active list for a session."""

        session_token = session_id_var.set(session_id)

        try:
            language_code = None
            if websocket in self.socket_languages:
                language_code = self.socket_languages.pop(websocket)

            if session_id in self.sessions:
                if websocket in self.sessions[session_id]:
                    self.sessions[session_id].remove(websocket)
                if not self.sessions[session_id]:
                    del self.sessions[session_id]

            total_count = len(self.sessions.get(session_id, []))
            lang_count = 0
            if language_code:
                lang_count = self.get_viewer_count(session_id, language_code)

            if not self.is_session_active(session_id):
                with log_step("CONN-MANAGER"):
                    logger.debug(
                        f"Viewer disconnected from inactive session (Lang: {language_code})."
                    )
                return

            total_count = len(self.sessions.get(session_id, []))
            lang_count = 0
            if language_code:
                lang_count = self.get_viewer_count(session_id, language_code)

            with log_step("CONN-MANAGER"):
                logger.info(
                    f"Viewer disconnected (Lang: {language_code}). "
                    f"Active Viewers: Total={total_count}, {language_code}={lang_count}"
                )

            if language_code and language_code != "en":
                remaining_viewers = self.get_viewer_count(session_id, language_code)
                if remaining_viewers == 0:
                    with log_step("CONN-MANAGER"):
                        logger.debug(
                            f"No active viewers left for language '{language_code}'. Scheduling cleanup task."
                        )

                    if session_id not in self.cleanup_tasks:
                        self.cleanup_tasks[session_id] = {}

                    if language_code in self.cleanup_tasks[session_id]:
                        self.cleanup_tasks[session_id][language_code].cancel()

                    task = asyncio.create_task(
                        self._cleanup_language_stream(session_id, language_code)
                    )
                    self.cleanup_tasks[session_id][language_code] = task

        finally:
            session_id_var.reset(session_token)

    async def broadcast_to_session(self, session_id: str, payload: Dict[str, Any]):
        """
        Broadcasts a JSON object to a specific session.
        Only sends the payload to users whose subscribed language matches
        the payload's 'target_language' (or if it's a general system message).
        """
        payload_lang = payload.get("target_language")

        if payload.get("message_id") and payload_lang:
            self.cache.process_message(session_id, payload_lang, payload)

        if session_id in self.sessions:
            connections_to_send = []

            for conn in self.sessions[session_id]:
                user_lang = self.socket_languages.get(conn)
                if not payload_lang or user_lang == payload_lang:
                    connections_to_send.append(conn)

            if connections_to_send:
                tasks = [conn.send_json(payload) for conn in connections_to_send]
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
                    with log_step("CONN-MANAGER"):
                        logger.warning(
                            f"Duplicate transcription session registration attempt for {session_id}."
                        )
                    return False

                session_data = {
                    "integration": integration,
                    "start_time": datetime.utcnow().isoformat(),
                }
                self.active_transcription_sessions[session_id] = session_data

                with log_step("CONN-MANAGER"):
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

                    if session_id in self.language_request_callbacks:
                        del self.language_request_callbacks[session_id]
                    if session_id in self.language_removal_callbacks:
                        del self.language_removal_callbacks[session_id]
                    if session_id in self.cleanup_tasks:
                        for task in self.cleanup_tasks[session_id].values():
                            task.cancel()
                        del self.cleanup_tasks[session_id]

                    with log_step("CONN-MANAGER"):
                        logger.info(
                            f"Transcription session deregistered for integration '{integration}'."
                        )
        finally:
            session_id_var.reset(session_token)
