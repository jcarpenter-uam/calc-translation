import asyncio
import json
import logging
import threading
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Set

from core.config import settings
from core.db import AsyncSessionLocal
from core.logging_setup import log_step, session_id_var
from fastapi import WebSocket
from redis import asyncio as aioredis
from sqlalchemy import text

from .cache import TranscriptCache

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections, segmented by session_id."""

    def __init__(self, cache: TranscriptCache):
        """Initializes the manager with connections and a transcript cache."""
        self.sessions: Dict[str, List[WebSocket]] = {}
        self.active_transcription_sessions: Dict[str, Dict[str, Any]] = {}
        self.socket_languages: Dict[WebSocket, str] = {}
        self.socket_users: Dict[WebSocket, str] = {}

        self.language_request_callbacks: Dict[str, Callable[[str], Any]] = {}
        self.language_removal_callbacks: Dict[str, Callable[[str], Any]] = {}

        self.cleanup_tasks: Dict[str, Dict[str, asyncio.Task]] = {}

        self.cache = cache
        self._session_lock = threading.Lock()
        self._instance_id = str(uuid.uuid4())
        self._redis = aioredis.from_url(
            settings.REDIS_URL, encoding="utf-8", decode_responses=True
        )
        self._redis_prefix = settings.REDIS_KEY_PREFIX
        self._active_sessions_key = f"{self._redis_prefix}:session:active_ids"
        self._session_events_pattern = f"{self._redis_prefix}:session:*:events"
        self._control_channel = (
            f"{self._redis_prefix}:control:{self._instance_id}"
        )
        self._pubsub_task: asyncio.Task | None = None

        with log_step("CONN-MANAGER"):
            logger.debug(
                f"ConnectionManager initialized. Instance ID: {self._instance_id}"
            )

    async def start(self):
        if not self._pubsub_task:
            self._pubsub_task = asyncio.create_task(self._pubsub_loop())

    async def close(self):
        if self._pubsub_task:
            self._pubsub_task.cancel()
            try:
                await self._pubsub_task
            except asyncio.CancelledError:
                pass
            self._pubsub_task = None
        await self._redis.aclose()

    def _session_meta_key(self, session_id: str) -> str:
        return f"{self._redis_prefix}:session:{session_id}:meta"

    def _session_events_channel(self, session_id: str) -> str:
        return f"{self._redis_prefix}:session:{session_id}:events"

    def _receiver_lease_key(self, session_id: str) -> str:
        return f"{self._redis_prefix}:receiver:lease:{session_id}"

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

    async def get_global_active_sessions(self) -> List[Dict[str, Any]]:
        sessions: List[Dict[str, Any]] = []
        session_ids = await self._redis.smembers(self._active_sessions_key)
        for session_id in session_ids:
            data = await self._redis.hgetall(self._session_meta_key(session_id))
            if data.get("active") != "1":
                await self._redis.srem(self._active_sessions_key, session_id)
                continue
            if not await self._redis.exists(self._receiver_lease_key(session_id)):
                await self._redis.srem(self._active_sessions_key, session_id)
                continue

            local_sockets = self.sessions.get(session_id, [])
            language_counts = {}
            for ws in local_sockets:
                lang = self.socket_languages.get(ws, "unknown")
                language_counts[lang] = language_counts.get(lang, 0) + 1

            sessions.append(
                {
                    "session_id": session_id,
                    "integration": data.get("integration"),
                    "start_time": data.get("start_time"),
                    "shared_two_way_mode": data.get("shared_two_way_mode") == "1",
                    "owner_instance": data.get("owner_instance"),
                    "viewers": len(local_sockets),
                    "viewer_languages": language_counts,
                }
            )
        return sessions

    def is_session_active(self, session_id: str) -> bool:
        """Checks if a transcription session is currently active."""
        return session_id in self.active_transcription_sessions

    async def is_session_active_global(self, session_id: str) -> bool:
        if session_id in self.active_transcription_sessions:
            return True
        meta_key = self._session_meta_key(session_id)
        is_active = (await self._redis.hget(meta_key, "active")) == "1"
        if not is_active:
            return False
        return bool(await self._redis.exists(self._receiver_lease_key(session_id)))

    async def get_session_metadata_global(self, session_id: str) -> Dict[str, Any]:
        if session_id in self.active_transcription_sessions:
            return self.active_transcription_sessions[session_id]
        meta_key = self._session_meta_key(session_id)
        data = await self._redis.hgetall(meta_key)
        if not data:
            return {}
        if not await self._redis.exists(self._receiver_lease_key(session_id)):
            return {}
        return {
            "integration": data.get("integration"),
            "start_time": data.get("start_time"),
            "shared_two_way_mode": data.get("shared_two_way_mode") == "1",
        }

    def _is_shared_two_way_mode(self, session_id: str) -> bool:
        session_data = self.active_transcription_sessions.get(session_id, {})
        return bool(session_data.get("shared_two_way_mode"))

    def _get_effective_language(self, session_id: str, language_code: str) -> str:
        if self._is_shared_two_way_mode(session_id):
            return "two_way"
        return language_code

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

    def get_waiting_languages(self, session_id: str) -> Set[str]:
        """
        Returns a set of language codes requested by viewers currently connected
        to a session that hasn't started transcription yet (waiting room).
        """
        languages = set()
        if session_id in self.sessions:
            for ws in self.sessions[session_id]:
                lang = self.socket_languages.get(ws)
                if lang:
                    languages.add(lang)
        return languages

    async def _handle_control_message(self, command: Dict[str, Any]):
        session_id = command.get("session_id")
        language_code = command.get("language_code")
        cmd_type = command.get("command")

        if not session_id or not language_code or not cmd_type:
            return

        if cmd_type == "language_request":
            callback = self.language_request_callbacks.get(session_id)
        elif cmd_type == "language_remove":
            callback = self.language_removal_callbacks.get(session_id)
        else:
            return

        if not callback:
            return

        try:
            if asyncio.iscoroutinefunction(callback):
                await callback(language_code)
            else:
                callback(language_code)
        except Exception as e:
            logger.error(
                f"Error handling control message '{cmd_type}' for session {session_id}: {e}"
            )

    async def _send_to_local_viewers(self, session_id: str, payload: Dict[str, Any]):
        if session_id not in self.sessions:
            return

        payload_lang = payload.get("target_language")
        session_meta = await self.get_session_metadata_global(session_id)
        is_shared_two_way_mode = bool(session_meta.get("shared_two_way_mode"))
        connections_to_send = []

        for conn in self.sessions[session_id]:
            user_lang = self.socket_languages.get(conn)
            if is_shared_two_way_mode or not payload_lang or user_lang == payload_lang:
                connections_to_send.append(conn)

        if connections_to_send:
            tasks = [conn.send_json(payload) for conn in connections_to_send]
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _pubsub_loop(self):
        pubsub = self._redis.pubsub()
        await pubsub.psubscribe(self._session_events_pattern)
        await pubsub.subscribe(self._control_channel)

        with log_step("CONN-MANAGER"):
            logger.info(
                f"Redis pubsub loop started for instance {self._instance_id}."
            )

        try:
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if not message:
                    await asyncio.sleep(0.05)
                    continue

                msg_type = message.get("type")
                data = message.get("data")
                if not data:
                    continue

                try:
                    parsed = json.loads(data)
                except json.JSONDecodeError:
                    continue

                if msg_type == "pmessage":
                    sender_instance = parsed.get("sender_instance")
                    if sender_instance == self._instance_id:
                        continue
                    session_id = parsed.get("session_id")
                    payload = parsed.get("payload")
                    if session_id and isinstance(payload, dict):
                        await self._send_to_local_viewers(session_id, payload)
                        if (
                            payload.get("type") == "status"
                            and payload.get("status") == "active"
                            and session_id in self.sessions
                        ):
                            requested = set()
                            for ws in self.sessions[session_id]:
                                lang = self.socket_languages.get(ws)
                                if lang and lang != "two_way":
                                    requested.add(lang)
                            for lang in requested:
                                await self._publish_control_to_owner(
                                    session_id, "language_request", lang
                                )

                elif msg_type == "message":
                    await self._handle_control_message(parsed)
        except asyncio.CancelledError:
            with log_step("CONN-MANAGER"):
                logger.info("Redis pubsub loop cancelled.")
            raise
        finally:
            await pubsub.aclose()

    async def _publish_control_to_owner(
        self, session_id: str, command: str, language_code: str
    ):
        meta_key = self._session_meta_key(session_id)
        owner_instance = await self._redis.hget(meta_key, "owner_instance")
        if not owner_instance:
            await self._handle_control_message(
                {
                    "session_id": session_id,
                    "command": command,
                    "language_code": language_code,
                }
            )
            return

        channel = f"{self._redis_prefix}:control:{owner_instance}"
        payload = json.dumps(
            {
                "session_id": session_id,
                "command": command,
                "language_code": language_code,
            },
            separators=(",", ":"),
        )
        await self._redis.publish(channel, payload)

    async def _record_attendee(self, session_id: str, user_id: str):
        """
        Helper to safely add a user to the meeting's attendee list in the DB.
        """
        if not user_id:
            return
        try:
            async with AsyncSessionLocal() as session:
                await session.execute(
                    text(
                        """
                        UPDATE meetings
                        SET attendees = array_append(COALESCE(attendees, '{}'), :user_id)
                        WHERE id = :session_id
                          AND (:user_id <> ALL(COALESCE(attendees, '{}')));
                        """
                    ),
                    {"user_id": user_id, "session_id": session_id},
                )
                await session.commit()
                logger.debug(f"Recorded attendee {user_id} for session {session_id}")
        except Exception as e:
            logger.error(f"Failed to record attendee {user_id} in DB: {e}")

    async def migrate_session(self, old_session_id: str, new_session_id: str):
        """
        Moves all viewer connections from an old session ID to a new one.
        Useful when a Waiting Room (scheduled UUID) transitions to a Live Meeting (new UUID).
        """
        session_token = session_id_var.set(new_session_id)
        migrated_users = set()
        try:
            if old_session_id in self.sessions:
                old_connections = self.sessions.pop(old_session_id)

                if new_session_id not in self.sessions:
                    self.sessions[new_session_id] = []

                self.sessions[new_session_id].extend(old_connections)

                for ws in old_connections:
                    if ws in self.socket_users:
                        migrated_users.add(self.socket_users[ws])

                with log_step("CONN-MANAGER"):
                    logger.info(
                        f"Migrated {len(old_connections)} viewers from Waiting Room {old_session_id} to Live Session {new_session_id}"
                    )

                for ws in old_connections:
                    try:
                        await ws.send_json({"type": "status", "status": "active"})
                    except Exception as e:
                        logger.warning(
                            f"Failed to send status update during migration: {e}"
                        )

                for user_id in migrated_users:
                    asyncio.create_task(self._record_attendee(new_session_id, user_id))

        except Exception as e:
            logger.error(
                f"Error migrating session {old_session_id} to {new_session_id}: {e}",
                exc_info=True,
            )
        finally:
            session_id_var.reset(session_token)

    async def _cleanup_language_stream(self, session_id: str, language_code: str):
        """
        Waits for a grace period, then checks if viewers are still 0.
        If so, triggers the removal callback.
        """
        try:
            await asyncio.sleep(20)

            if not await self.is_session_active_global(session_id):
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
                await self._publish_control_to_owner(
                    session_id, "language_remove", language_code
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

    async def connect(
        self, websocket: WebSocket, session_id: str, language_code: str, user_id: str
    ):
        """
        Accepts a new connection, registers their language,
        and replays the transcript history for that specific language.
        """

        session_token = session_id_var.set(session_id)

        try:
            if session_id not in self.sessions:
                self.sessions[session_id] = []
            self.sessions[session_id].append(websocket)

            session_meta = await self.get_session_metadata_global(session_id)
            is_shared_two_way_mode = bool(session_meta.get("shared_two_way_mode"))
            effective_language = "two_way" if is_shared_two_way_mode else language_code
            self.socket_languages[websocket] = effective_language
            self.socket_users[websocket] = user_id

            if (
                session_id in self.cleanup_tasks
                and effective_language in self.cleanup_tasks[session_id]
            ):
                self.cleanup_tasks[session_id][effective_language].cancel()
                del self.cleanup_tasks[session_id][effective_language]

            is_active_global = await self.is_session_active_global(session_id)
            if is_active_global:
                if not is_shared_two_way_mode:
                    await self._publish_control_to_owner(
                        session_id, "language_request", effective_language
                    )
                asyncio.create_task(self._record_attendee(session_id, user_id))

            history = await self.cache.get_history(session_id, effective_language)

            with log_step("CONN-MANAGER"):
                logger.debug(
                    f"New viewer connecting (Language: {effective_language}). "
                    f"Replaying {len(history)} cached messages."
                )

            if history:
                for payload in history:
                    await websocket.send_json(payload)

            total_count = len(self.sessions[session_id])
            language_counts = {}
            for ws in self.sessions.get(session_id, []):
                lang = self.socket_languages.get(ws, "unknown")
                language_counts[lang] = language_counts.get(lang, 0) + 1

            breakdown = ", ".join(
                [f"{l}={c}" for l, c in sorted(language_counts.items())]
            )

            with log_step("CONN-MANAGER"):
                logger.info(
                    f"Viewer connected (Lang: {effective_language}). "
                    f"Active Viewers: Total={total_count} [{breakdown}]"
                )
        finally:
            session_id_var.reset(session_token)

    async def disconnect(self, websocket: WebSocket, session_id: str):
        """Removes a WebSocket connection from the active list for a session."""

        session_token = session_id_var.set(session_id)

        try:
            language_code = None
            if websocket in self.socket_languages:
                language_code = self.socket_languages.pop(websocket)

            if websocket in self.socket_users:
                del self.socket_users[websocket]

            if session_id in self.sessions:
                if websocket in self.sessions[session_id]:
                    self.sessions[session_id].remove(websocket)
                if not self.sessions[session_id]:
                    del self.sessions[session_id]

            total_count = len(self.sessions.get(session_id, []))
            lang_count = 0
            if language_code:
                lang_count = self.get_viewer_count(session_id, language_code)

            is_active_global = await self.is_session_active_global(session_id)
            if not is_active_global:
                with log_step("CONN-MANAGER"):
                    logger.debug(
                        f"Viewer disconnected from inactive/waiting session (Lang: {language_code})."
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

            session_meta = await self.get_session_metadata_global(session_id)
            is_shared_two_way_mode = bool(session_meta.get("shared_two_way_mode"))

            if (
                language_code
                and language_code != "en"
                and not is_shared_two_way_mode
            ):
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
        For normal mode, only sends language-targeted payloads to matching viewers.
        For shared two-way mode, sends transcript payloads to all viewers and stores
        everything under a single shared cache/transcript language key.
        """
        payload_lang = payload.get("target_language")
        is_shared_two_way_mode = self._is_shared_two_way_mode(session_id)
        effective_payload_lang = "two_way" if is_shared_two_way_mode else payload_lang

        if payload.get("message_id") and effective_payload_lang:
            await self.cache.process_message(session_id, effective_payload_lang, payload)
        await self._send_to_local_viewers(session_id, payload)

        envelope = json.dumps(
            {
                "session_id": session_id,
                "sender_instance": self._instance_id,
                "payload": payload,
            },
            separators=(",", ":"),
        )
        await self._redis.publish(self._session_events_channel(session_id), envelope)

    async def register_transcription_session(
        self,
        session_id: str,
        integration: str,
        shared_two_way_mode: bool = False,
    ) -> bool:
        """
        Atomically marks a transcription session as active.
        Returns:
            bool: True if registration was successful, False if session already exists.
        """
        session_token = session_id_var.set(session_id)
        try:
            session_data: Dict[str, Any] | None = None
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
                    "shared_two_way_mode": shared_two_way_mode,
                }
                self.active_transcription_sessions[session_id] = session_data

            await self._redis.hset(
                self._session_meta_key(session_id),
                mapping={
                    "active": "1",
                    "integration": integration,
                    "start_time": session_data["start_time"],
                    "shared_two_way_mode": "1" if shared_two_way_mode else "0",
                    "owner_instance": self._instance_id,
                },
            )
            await self._redis.sadd(self._active_sessions_key, session_id)

            with log_step("CONN-MANAGER"):
                logger.info(
                    f"Transcription session registered as active for integration '{integration}'."
                )
            return True
        finally:
            session_id_var.reset(session_token)

    async def deregister_transcription_session(self, session_id: str):
        """Atomically marks a transcription session as inactive."""

        session_token = session_id_var.set(session_id)
        try:
            integration = None
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

            if integration is not None:
                await self._redis.delete(self._session_meta_key(session_id))
                await self._redis.srem(self._active_sessions_key, session_id)
                with log_step("CONN-MANAGER"):
                    logger.info(
                        f"Transcription session deregistered for integration '{integration}'."
                    )
        finally:
            session_id_var.reset(session_token)
