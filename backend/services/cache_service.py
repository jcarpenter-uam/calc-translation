from collections import deque
from typing import Any, Deque, Dict, List

# Define the maximum number of "final" messages to keep in the cache.
MAX_CACHE_SIZE = 100


class TranscriptCache:
    """Manages a bounded history cache for transcript messages."""

    def __init__(self, max_size: int = MAX_CACHE_SIZE):
        """
        Initializes the cache with a maximum size.

        Args:
            max_size: The maximum number of items to store in the cache.
        """
        self._cache: Deque[Dict[str, Any]] = deque(maxlen=max_size)

    def add_message(self, payload: Dict[str, Any]):
        """
        Adds a new message payload to the cache.

        Args:
            payload: The dictionary payload of the message.
        """
        self._cache.append(payload)

    def get_history(self) -> List[Dict[str, Any]]:
        """
        Retrieves the entire history from the cache as a list.

        Returns:
            A list containing all the cached message payloads.
        """
        return list(self._cache)

    def __len__(self) -> int:
        """Returns the current number of items in the cache."""
        return len(self._cache)
