import logging
from collections import deque
from typing import Any, Deque, Dict, List

from core.config import settings
from core.logging_setup import log_step, message_id_var, session_id_var
from pympler.asizeof import asizeof

from .vtt import create_vtt_file

logger = logging.getLogger(__name__)


class _SessionCache:
    """
    Manages a bounded history cache for a *single* transcript session (specific language),
    limited by total size in megabytes.
    """

    def __init__(self, max_size_bytes: int):
        self._max_size_bytes = max_size_bytes
        self._current_size_bytes: int = 0
        self._cache_dict: Dict[str, Dict[str, Any]] = {}
        self._order_queue: Deque[str] = deque()

    def clear(self):
        self._cache_dict.clear()
        self._order_queue.clear()
        self._current_size_bytes = 0

    def _evict_until_space(self, required_space: int = 0):
        target_size = self._max_size_bytes - required_space
        while self._current_size_bytes > target_size and len(self._order_queue) > 0:
            oldest_id = self._order_queue.popleft()
            old_item = self._cache_dict.pop(oldest_id, None)
            if old_item:
                old_item_size = asizeof(old_item)
                self._current_size_bytes -= old_item_size

                msg_id_token = message_id_var.set(oldest_id)
                with log_step("CACHE"):
                    logger.debug(
                        f"Evicted item from cache. Size: {old_item_size} bytes. "
                        f"New total size: {self._current_size_bytes} bytes."
                    )
                message_id_var.reset(msg_id_token)

    def process_message(self, payload: Dict[str, Any]):
        message_id = payload.get("message_id")
        if not message_id:
            return

        msg_id_token = message_id_var.set(message_id)

        try:
            is_new_and_finalized = (
                message_id not in self._cache_dict and payload.get("isfinalize") is True
            )

            if is_new_and_finalized:
                new_item_size = asizeof(payload)
                self._evict_until_space(required_space=new_item_size)

                self._order_queue.append(message_id)
                self._cache_dict[message_id] = payload
                self._current_size_bytes += new_item_size

                with log_step("CACHE"):
                    logger.debug(
                        f"Added new final utterance. Size: {new_item_size} bytes. "
                        f"Total cache size: {self._current_size_bytes} bytes. "
                        f"Limit: {self._max_size_bytes} bytes."
                    )

            elif message_id in self._cache_dict:
                message_type = payload.get("type")
                old_item_size = asizeof(self._cache_dict[message_id])
                new_item_size = old_item_size
                log_msg = ""

                if message_type == "correction":
                    self._cache_dict[message_id] = payload
                    new_item_size = asizeof(payload)
                    log_msg = f"Applied correction. New size: {new_item_size} bytes."
                elif message_type == "status_update":
                    self._cache_dict[message_id].update(payload)
                    new_item_size = asizeof(self._cache_dict[message_id])
                    log_msg = f"Applied status update. New size: {new_item_size} bytes."
                else:
                    return

                size_diff = new_item_size - old_item_size
                self._current_size_bytes += size_diff

                if size_diff > 0:
                    self._evict_until_space(required_space=0)

                with log_step("CACHE"):
                    logger.debug(
                        f"{log_msg} Size diff: {size_diff} bytes. "
                        f"Total cache size: {self._current_size_bytes} bytes."
                    )
        finally:
            message_id_var.reset(msg_id_token)

    def get_history(self) -> List[Dict[str, Any]]:
        return [
            self._cache_dict[msg_id]
            for msg_id in self._order_queue
            if msg_id in self._cache_dict
        ]

    def __len__(self) -> int:
        return len(self._cache_dict)


class TranscriptCache:
    """
    Manages multiple independent _SessionCache instances.
    Structure: self.sessions[session_id][language_code] = _SessionCache
    """

    def __init__(self, max_size_mb: int = settings.MAX_CACHE_MB):
        self._default_max_size_bytes = max_size_mb * 1024 * 1024
        self.sessions: Dict[str, Dict[str, _SessionCache]] = {}

        with log_step("CACHE"):
            logger.debug(
                f"TranscriptCache Manager initialized. Per-session-language limit: {max_size_mb}MB."
            )

    def _get_or_create_session_cache(
        self, session_id: str, language_code: str
    ) -> _SessionCache:
        """
        Retrieves or creates a _SessionCache instance for a given session_id AND language.
        """
        if session_id not in self.sessions:
            self.sessions[session_id] = {}

        if language_code not in self.sessions[session_id]:
            with log_step("CACHE"):
                logger.debug(
                    f"Creating new session cache for {session_id} (Lang: {language_code})."
                )
            self.sessions[session_id][language_code] = _SessionCache(
                max_size_bytes=self._default_max_size_bytes
            )

        return self.sessions[session_id][language_code]

    def process_message(
        self, session_id: str, language_code: str, payload: Dict[str, Any]
    ):
        """
        Processes an incoming message for a specific session and language.
        """
        if not language_code:
            return

        session_token = session_id_var.set(session_id)
        try:
            session_cache = self._get_or_create_session_cache(session_id, language_code)
            session_cache.process_message(payload)
        finally:
            session_id_var.reset(session_token)

    def get_history(self, session_id: str, language_code: str) -> List[Dict[str, Any]]:
        """
        Retrieves the history for a specific session and language.
        """
        session_token = session_id_var.set(session_id)
        try:
            if (
                session_id in self.sessions
                and language_code in self.sessions[session_id]
            ):
                return self.sessions[session_id][language_code].get_history()
            return []
        finally:
            session_id_var.reset(session_token)

    async def save_history_and_clear(self, session_id: str, integration: str):
        """
        Saves the history for ALL languages in a specific session
        and then clears that session from the manager.
        """
        session_token = session_id_var.set(session_id)
        try:
            if session_id in self.sessions:
                languages_map = self.sessions[session_id]

                for lang_code, cache in languages_map.items():
                    history = cache.get_history()
                    if history:
                        await create_vtt_file(
                            session_id, integration, lang_code, history
                        )
                        cache.clear()

                del self.sessions[session_id]

                with log_step("CACHE"):
                    logger.info(
                        f"Cleared all language caches for session: {session_id}"
                    )
            else:
                with log_step("CACHE"):
                    logger.info(
                        f"No history to save for session {session_id}, cache is empty."
                    )
        finally:
            session_id_var.reset(session_token)
