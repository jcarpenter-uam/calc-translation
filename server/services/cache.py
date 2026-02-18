import logging
import json
from typing import Any, Dict, List

from core.config import settings
from core.logging_setup import log_step, message_id_var, session_id_var, speaker_var
from redis import asyncio as aioredis

from .vtt import create_vtt_file

logger = logging.getLogger(__name__)

class TranscriptCache:
    """
    Redis-backed transcript cache.
    Structure in Redis:
      - per session/language hash of message_id -> serialized payload
      - per session/language list preserving insertion order
      - per session/language meta hash with approximate current byte size
      - per session set of active language codes
    """

    def __init__(self, max_size_mb: int = settings.MAX_CACHE_MB):
        self._default_max_size_bytes = max_size_mb * 1024 * 1024
        self._redis = aioredis.from_url(
            settings.REDIS_URL, encoding="utf-8", decode_responses=True
        )
        self._prefix = settings.REDIS_KEY_PREFIX

        with log_step("CACHE"):
            logger.debug(
                f"Redis TranscriptCache initialized. Per-session-language limit: {max_size_mb}MB."
            )

    async def close(self):
        await self._redis.aclose()

    async def ping(self):
        await self._redis.ping()

    def _language_items_key(self, session_id: str, language_code: str) -> str:
        return f"{self._prefix}:transcript:{session_id}:{language_code}:items"

    def _language_order_key(self, session_id: str, language_code: str) -> str:
        return f"{self._prefix}:transcript:{session_id}:{language_code}:order"

    def _language_meta_key(self, session_id: str, language_code: str) -> str:
        return f"{self._prefix}:transcript:{session_id}:{language_code}:meta"

    def _session_languages_key(self, session_id: str) -> str:
        return f"{self._prefix}:transcript:{session_id}:languages"

    async def _evict_until_space(self, session_id: str, language_code: str):
        items_key = self._language_items_key(session_id, language_code)
        order_key = self._language_order_key(session_id, language_code)
        meta_key = self._language_meta_key(session_id, language_code)

        while True:
            current_size = await self._redis.hget(meta_key, "current_size")
            current_size_int = int(current_size or 0)
            if current_size_int <= self._default_max_size_bytes:
                break

            oldest_id = await self._redis.lpop(order_key)
            if not oldest_id:
                await self._redis.hset(meta_key, mapping={"current_size": "0"})
                break

            old_payload = await self._redis.hget(items_key, oldest_id)
            await self._redis.hdel(items_key, oldest_id)

            old_size = len(old_payload.encode("utf-8")) if old_payload else 0
            if old_size:
                await self._redis.hincrby(meta_key, "current_size", -old_size)

            msg_id_token = message_id_var.set(oldest_id)
            with log_step("CACHE"):
                logger.debug(
                    f"Evicted item from Redis cache. Size: {old_size} bytes. "
                    f"Session-language current size now {current_size_int - old_size} bytes."
                )
            message_id_var.reset(msg_id_token)

    async def process_message(
        self, session_id: str, language_code: str, payload: Dict[str, Any]
    ):
        """
        Processes an incoming message for a specific session and language.
        """
        if not language_code:
            return

        session_token = session_id_var.set(session_id)
        try:
            message_id = payload.get("message_id")
            if not message_id:
                return

            speaker = payload.get("speaker")
            if not speaker:
                speaker = "Backfill"
                payload["speaker"] = speaker

            spk_token = speaker_var.set(speaker)
            msg_id_token = message_id_var.set(message_id)
            is_backfill_override = payload.get("is_backfill", False)

            try:
                items_key = self._language_items_key(session_id, language_code)
                order_key = self._language_order_key(session_id, language_code)
                meta_key = self._language_meta_key(session_id, language_code)
                langs_key = self._session_languages_key(session_id)

                existing_json = await self._redis.hget(items_key, message_id)

                if existing_json is None and payload.get("isfinalize") is True:
                    encoded_payload = json.dumps(payload, separators=(",", ":"))
                    payload_size = len(encoded_payload.encode("utf-8"))

                    async with self._redis.pipeline(transaction=True) as pipe:
                        pipe.rpush(order_key, message_id)
                        pipe.hset(items_key, message_id, encoded_payload)
                        pipe.hincrby(meta_key, "current_size", payload_size)
                        pipe.sadd(langs_key, language_code)
                        await pipe.execute()

                    await self._evict_until_space(session_id, language_code)
                    return

                if existing_json is None:
                    return

                message_type = payload.get("type")
                old_payload = json.loads(existing_json)
                old_size = len(existing_json.encode("utf-8"))

                if message_type == "correction" or is_backfill_override:
                    merged_payload = payload
                    log_msg = (
                        "Applied backfill override."
                        if is_backfill_override
                        else "Applied correction."
                    )
                elif message_type == "status_update":
                    merged_payload = dict(old_payload)
                    merged_payload.update(payload)
                    log_msg = "Applied status update."
                else:
                    return

                merged_json = json.dumps(merged_payload, separators=(",", ":"))
                new_size = len(merged_json.encode("utf-8"))
                size_diff = new_size - old_size

                async with self._redis.pipeline(transaction=True) as pipe:
                    pipe.hset(items_key, message_id, merged_json)
                    if size_diff:
                        pipe.hincrby(meta_key, "current_size", size_diff)
                    pipe.sadd(langs_key, language_code)
                    await pipe.execute()

                if size_diff > 0:
                    await self._evict_until_space(session_id, language_code)

                with log_step("CACHE"):
                    logger.debug(
                        f"{log_msg} Size diff: {size_diff} bytes for {message_id}."
                    )
            finally:
                speaker_var.reset(spk_token)
                message_id_var.reset(msg_id_token)
        finally:
            session_id_var.reset(session_token)

    async def get_history(
        self, session_id: str, language_code: str
    ) -> List[Dict[str, Any]]:
        """
        Retrieves the history for a specific session and language.
        """
        session_token = session_id_var.set(session_id)
        try:
            items_key = self._language_items_key(session_id, language_code)
            order_key = self._language_order_key(session_id, language_code)
            message_ids = await self._redis.lrange(order_key, 0, -1)
            if not message_ids:
                return []

            payloads = await self._redis.hmget(items_key, message_ids)
            history: List[Dict[str, Any]] = []
            for payload in payloads:
                if payload:
                    history.append(json.loads(payload))
            return history
        finally:
            session_id_var.reset(session_token)

    async def get_message(
        self, session_id: str, language_code: str, message_id: str
    ) -> Dict[str, Any] | None:
        session_token = session_id_var.set(session_id)
        try:
            if not message_id:
                return None
            items_key = self._language_items_key(session_id, language_code)
            payload = await self._redis.hget(items_key, message_id)
            if not payload:
                return None
            return json.loads(payload)
        finally:
            session_id_var.reset(session_token)

    async def clear_language_cache(self, session_id: str, language_code: str):
        """
        Removes the cache for a specific language.
        Used when a language stream is closed to ensure future joins trigger a fresh backfill.
        """
        session_token = session_id_var.set(session_id)
        try:
            items_key = self._language_items_key(session_id, language_code)
            order_key = self._language_order_key(session_id, language_code)
            meta_key = self._language_meta_key(session_id, language_code)
            langs_key = self._session_languages_key(session_id)

            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.delete(items_key, order_key, meta_key)
                pipe.srem(langs_key, language_code)
                await pipe.execute()

            with log_step("CACHE"):
                logger.info(f"Cleared Redis cache for language: {language_code}")
        finally:
            session_id_var.reset(session_token)

    async def save_history_and_clear(self, session_id: str, integration: str):
        """
        Saves the history for ALL languages in a specific session
        and then clears that session from the manager.
        """
        session_token = session_id_var.set(session_id)
        try:
            langs_key = self._session_languages_key(session_id)
            language_codes = await self._redis.smembers(langs_key)

            if not language_codes:
                with log_step("CACHE"):
                    logger.info(
                        f"No history to save for session {session_id}, Redis cache is empty."
                    )
                return

            for lang_code in language_codes:
                history = await self.get_history(session_id, lang_code)
                if not history:
                    continue
                await create_vtt_file(session_id, integration, lang_code, history)

                await self.clear_language_cache(session_id, lang_code)

            await self._redis.delete(langs_key)

            with log_step("CACHE"):
                logger.info("Cleared all Redis language caches for session")
        finally:
            session_id_var.reset(session_token)

    async def get_usage_stats(self, top_n: int = 10) -> Dict[str, Any]:
        """
        Returns approximate Redis transcript cache usage for observability.
        """
        pattern = f"{self._prefix}:transcript:*:*:meta"
        total_bytes = 0
        entries: List[Dict[str, Any]] = []

        async for key in self._redis.scan_iter(match=pattern):
            current_size = int((await self._redis.hget(key, "current_size")) or 0)
            if current_size <= 0:
                continue

            # {prefix}:transcript:{session_id}:{language_code}:meta
            parts = key.split(":")
            if len(parts) < 5:
                continue
            session_id = parts[-3]
            language_code = parts[-2]

            total_bytes += current_size
            entries.append(
                {
                    "session_id": session_id,
                    "language_code": language_code,
                    "size_bytes": current_size,
                }
            )

        entries.sort(key=lambda x: x["size_bytes"], reverse=True)
        return {
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
            "top_entries": entries[:top_n],
        }
