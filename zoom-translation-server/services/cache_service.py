import json
import os
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, List

from .debug_service import log_pipeline_step

MAX_CACHE_SIZE = 100


class TranscriptCache:
    """
    Manages a bounded history cache for transcript messages,
    supporting status updates and corrections via message_id.
    """

    def __init__(self, max_size: int = MAX_CACHE_SIZE):
        """Initializes the cache with a dictionary for lookups and a deque for order."""
        if max_size <= 0:
            raise ValueError("max_size must be a positive integer.")
        self._max_size = max_size
        self._cache_dict: Dict[str, Dict[str, Any]] = {}
        self._order_queue: Deque[str] = deque(maxlen=max_size)

    def clear(self):
        """Clears all entries from the cache."""
        self._cache_dict.clear()
        self._order_queue.clear()
        log_pipeline_step("CACHE", "Transcript cache has been cleared.", detailed=False)

    def process_message(self, payload: Dict[str, Any]):
        """
        Processes an incoming message. Adds a message to the cache only when
        'isfinalize' is true. Updates existing messages for corrections or status changes.
        """
        message_id = payload.get("message_id")
        if not message_id:
            return

        is_new_and_finalized = (
            message_id not in self._cache_dict and payload.get("isfinalize") is True
        )

        if is_new_and_finalized:
            if len(self._order_queue) == self._max_size:
                oldest_id_to_evict = self._order_queue[0]
                if oldest_id_to_evict in self._cache_dict:
                    del self._cache_dict[oldest_id_to_evict]

            self._order_queue.append(message_id)
            self._cache_dict[message_id] = payload

        elif message_id in self._cache_dict:
            message_type = payload.get("type")

            if message_type == "correction":
                self._cache_dict[message_id] = payload

            elif message_type == "status_update":
                self._cache_dict[message_id].update(payload)

    def get_history(self) -> List[Dict[str, Any]]:
        """
        Retrieves the entire history from the cache in chronological order.
        """
        return [self._cache_dict[msg_id] for msg_id in self._order_queue]

    def save_history_and_clear(self, output_dir: str = "session_history"):
        """
        Saves the current cache history to a timestamped JSON file
        in the specified directory and then clears the cache.
        """
        try:
            transcript_history = self.get_history()
            if not transcript_history:
                log_pipeline_step(
                    "CACHE", "No history to save, cache is empty.", detailed=False
                )
                return

            os.makedirs(output_dir, exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            file_name = f"history_{timestamp}.json"
            cache_filepath = os.path.join(output_dir, file_name)

            with open(cache_filepath, "w", encoding="utf-8") as f:
                json.dump(transcript_history, f, indent=4, ensure_ascii=False)

            log_pipeline_step(
                "CACHE",
                "Transcript cache saved to file successfully.",
                extra={
                    "path": cache_filepath,
                    "entries": len(transcript_history),
                },
                detailed=True,
            )

            self.clear()

        except Exception as e:
            log_pipeline_step(
                "CACHE",
                f"Failed to save history or clear transcript cache: {e}",
                detailed=False,
            )

    def __len__(self) -> int:
        """Returns the current number of items in the cache."""
        return len(self._cache_dict)
