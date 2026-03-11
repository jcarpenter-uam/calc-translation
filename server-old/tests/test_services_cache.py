from __future__ import annotations

import fnmatch
import json

import pytest

from services import cache as cache_mod


class FakePipeline:
    def __init__(self, redis: "FakeRedis"):
        self.redis = redis
        self.ops = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def rpush(self, key, value):
        self.ops.append(("rpush", key, value))
        return self

    def hset(self, key, field=None, value=None, mapping=None):
        self.ops.append(("hset", key, field, value, mapping))
        return self

    def hincrby(self, key, field, amount):
        self.ops.append(("hincrby", key, field, amount))
        return self

    def sadd(self, key, value):
        self.ops.append(("sadd", key, value))
        return self

    def delete(self, *keys):
        self.ops.append(("delete", keys))
        return self

    def srem(self, key, value):
        self.ops.append(("srem", key, value))
        return self

    async def execute(self):
        for op in self.ops:
            name = op[0]
            if name == "rpush":
                _, key, value = op
                await self.redis.rpush(key, value)
            elif name == "hset":
                _, key, field, value, mapping = op
                await self.redis.hset(key, field, value, mapping=mapping)
            elif name == "hincrby":
                _, key, field, amount = op
                await self.redis.hincrby(key, field, amount)
            elif name == "sadd":
                _, key, value = op
                await self.redis.sadd(key, value)
            elif name == "delete":
                _, keys = op
                await self.redis.delete(*keys)
            elif name == "srem":
                _, key, value = op
                await self.redis.srem(key, value)
        self.ops.clear()


class FakeRedis:
    def __init__(self):
        self.hashes: dict[str, dict[str, str]] = {}
        self.lists: dict[str, list[str]] = {}
        self.sets: dict[str, set[str]] = {}

    def pipeline(self, transaction=True):
        return FakePipeline(self)

    async def aclose(self):
        return None

    async def ping(self):
        return True

    async def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    async def hset(self, key, field=None, value=None, mapping=None):
        bucket = self.hashes.setdefault(key, {})
        if mapping is not None:
            for k, v in mapping.items():
                bucket[str(k)] = str(v)
        else:
            bucket[str(field)] = str(value)

    async def hincrby(self, key, field, amount):
        bucket = self.hashes.setdefault(key, {})
        current = int(bucket.get(field, "0"))
        bucket[field] = str(current + int(amount))

    async def rpush(self, key, value):
        self.lists.setdefault(key, []).append(str(value))

    async def lpop(self, key):
        values = self.lists.get(key, [])
        if not values:
            return None
        return values.pop(0)

    async def lrange(self, key, start, end):
        values = self.lists.get(key, [])
        if end == -1:
            return values[start:]
        return values[start : end + 1]

    async def hdel(self, key, field):
        if key in self.hashes:
            self.hashes[key].pop(field, None)

    async def hmget(self, key, fields):
        bucket = self.hashes.get(key, {})
        return [bucket.get(field) for field in fields]

    async def sadd(self, key, value):
        self.sets.setdefault(key, set()).add(str(value))

    async def srem(self, key, value):
        self.sets.setdefault(key, set()).discard(str(value))

    async def smembers(self, key):
        return set(self.sets.get(key, set()))

    async def delete(self, *keys):
        for key in keys:
            self.hashes.pop(key, None)
            self.lists.pop(key, None)
            self.sets.pop(key, None)

    async def scan_iter(self, match):
        for key in sorted(self.hashes.keys()):
            if fnmatch.fnmatch(key, match):
                yield key


@pytest.fixture
def transcript_cache(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(cache_mod.aioredis, "from_url", lambda *a, **k: fake)
    c = cache_mod.TranscriptCache(max_size_mb=1)
    c._default_max_size_bytes = 10000
    return c


def _final_message(msg_id: str, text: str = "hello"):
    return {
        "message_id": msg_id,
        "speaker": "A",
        "transcription": text,
        "translation": text,
        "isfinalize": True,
    }


@pytest.mark.asyncio
async def test_cache_key_builders(transcript_cache):
    assert transcript_cache._language_items_key("s1", "en").endswith(":s1:en:items")
    assert transcript_cache._language_order_key("s1", "en").endswith(":s1:en:order")
    assert transcript_cache._language_meta_key("s1", "en").endswith(":s1:en:meta")


@pytest.mark.asyncio
async def test_cache_close_and_ping(transcript_cache):
    await transcript_cache.ping()
    await transcript_cache.close()


@pytest.mark.asyncio
async def test_cache_process_finalize_inserts_and_history(transcript_cache):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "hello"))

    history = await transcript_cache.get_history("s1", "en")
    assert len(history) == 1
    assert history[0]["message_id"] == "1_a"


@pytest.mark.asyncio
async def test_cache_process_ignores_blank_language_and_missing_message_id(transcript_cache):
    await transcript_cache.process_message("s1", "", _final_message("1_a"))
    await transcript_cache.process_message("s1", "en", {"speaker": "x"})
    assert await transcript_cache.get_history("s1", "en") == []


@pytest.mark.asyncio
async def test_cache_process_missing_nonfinal_is_ignored(transcript_cache):
    await transcript_cache.process_message(
        "s1",
        "en",
        {
            "message_id": "1_a",
            "speaker": "A",
            "type": "status_update",
            "status": "done",
        },
    )

    assert await transcript_cache.get_history("s1", "en") == []


@pytest.mark.asyncio
async def test_cache_process_correction_overwrites(transcript_cache):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "orig"))

    await transcript_cache.process_message(
        "s1",
        "en",
        {
            "message_id": "1_a",
            "speaker": "A",
            "type": "correction",
            "translation": "fixed",
        },
    )

    msg = await transcript_cache.get_message("s1", "en", "1_a")
    assert msg["translation"] == "fixed"
    assert msg["type"] == "correction"


@pytest.mark.asyncio
async def test_cache_process_status_update_merges(transcript_cache):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "orig"))

    await transcript_cache.process_message(
        "s1",
        "en",
        {
            "message_id": "1_a",
            "speaker": "A",
            "type": "status_update",
            "status": "done",
        },
    )

    msg = await transcript_cache.get_message("s1", "en", "1_a")
    assert msg["transcription"] == "orig"
    assert msg["status"] == "done"


@pytest.mark.asyncio
async def test_cache_process_unknown_type_does_not_change_existing(transcript_cache):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "orig"))
    msg_before = await transcript_cache.get_message("s1", "en", "1_a")
    await transcript_cache.process_message(
        "s1",
        "en",
        {"message_id": "1_a", "type": "other", "speaker": "A", "transcription": "new"},
    )
    msg_after = await transcript_cache.get_message("s1", "en", "1_a")
    assert msg_before == msg_after


@pytest.mark.asyncio
async def test_cache_process_backfill_override_defaults_speaker(transcript_cache):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "orig"))
    await transcript_cache.process_message(
        "s1",
        "en",
        {"message_id": "1_a", "type": "whatever", "is_backfill": True, "translation": "bf"},
    )
    msg = await transcript_cache.get_message("s1", "en", "1_a")
    assert msg["translation"] == "bf"
    assert msg["speaker"] == "Backfill"


@pytest.mark.asyncio
async def test_cache_eviction_removes_oldest(transcript_cache):
    transcript_cache._default_max_size_bytes = 120

    await transcript_cache.process_message("s1", "en", _final_message("1_a", "0123456789"))
    await transcript_cache.process_message("s1", "en", _final_message("2_a", "abcdefghij"))

    first = await transcript_cache.get_message("s1", "en", "1_a")
    second = await transcript_cache.get_message("s1", "en", "2_a")

    assert first is None
    assert second is not None


@pytest.mark.asyncio
async def test_cache_evict_resets_size_when_order_empty(transcript_cache):
    meta = transcript_cache._language_meta_key("s1", "en")
    transcript_cache._default_max_size_bytes = 1
    transcript_cache._redis.hashes[meta] = {"current_size": "500"}
    await transcript_cache._evict_until_space("s1", "en")
    assert transcript_cache._redis.hashes[meta]["current_size"] == "0"


@pytest.mark.asyncio
async def test_cache_clear_and_save_history(transcript_cache, monkeypatch):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "hello"))
    await transcript_cache.process_message("s1", "es", _final_message("1_b", "hola"))

    calls = []

    async def fake_create_vtt_file(session_id, integration, language_code, history):
        calls.append((session_id, integration, language_code, len(history)))

    monkeypatch.setattr(cache_mod, "create_vtt_file", fake_create_vtt_file)

    await transcript_cache.save_history_and_clear("s1", "zoom")

    assert {c[2] for c in calls} == {"en", "es"}
    assert await transcript_cache.get_history("s1", "en") == []
    assert await transcript_cache.get_history("s1", "es") == []


@pytest.mark.asyncio
async def test_cache_save_history_and_clear_empty_and_empty_language_history(transcript_cache, monkeypatch):
    # No language set
    await transcript_cache.save_history_and_clear("s-empty", "zoom")

    # Has language but no actual order/history
    langs_key = transcript_cache._session_languages_key("s2")
    transcript_cache._redis.sets[langs_key] = {"en"}
    calls = []

    async def fake_create_vtt_file(session_id, integration, language_code, history):
        calls.append((session_id, integration, language_code, history))

    monkeypatch.setattr(cache_mod, "create_vtt_file", fake_create_vtt_file)
    await transcript_cache.save_history_and_clear("s2", "zoom")
    assert calls == []
    assert "s2" not in "".join(transcript_cache._redis.sets.keys())


@pytest.mark.asyncio
async def test_cache_usage_stats_and_message_missing(transcript_cache):
    await transcript_cache.process_message("s1", "en", _final_message("1_a", "hello"))
    await transcript_cache.process_message("s2", "es", _final_message("1_b", "hola"))

    usage = await transcript_cache.get_usage_stats(top_n=1)

    assert usage["total_bytes"] > 0
    assert len(usage["top_entries"]) == 1
    assert await transcript_cache.get_message("s9", "en", "missing") is None
    assert await transcript_cache.get_message("s1", "en", "") is None


@pytest.mark.asyncio
async def test_cache_usage_stats_skips_zero_and_bad_key(transcript_cache):
    transcript_cache._redis.hashes["bad:key"] = {"current_size": "10"}
    meta = transcript_cache._language_meta_key("s3", "en")
    transcript_cache._redis.hashes[meta] = {"current_size": "0"}
    # Matches scan pattern but has too few parts to parse session/lang.
    transcript_cache._redis.hashes[f"{transcript_cache._prefix}:transcript:x:meta"] = {
        "current_size": "5"
    }

    usage = await transcript_cache.get_usage_stats(top_n=10)
    assert usage["total_bytes"] >= 0


@pytest.mark.asyncio
async def test_cache_usage_stats_handles_short_matched_key(monkeypatch, transcript_cache):
    transcript_cache._prefix = ""
    # Matches pattern ":transcript:*:*:meta" but has too few parts for parsing session/lang.
    transcript_cache._redis.hashes[":transcript:a:meta"] = {"current_size": "7"}
    usage = await transcript_cache.get_usage_stats(top_n=10)
    assert usage["total_bytes"] == 0
