import os
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, List

from pympler.asizeof import asizeof

from .debug import log_pipeline_step

_DEFAULT_FALLBACK_MB = 10
_max_cache_mb_str = os.getenv("MAX_CACHE_MB", str(_DEFAULT_FALLBACK_MB))

try:
    DEFAULT_MAX_CACHE_MB = int(_max_cache_mb_str)
    if DEFAULT_MAX_CACHE_MB <= 0:
        raise ValueError("Cache size must be positive.")
except ValueError:
    log_pipeline_step(
        "CACHE",
        f"Invalid or non-positive MAX_CACHE_MB value '{_max_cache_mb_str}'. "
        f"Falling back to default: {_DEFAULT_FALLBACK_MB}MB.",
        detailed=False,
    )
    DEFAULT_MAX_CACHE_MB = _DEFAULT_FALLBACK_MB


class _SessionCache:
    """
    Manages a bounded history cache for a *single* transcript session,
    limited by total size in megabytes.
    """

    def __init__(self, max_size_bytes: int):
        """
        Initializes the session cache with a size limit in bytes.
        """
        self._max_size_bytes = max_size_bytes
        self._current_size_bytes: int = 0
        self._cache_dict: Dict[str, Dict[str, Any]] = {}
        self._order_queue: Deque[str] = deque()

    def clear(self):
        """Clears all entries from this session's cache."""
        self._cache_dict.clear()
        self._order_queue.clear()
        self._current_size_bytes = 0

    def _evict_until_space(self, required_space: int = 0):
        """
        Evicts the oldest items from the cache until the total size is
        less than or equal to (max_size - required_space).
        """
        target_size = self._max_size_bytes - required_space
        while self._current_size_bytes > target_size and len(self._order_queue) > 0:
            oldest_id = self._order_queue.popleft()
            old_item = self._cache_dict.pop(oldest_id, None)
            if old_item:
                old_item_size = asizeof(old_item)
                self._current_size_bytes -= old_item_size
                log_pipeline_step(
                    "CACHE",
                    f"Evicted item from cache. Size: {old_item_size} bytes.",
                    extra={
                        "evicted_message_id": oldest_id,
                        "size_bytes": old_item_size,
                        "new_total_size_bytes": self._current_size_bytes,
                    },
                    detailed=True,
                )

    def process_message(self, payload: Dict[str, Any]):
        """
        Processes an incoming message for this session.
        """
        message_id = payload.get("message_id")
        if not message_id:
            return

        is_new_and_finalized = (
            message_id not in self._cache_dict and payload.get("isfinalize") is True
        )

        if is_new_and_finalized:
            new_item_size = asizeof(payload)
            self._evict_until_space(required_space=new_item_size)

            self._order_queue.append(message_id)
            self._cache_dict[message_id] = payload
            self._current_size_bytes += new_item_size

            log_pipeline_step(
                "CACHE",
                f"Added new final utterance. Size: {new_item_size} bytes. "
                f"Total cache size: {self._current_size_bytes} bytes.",
                extra={
                    "message_id": message_id,
                    "size_bytes": new_item_size,
                    "total_size_bytes": self._current_size_bytes,
                    "limit_bytes": self._max_size_bytes,
                },
                detailed=True,
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

            log_pipeline_step(
                "CACHE",
                f"{log_msg} Total cache size: {self._current_size_bytes} bytes.",
                extra={
                    "message_id": message_id,
                    "size_bytes": new_item_size,
                    "size_diff_bytes": size_diff,
                    "total_size_bytes": self._current_size_bytes,
                },
                detailed=True,
            )

    def get_history(self) -> List[Dict[str, Any]]:
        """
        Retrieves the entire history for this session in chronological order.
        """
        return [
            self._cache_dict[msg_id]
            for msg_id in self._order_queue
            if msg_id in self._cache_dict
        ]

    def save_history(self, session_id: str, output_dir: str):
        """
        Saves this session's cache history to a timestamped .vtt file.
        The session_id is used in the filename for identification.
        """
        try:
            transcript_history = self.get_history()
            if not transcript_history:
                log_pipeline_step(
                    "CACHE",
                    f"No history to save for session {session_id}, cache is empty.",
                    extra={"session": session_id},
                    detailed=False,
                )
                return

            os.makedirs(output_dir, exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_name = f"history_{session_id}_{timestamp}.vtt"
            cache_filepath = os.path.join(output_dir, file_name)

            formatted_lines = ["WEBVTT", ""]

            for i, entry in enumerate(transcript_history):
                utterance_num = i + 1
                speaker = entry.get("speaker", "Unknown")
                transcription = entry.get("transcription", "").strip()
                translation = entry.get("translation", "").strip()
                timestamp_str = entry.get(
                    "vtt_timestamp", "00:00:00.000 --> 00:00:00.000"
                )

                formatted_lines.append(f"{utterance_num}")
                formatted_lines.append(f"{timestamp_str}")
                formatted_lines.append(f"{speaker}: {transcription}")
                if translation:
                    formatted_lines.append(f"{translation}")
                formatted_lines.append("")

            with open(cache_filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(formatted_lines))

            log_pipeline_step(
                "CACHE",
                f"Transcript cache for session {session_id} saved. Size: {self._current_size_bytes} bytes.",
                extra={
                    "path": cache_filepath,
                    "entries": len(transcript_history),
                    "size_bytes": self._current_size_bytes,
                    "session": session_id,
                },
                detailed=True,
            )

        except Exception as e:
            log_pipeline_step(
                "CACHE",
                f"Failed to save history for session {session_id}: {e}",
                extra={"session": session_id},
                detailed=False,
            )

    def __len__(self) -> int:
        """Returns the current number of items in the cache."""
        return len(self._cache_dict)


class TranscriptCache:
    """
    Manages multiple independent _SessionCache instances, one for each session_id.
    """

    def __init__(self, max_size_mb: int = DEFAULT_MAX_CACHE_MB):
        """
        Initializes the cache manager.
        """
        self._default_max_size_bytes = max_size_mb * 1024 * 1024
        self.sessions: Dict[str, _SessionCache] = {}
        log_pipeline_step(
            "CACHE",
            f"TranscriptCache Manager initialized. Default per-session limit: {max_size_mb}MB.",
            detailed=False,
        )

    def _get_or_create_session(self, session_id: str) -> _SessionCache:
        """
        Retrieves or creates a _SessionCache instance for a given session_id.
        """
        if session_id not in self.sessions:
            log_pipeline_step(
                "CACHE",
                f"Creating new session cache for: {session_id}",
                extra={"session": session_id},
                detailed=True,
            )
            self.sessions[session_id] = _SessionCache(
                max_size_bytes=self._default_max_size_bytes
            )
        return self.sessions[session_id]

    def process_message(self, session_id: str, payload: Dict[str, Any]):
        """
        Processes an incoming message for a specific session.
        """
        session_cache = self._get_or_create_session(session_id)
        session_cache.process_message(payload)

    def get_history(self, session_id: str) -> List[Dict[str, Any]]:
        """
        Retrieves the entire history for a specific session.
        """
        session_cache = self._get_or_create_session(session_id)
        return session_cache.get_history()

    def save_history_and_clear(
        self, session_id: str, output_dir: str = "session_history"
    ):
        """
        Saves the history for a specific session and then clears that session
        from the manager.
        """
        if session_id in self.sessions:
            session_cache = self.sessions[session_id]
            session_cache.save_history(session_id, output_dir)

            session_cache.clear()
            del self.sessions[session_id]

            log_pipeline_step(
                "CACHE",
                f"Cleared cache for session: {session_id}",
                extra={"session": session_id},
                detailed=False,
            )
        else:
            log_pipeline_step(
                "CACHE",
                f"No history to save for session {session_id}, cache is empty.",
                extra={"session": session_id},
                detailed=False,
            )
