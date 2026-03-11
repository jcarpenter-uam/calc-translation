import asyncio
import json
from types import SimpleNamespace

import pytest

from services.connection_manager import ConnectionManager


class FakeRedis:
    def __init__(self):
        self.sets = {}
        self.hashes = {}
        self.exists_map = {}
        self.published = []

    async def aclose(self):
        return None

    async def smembers(self, key):
        return set(self.sets.get(key, set()))

    async def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    async def srem(self, key, value):
        self.sets.setdefault(key, set()).discard(value)

    async def exists(self, key):
        return self.exists_map.get(key, False)

    async def hget(self, key, field):
        return self.hashes.get(key, {}).get(field)

    async def publish(self, channel, payload):
        self.published.append((channel, payload))

    async def hset(self, key, mapping):
        self.hashes.setdefault(key, {}).update(mapping)

    async def sadd(self, key, value):
        self.sets.setdefault(key, set()).add(value)

    async def delete(self, key):
        self.hashes.pop(key, None)


class FakeCache:
    def __init__(self):
        self.processed = []
        self.history = {}

    async def process_message(self, session_id, language, payload):
        self.processed.append((session_id, language, payload))

    async def get_history(self, session_id, language):
        return list(self.history.get((session_id, language), []))


class FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


class FakeTask:
    def __init__(self):
        self.cancelled = False

    def cancel(self):
        self.cancelled = True


def build_manager(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr("services.connection_manager.aioredis.from_url", lambda *a, **k: fake_redis)
    mgr = ConnectionManager(cache=FakeCache())
    return mgr, fake_redis


@pytest.mark.asyncio
async def test_global_active_sessions_filters_invalid_entries(monkeypatch):
    mgr, redis = build_manager(monkeypatch)

    active_key = mgr._active_sessions_key
    redis.sets[active_key] = {"s1", "s2"}
    redis.hashes[mgr._session_meta_key("s1")] = {
        "active": "1",
        "integration": "zoom",
        "start_time": "t",
        "shared_two_way_mode": "0",
        "owner_instance": "a",
    }
    redis.hashes[mgr._session_meta_key("s2")] = {
        "active": "0",
        "integration": "zoom",
    }
    redis.exists_map[mgr._receiver_lease_key("s1")] = True
    redis.exists_map[mgr._receiver_lease_key("s2")] = True

    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_languages[ws] = "en"

    sessions = await mgr.get_global_active_sessions()

    assert len(sessions) == 1
    assert sessions[0]["session_id"] == "s1"
    assert sessions[0]["viewer_languages"]["en"] == 1


@pytest.mark.asyncio
async def test_simple_client_helpers_and_waiting_languages(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.active_transcription_sessions = {
        "s1": {"integration": "zoom"},
        "s2": {"integration": "standalone"},
    }
    mgr.sessions["s1"] = [ws]
    mgr.socket_languages[ws] = "es"

    all_clients = mgr.get_all_clients()
    assert {x["session_id"] for x in all_clients} == {"s1", "s2"}
    assert mgr.get_clients_by_integration("zoom")[0]["session_id"] == "s1"
    assert mgr.get_viewer_count("s1", "es") == 1
    assert mgr.get_waiting_languages("s1") == {"es"}
    assert mgr.is_session_active("s1") is True
    assert mgr._get_effective_language("s2", "fr") == "fr"

    mgr.active_transcription_sessions["s2"]["shared_two_way_mode"] = True
    assert mgr._get_effective_language("s2", "fr") == "two_way"


@pytest.mark.asyncio
async def test_global_active_sessions_removes_missing_lease(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    redis.sets[mgr._active_sessions_key] = {"s1"}
    redis.hashes[mgr._session_meta_key("s1")] = {"active": "1", "integration": "zoom"}
    redis.exists_map[mgr._receiver_lease_key("s1")] = False

    sessions = await mgr.get_global_active_sessions()
    assert sessions == []
    assert "s1" not in redis.sets[mgr._active_sessions_key]


@pytest.mark.asyncio
async def test_is_session_active_global_and_metadata(monkeypatch):
    mgr, redis = build_manager(monkeypatch)

    mgr.active_transcription_sessions["local"] = {
        "integration": "zoom",
        "shared_two_way_mode": True,
    }
    assert await mgr.is_session_active_global("local") is True

    remote = "remote"
    redis.hashes[mgr._session_meta_key(remote)] = {
        "active": "1",
        "integration": "standalone",
        "start_time": "now",
        "shared_two_way_mode": "1",
    }
    redis.exists_map[mgr._receiver_lease_key(remote)] = True

    assert await mgr.is_session_active_global(remote) is True
    meta = await mgr.get_session_metadata_global(remote)
    assert meta["integration"] == "standalone"
    assert meta["shared_two_way_mode"] is True


@pytest.mark.asyncio
async def test_active_global_and_metadata_falsey_paths(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    redis.hashes[mgr._session_meta_key("x")] = {"active": "0"}
    assert await mgr.is_session_active_global("x") is False

    redis.hashes[mgr._session_meta_key("y")] = {"active": "1"}
    redis.exists_map[mgr._receiver_lease_key("y")] = False
    assert await mgr.is_session_active_global("y") is False
    assert await mgr.get_session_metadata_global("missing") == {}
    assert await mgr.get_session_metadata_global("y") == {}


@pytest.mark.asyncio
async def test_get_session_metadata_global_local_path(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    mgr.active_transcription_sessions["local"] = {
        "integration": "zoom",
        "shared_two_way_mode": True,
    }
    meta = await mgr.get_session_metadata_global("local")
    assert meta["integration"] == "zoom"


@pytest.mark.asyncio
async def test_handle_control_message_sync_and_async(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    called = []

    def sync_cb(lang):
        called.append(("sync", lang))

    async def async_cb(lang):
        called.append(("async", lang))

    mgr.register_language_callback("s1", sync_cb)
    mgr.register_language_removal_callback("s1", async_cb)

    await mgr._handle_control_message({"session_id": "s1", "command": "language_request", "language_code": "es"})
    await mgr._handle_control_message({"session_id": "s1", "command": "language_remove", "language_code": "fr"})
    await mgr._handle_control_message({"session_id": "s1", "command": "unknown", "language_code": "fr"})

    assert ("sync", "es") in called
    assert ("async", "fr") in called


@pytest.mark.asyncio
async def test_handle_control_message_validation_and_errors(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    await mgr._handle_control_message({"session_id": "s1"})
    await mgr._handle_control_message(
        {"session_id": "s1", "command": "language_request", "language_code": "es"}
    )

    def bad_cb(_lang):
        raise RuntimeError("boom")

    mgr.register_language_callback("s1", bad_cb)
    await mgr._handle_control_message(
        {"session_id": "s1", "command": "language_request", "language_code": "es"}
    )


@pytest.mark.asyncio
async def test_publish_control_to_owner_local_and_remote(monkeypatch):
    mgr, redis = build_manager(monkeypatch)

    got = []

    async def fake_handle(cmd):
        got.append(cmd)

    monkeypatch.setattr(mgr, "_handle_control_message", fake_handle)

    # No owner -> local dispatch
    await mgr._publish_control_to_owner("s1", "language_request", "es")
    assert got and got[0]["language_code"] == "es"

    # Owner present -> publish
    redis.hashes[mgr._session_meta_key("s2")] = {"owner_instance": "owner-1"}
    await mgr._publish_control_to_owner("s2", "language_remove", "fr")

    assert redis.published
    channel, payload = redis.published[-1]
    assert channel.endswith(":control:owner-1")
    assert json.loads(payload)["command"] == "language_remove"


@pytest.mark.asyncio
async def test_broadcast_to_session_processes_cache_and_publishes(monkeypatch):
    mgr, redis = build_manager(monkeypatch)

    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_languages[ws] = "en"

    payload = {"message_id": "1", "target_language": "en", "text": "hi"}
    await mgr.broadcast_to_session("s1", payload)

    assert mgr.cache.processed[0][1] == "en"
    assert ws.sent and ws.sent[0]["text"] == "hi"
    assert redis.published


@pytest.mark.asyncio
async def test_connect_replays_cached_history_for_effective_language(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    mgr.cache.history[("s1", "two_way")] = [{"m": 1}]

    async def fake_meta(session_id):
        return {"shared_two_way_mode": True}

    async def inactive(_sid):
        return False

    monkeypatch.setattr(mgr, "get_session_metadata_global", fake_meta)
    monkeypatch.setattr(mgr, "is_session_active_global", inactive)

    ws = FakeWebSocket()
    await mgr.connect(ws, "s1", "en", "u1")

    assert mgr.socket_languages[ws] == "two_way"
    assert ws.sent == [{"m": 1}]


@pytest.mark.asyncio
async def test_register_and_deregister_transcription_session(monkeypatch):
    mgr, redis = build_manager(monkeypatch)

    ok = await mgr.register_transcription_session("s1", "zoom", shared_two_way_mode=True)
    assert ok is True
    assert redis.hashes[mgr._session_meta_key("s1")]["active"] == "1"

    dup = await mgr.register_transcription_session("s1", "zoom")
    assert dup is False

    await mgr.deregister_transcription_session("s1")
    assert "s1" not in mgr.active_transcription_sessions


@pytest.mark.asyncio
async def test_register_transcription_session_records_waiting_users(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_users[ws] = "u1"
    seen = []

    async def record(session_id, user_id):
        seen.append((session_id, user_id))

    monkeypatch.setattr(mgr, "_record_attendee", record)
    ok = await mgr.register_transcription_session("s1", "zoom")
    await asyncio.sleep(0)
    assert ok is True
    assert seen == [("s1", "u1")]


@pytest.mark.asyncio
async def test_deregister_transcription_session_cleans_callbacks_and_tasks(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    mgr.active_transcription_sessions["s1"] = {"integration": "zoom"}
    mgr.language_request_callbacks["s1"] = lambda _lang: None
    mgr.language_removal_callbacks["s1"] = lambda _lang: None
    t1 = FakeTask()
    t2 = FakeTask()
    mgr.cleanup_tasks["s1"] = {"fr": t1, "es": t2}

    await mgr.deregister_transcription_session("s1")
    assert "s1" not in mgr.language_request_callbacks
    assert "s1" not in mgr.language_removal_callbacks
    assert "s1" not in mgr.cleanup_tasks
    assert t1.cancelled is True and t2.cancelled is True


@pytest.mark.asyncio
async def test_start_and_close_lifecycle(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    closed = {"ok": False}

    async def fake_loop():
        await asyncio.sleep(3600)

    async def fake_aclose():
        closed["ok"] = True

    monkeypatch.setattr(mgr, "_pubsub_loop", fake_loop)
    monkeypatch.setattr(redis, "aclose", fake_aclose)

    await mgr.start()
    assert mgr._pubsub_task is not None

    await mgr.close()
    assert mgr._pubsub_task is None
    assert closed["ok"] is True


@pytest.mark.asyncio
async def test_send_to_local_viewers_filters_language_and_shared_mode(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    en_ws = FakeWebSocket()
    es_ws = FakeWebSocket()
    mgr.sessions["s1"] = [en_ws, es_ws]
    mgr.socket_languages[en_ws] = "en"
    mgr.socket_languages[es_ws] = "es"

    async def one_way(_):
        return {"shared_two_way_mode": False}

    monkeypatch.setattr(mgr, "get_session_metadata_global", one_way)
    await mgr._send_to_local_viewers("s1", {"target_language": "en", "msg": 1})
    assert en_ws.sent and not es_ws.sent

    async def two_way(_):
        return {"shared_two_way_mode": True}

    monkeypatch.setattr(mgr, "get_session_metadata_global", two_way)
    await mgr._send_to_local_viewers("s1", {"target_language": "en", "msg": 2})
    assert len(en_ws.sent) == 2
    assert len(es_ws.sent) == 1


@pytest.mark.asyncio
async def test_send_to_local_viewers_missing_session(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    await mgr._send_to_local_viewers("missing", {"target_language": "en"})


@pytest.mark.asyncio
async def test_connect_active_session_requests_language_and_cancels_cleanup(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    seen = {"publish": [], "attendee": []}
    cleanup_task = FakeTask()
    mgr.cleanup_tasks["s1"] = {"fr": cleanup_task}
    mgr.cache.history[("s1", "fr")] = [{"id": 1}]

    async def meta(_sid):
        return {"shared_two_way_mode": False}

    async def active(_sid):
        return True

    async def pub(session_id, cmd, lang):
        seen["publish"].append((session_id, cmd, lang))

    async def attendee(session_id, user):
        seen["attendee"].append((session_id, user))

    monkeypatch.setattr(mgr, "get_session_metadata_global", meta)
    monkeypatch.setattr(mgr, "is_session_active_global", active)
    monkeypatch.setattr(mgr, "_publish_control_to_owner", pub)
    monkeypatch.setattr(mgr, "_record_attendee", attendee)

    await mgr.connect(ws, "s1", "fr", "u1")
    await asyncio.sleep(0)

    assert cleanup_task.cancelled is True
    assert seen["publish"] == [("s1", "language_request", "fr")]
    assert seen["attendee"] == [("s1", "u1")]
    assert ws.sent == [{"id": 1}]


@pytest.mark.asyncio
async def test_connect_shared_two_way_active_does_not_request_language(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    seen = {"publish": 0, "attendee": 0}

    async def meta(_sid):
        return {"shared_two_way_mode": True}

    async def active(_sid):
        return True

    async def pub(*_args, **_kwargs):
        seen["publish"] += 1

    async def attendee(*_args, **_kwargs):
        seen["attendee"] += 1

    monkeypatch.setattr(mgr, "get_session_metadata_global", meta)
    monkeypatch.setattr(mgr, "is_session_active_global", active)
    monkeypatch.setattr(mgr, "_publish_control_to_owner", pub)
    monkeypatch.setattr(mgr, "_record_attendee", attendee)

    await mgr.connect(ws, "s1", "fr", "u1")
    await asyncio.sleep(0)
    assert seen["publish"] == 0
    assert seen["attendee"] == 1


@pytest.mark.asyncio
async def test_disconnect_schedules_cleanup_for_non_english(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_languages[ws] = "fr"
    mgr.socket_users[ws] = "u1"

    async def active(_sid):
        return True

    async def meta(_sid):
        return {"shared_two_way_mode": False}

    created = {"n": 0}

    async def fake_cleanup(session_id, language):
        created["n"] += 1
        return None

    monkeypatch.setattr(mgr, "is_session_active_global", active)
    monkeypatch.setattr(mgr, "get_session_metadata_global", meta)
    monkeypatch.setattr(mgr, "_cleanup_language_stream", fake_cleanup)

    await mgr.disconnect(ws, "s1")
    await asyncio.sleep(0)
    assert created["n"] == 1
    assert "s1" in mgr.cleanup_tasks and "fr" in mgr.cleanup_tasks["s1"]


@pytest.mark.asyncio
async def test_disconnect_inactive_session_returns_early(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_languages[ws] = "fr"

    async def inactive(_sid):
        return False

    monkeypatch.setattr(mgr, "is_session_active_global", inactive)
    await mgr.disconnect(ws, "s1")
    assert "s1" not in mgr.cleanup_tasks


@pytest.mark.asyncio
async def test_disconnect_cancels_existing_cleanup_task(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_languages[ws] = "fr"
    old_task = FakeTask()
    mgr.cleanup_tasks["s1"] = {"fr": old_task}

    async def active(_sid):
        return True

    async def meta(_sid):
        return {"shared_two_way_mode": False}

    async def fake_cleanup(*_args, **_kwargs):
        return None

    monkeypatch.setattr(mgr, "is_session_active_global", active)
    monkeypatch.setattr(mgr, "get_session_metadata_global", meta)
    monkeypatch.setattr(mgr, "_cleanup_language_stream", fake_cleanup)

    await mgr.disconnect(ws, "s1")
    assert old_task.cancelled is True


@pytest.mark.asyncio
async def test_cleanup_language_stream_publishes_and_removes_task(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    seen = []

    async def no_sleep(_):
        return None

    async def active(_sid):
        return True

    async def publish(session_id, cmd, lang):
        seen.append((session_id, cmd, lang))

    monkeypatch.setattr("services.connection_manager.asyncio.sleep", no_sleep)
    monkeypatch.setattr(mgr, "is_session_active_global", active)
    monkeypatch.setattr(mgr, "_publish_control_to_owner", publish)
    mgr.cleanup_tasks["s1"] = {"fr": object()}

    await mgr._cleanup_language_stream("s1", "fr")
    assert seen == [("s1", "language_remove", "fr")]
    assert "fr" not in mgr.cleanup_tasks["s1"]


@pytest.mark.asyncio
async def test_cleanup_language_stream_inactive_and_cancelled(monkeypatch):
    mgr, _ = build_manager(monkeypatch)

    async def no_sleep(_):
        return None

    async def inactive(_sid):
        return False

    monkeypatch.setattr("services.connection_manager.asyncio.sleep", no_sleep)
    monkeypatch.setattr(mgr, "is_session_active_global", inactive)
    mgr.cleanup_tasks["s1"] = {"fr": object()}
    await mgr._cleanup_language_stream("s1", "fr")
    assert "fr" not in mgr.cleanup_tasks["s1"]

    async def cancel_sleep(_):
        raise asyncio.CancelledError()

    monkeypatch.setattr("services.connection_manager.asyncio.sleep", cancel_sleep)
    mgr.cleanup_tasks["s2"] = {"de": object()}
    await mgr._cleanup_language_stream("s2", "de")
    assert "de" not in mgr.cleanup_tasks["s2"]


@pytest.mark.asyncio
async def test_migrate_session_moves_connections_and_records_attendees(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.sessions["old"] = [ws]
    mgr.socket_users[ws] = "u1"
    recorded = []

    async def rec(session_id, user_id):
        recorded.append((session_id, user_id))

    monkeypatch.setattr(mgr, "_record_attendee", rec)

    await mgr.migrate_session("old", "new")
    await asyncio.sleep(0)
    assert "old" not in mgr.sessions
    assert ws in mgr.sessions["new"]
    assert ws.sent == [{"type": "status", "status": "active"}]
    assert recorded == [("new", "u1")]


@pytest.mark.asyncio
async def test_migrate_session_handles_send_error_and_outer_exception(monkeypatch):
    mgr, _ = build_manager(monkeypatch)

    class BadWS(FakeWebSocket):
        async def send_json(self, payload):
            raise RuntimeError("no send")

    ws = BadWS()
    mgr.sessions["old"] = [ws]
    mgr.socket_users[ws] = "u1"
    await mgr.migrate_session("old", "new")

    class ExplodingSessions(dict):
        def __contains__(self, key):
            return key == "new"

        def pop(self, key):
            raise RuntimeError("explode")

    mgr.sessions = ExplodingSessions({"new": [ws]})
    await mgr.migrate_session("new", "x")


@pytest.mark.asyncio
async def test_record_attendee_success_and_error_paths(monkeypatch):
    mgr, _ = build_manager(monkeypatch)
    await mgr._record_attendee("s1", "")

    called = {"exec": 0, "commit": 0}

    class GoodSession:
        async def execute(self, *args, **kwargs):
            called["exec"] += 1

        async def commit(self):
            called["commit"] += 1

    class Ctx:
        async def __aenter__(self):
            return GoodSession()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("services.connection_manager.AsyncSessionLocal", lambda: Ctx())
    await mgr._record_attendee("s1", "u1")
    assert called == {"exec": 1, "commit": 1}

    class BadCtx:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("services.connection_manager.AsyncSessionLocal", lambda: BadCtx())
    await mgr._record_attendee("s1", "u2")


@pytest.mark.asyncio
async def test_pubsub_loop_processes_event_and_control_messages(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    ws = FakeWebSocket()
    mgr.sessions["s1"] = [ws]
    mgr.socket_users[ws] = "u1"
    mgr.socket_languages[ws] = "es"
    sent = {"viewer": [], "control": [], "handle": []}

    async def send_local(session_id, payload):
        sent["viewer"].append((session_id, payload))

    async def publish_owner(session_id, command, lang):
        sent["control"].append((session_id, command, lang))

    async def handle(parsed):
        sent["handle"].append(parsed)

    monkeypatch.setattr(mgr, "_send_to_local_viewers", send_local)
    monkeypatch.setattr(mgr, "_publish_control_to_owner", publish_owner)
    monkeypatch.setattr(mgr, "_handle_control_message", handle)

    class FakePubSub:
        def __init__(self):
            self.messages = [
                {
                    "type": "pmessage",
                    "data": json.dumps(
                        {
                            "sender_instance": "other",
                            "session_id": "s1",
                            "payload": {"type": "status", "status": "active"},
                        }
                    ),
                },
                {
                    "type": "message",
                    "data": json.dumps(
                        {
                            "session_id": "s1",
                            "command": "language_request",
                            "language_code": "fr",
                        }
                    ),
                },
            ]
            self.closed = False

        async def psubscribe(self, *_args):
            return None

        async def subscribe(self, *_args):
            return None

        async def get_message(self, **_kwargs):
            if self.messages:
                return self.messages.pop(0)
            raise asyncio.CancelledError()

        async def aclose(self):
            self.closed = True

    pubsub = FakePubSub()
    redis.pubsub = lambda: pubsub

    with pytest.raises(asyncio.CancelledError):
        await mgr._pubsub_loop()

    await asyncio.sleep(0)
    assert sent["viewer"] and sent["viewer"][0][0] == "s1"
    assert ("s1", "language_request", "es") in sent["control"]
    assert sent["handle"] and sent["handle"][0]["language_code"] == "fr"


@pytest.mark.asyncio
async def test_pubsub_loop_ignores_empty_bad_json_same_sender_and_no_data(monkeypatch):
    mgr, redis = build_manager(monkeypatch)
    called = {"viewer": 0}

    async def send_local(*_args, **_kwargs):
        called["viewer"] += 1

    monkeypatch.setattr(mgr, "_send_to_local_viewers", send_local)

    class FakePubSub:
        def __init__(self):
            self.messages = [
                None,
                {"type": "pmessage", "data": ""},
                {"type": "pmessage", "data": "not-json"},
                {
                    "type": "pmessage",
                    "data": json.dumps(
                        {
                            "sender_instance": mgr._instance_id,
                            "session_id": "s1",
                            "payload": {"type": "status"},
                        }
                    ),
                },
            ]

        async def psubscribe(self, *_args):
            return None

        async def subscribe(self, *_args):
            return None

        async def get_message(self, **_kwargs):
            if self.messages:
                return self.messages.pop(0)
            raise asyncio.CancelledError()

        async def aclose(self):
            return None

    redis.pubsub = lambda: FakePubSub()
    with pytest.raises(asyncio.CancelledError):
        await mgr._pubsub_loop()
    assert called["viewer"] == 0
