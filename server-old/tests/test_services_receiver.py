import asyncio
import base64
import json
from types import SimpleNamespace

import pytest
from fastapi import WebSocketDisconnect

from services import receiver
from services.soniox import SonioxResult, SonioxConnectionError, SonioxFatalError


class FakeRedisLease:
    def __init__(self):
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def expire(self, key, ttl):
        return key in self.values

    async def eval(self, lua, nkeys, key, owner, ttl=None):
        if "expire" in lua:
            return 1 if self.values.get(key) == owner else 0
        if "del" in lua:
            if self.values.get(key) == owner:
                del self.values[key]
                return 1
            return 0
        return 0


class FakeViewerManager:
    def __init__(self):
        self.broadcasts = []
        self.migrations = []
        self.registered = []
        self.deregistered = []
        self.language_callbacks = {}
        self.language_remove_callbacks = {}
        self.waiting_languages = {"es"}
        self._instance_id = "instance-1"
        self.cache = SimpleNamespace(
            clear_language_cache=self._clear_language_cache,
            save_history_and_clear=self._save_history_and_clear,
        )
        self.cleared = []
        self.saved = []

    async def broadcast_to_session(self, session_id, payload):
        self.broadcasts.append((session_id, payload))

    async def migrate_session(self, old_session_id, new_session_id):
        self.migrations.append((old_session_id, new_session_id))

    async def register_transcription_session(self, session_id, integration, shared_two_way_mode=False):
        self.registered.append((session_id, integration, shared_two_way_mode))
        return True

    async def deregister_transcription_session(self, session_id):
        self.deregistered.append(session_id)

    def register_language_callback(self, session_id, cb):
        self.language_callbacks[session_id] = cb

    def register_language_removal_callback(self, session_id, cb):
        self.language_remove_callbacks[session_id] = cb

    def get_waiting_languages(self, _session_id):
        return set(self.waiting_languages)

    async def _clear_language_cache(self, session_id, language_code):
        self.cleared.append((session_id, language_code))

    async def _save_history_and_clear(self, session_id, integration):
        self.saved.append((session_id, integration))


class FakeDbResult:
    def __init__(self, scalar=None, all_rows=None, mappings_rows=None):
        self._scalar = scalar
        self._all_rows = all_rows or []
        self._mappings_rows = mappings_rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def all(self):
        return self._all_rows

    def mappings(self):
        return SimpleNamespace(all=lambda: list(self._mappings_rows))


class FakeDbSession:
    def __init__(self, results):
        self.results = list(results)
        self.commits = 0
        self.executed = 0

    async def execute(self, _stmt):
        self.executed += 1
        return self.results.pop(0)

    async def commit(self):
        self.commits += 1


class FakeDbContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def fake_session_factory(results):
    session = FakeDbSession(results)

    def _factory():
        return FakeDbContext(session)

    _factory.session = session
    return _factory


class FakeSocket:
    def __init__(self, messages=None, disconnect=False):
        self.messages = list(messages or [])
        self.disconnect = disconnect
        self.closed = []

    async def receive_text(self):
        if not self.messages:
            if self.disconnect:
                raise WebSocketDisconnect()
            raise RuntimeError("no more messages")
        return self.messages.pop(0)

    async def close(self, code, reason):
        self.closed.append((code, reason))


@pytest.fixture(autouse=True)
def clear_active_sessions():
    receiver.ACTIVE_SESSIONS.clear()
    yield
    receiver.ACTIVE_SESSIONS.clear()


@pytest.mark.asyncio
async def test_receiver_lease_acquire_and_release(monkeypatch):
    fake = FakeRedisLease()
    monkeypatch.setattr(receiver, "RECEIVER_REDIS", fake)

    lease = receiver.ReceiverLease("s1", "owner", ttl_seconds=10, heartbeat_interval=1)
    ok = await lease.acquire(wait_timeout_seconds=1)
    assert ok is True

    assert await lease._compare_and_expire() is True
    await lease.stop(release=True)
    assert fake.values == {}


@pytest.mark.asyncio
async def test_close_receiver_resources(monkeypatch):
    closed = {"ok": False}

    class FakeRedis:
        async def aclose(self):
            closed["ok"] = True

    monkeypatch.setattr(receiver, "RECEIVER_REDIS", FakeRedis())
    await receiver.close_receiver_resources()
    assert closed["ok"] is True


@pytest.mark.asyncio
async def test_receiver_lease_acquire_timeout(monkeypatch):
    fake = FakeRedisLease()
    fake.values["calc-translation:receiver:lease:s1"] = "other"
    monkeypatch.setattr(receiver, "RECEIVER_REDIS", fake)

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(receiver.asyncio, "sleep", fast_sleep)

    lease = receiver.ReceiverLease("s1", "owner")
    ok = await lease.acquire(wait_timeout_seconds=0)
    assert ok is False


@pytest.mark.asyncio
async def test_receiver_lease_start_heartbeat_and_stop_without_release(monkeypatch):
    fake = FakeRedisLease()
    monkeypatch.setattr(receiver, "RECEIVER_REDIS", fake)

    lease = receiver.ReceiverLease("s1", "owner", ttl_seconds=10, heartbeat_interval=0)

    async def always_false():
        return False

    deleted = {"called": False}

    async def mark_delete():
        deleted["called"] = True
        return True

    monkeypatch.setattr(lease, "_compare_and_expire", always_false)
    monkeypatch.setattr(lease, "_compare_and_delete", mark_delete)

    await lease.start_heartbeat()
    await asyncio.sleep(0)
    await lease.stop(release=False)
    assert lease._heartbeat_task is None
    assert deleted["called"] is False


@pytest.mark.asyncio
async def test_stream_handler_message_pipeline(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )
    h.stream_ready.set()

    await h._on_transcription_message(
        SonioxResult(
            transcription="hello",
            translation="hola",
            is_final=False,
            source_language="en",
            target_language="es",
            speaker="A",
            start_ms=10,
            end_ms=100,
        )
    )
    await h._on_transcription_message(
        SonioxResult(
            transcription="hello",
            translation="hola",
            is_final=True,
            source_language="en",
            target_language="es",
            speaker="A",
            start_ms=10,
            end_ms=100,
        )
    )

    assert len(vm.broadcasts) == 2
    assert vm.broadcasts[0][1]["type"] == "partial"
    assert vm.broadcasts[1][1]["type"] == "final"


@pytest.mark.asyncio
async def test_stream_handler_connect_send_keepalive_close(monkeypatch):
    vm = FakeViewerManager()
    calls = {"connect": 0, "chunks": [], "json": [], "finalized": 0}

    class FakeTask:
        def __await__(self):
            if False:
                yield
            return None

    class FakeSonioxService:
        def __init__(self, **kwargs):
            self.receive_task = FakeTask()
            self.current_speaker = None
            self.kwargs = kwargs

        async def connect(self):
            calls["connect"] += 1

        async def send_chunk(self, chunk):
            calls["chunks"].append(chunk)

        async def send_json(self, payload):
            calls["json"].append(payload)

        async def finalize_stream(self):
            calls["finalized"] += 1

    monkeypatch.setattr(receiver, "SonioxService", FakeSonioxService)

    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )

    await h.connect()
    h.update_speaker("Alex")
    await h.send_audio(b"abc")
    await h.send_keepalive()
    await h.close()

    assert calls["connect"] == 1
    assert calls["chunks"] == [b"abc"]
    assert calls["json"] == [{"type": "keepalive"}]
    assert calls["finalized"] == 1
    assert h.service.current_speaker == "Alex"


@pytest.mark.asyncio
async def test_stream_handler_await_next_utterance(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )
    h.stream_ready.set()
    h.await_next_utterance = True

    await h._on_transcription_message(
        SonioxResult(transcription="x", translation="x", is_final=False)
    )
    assert vm.broadcasts == []

    await h._on_transcription_message(
        SonioxResult(transcription="x", translation="x", is_final=True)
    )
    assert h.await_next_utterance is False


@pytest.mark.asyncio
async def test_stream_handler_service_error_paths(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )

    await h._on_service_error(SonioxFatalError("fatal"))

    called = {"n": 0}

    async def fake_reconnect():
        called["n"] += 1

    monkeypatch.setattr(h, "reconnect_service", fake_reconnect)
    await h._on_service_error(SonioxConnectionError("retry"))

    await asyncio.sleep(0)
    assert called["n"] == 1


@pytest.mark.asyncio
async def test_stream_handler_reconnect_service_retry_and_success(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )
    h.service = SimpleNamespace(finalize_stream=lambda: asyncio.sleep(0))

    attempts = {"n": 0}

    async def flaky_connect():
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RuntimeError("boom")
        return None

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(h, "connect", flaky_connect)
    monkeypatch.setattr(receiver.asyncio, "sleep", fast_sleep)

    await h.reconnect_service()
    assert attempts["n"] == 2
    assert h.is_reconnecting is False
    assert h.reconnect_task is None


def test_meeting_session_two_way_helpers():
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="standalone",
        viewer_manager=SimpleNamespace(),
        loop=SimpleNamespace(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms.translation_type = "two_way"
    ms.translation_language_a = "en"
    ms.translation_language_b = "es"

    assert ms._is_two_way_session() is True
    cfg = ms._get_translation_config()
    assert cfg["type"] == "two_way"


@pytest.mark.asyncio
async def test_meeting_session_initialize_and_wrappers(monkeypatch):
    vm = FakeViewerManager()
    lease = SimpleNamespace(start_heartbeat=lambda: asyncio.sleep(0))
    backfill = SimpleNamespace()
    summary = SimpleNamespace()
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=lease,
        backfill_service=backfill,
        summary_service=summary,
    )

    meeting = SimpleNamespace(
        id="s1",
        language_hints=["en"],
        translation_type="one_way",
        translation_language_a=None,
        translation_language_b=None,
        readable_id="abc",
    )
    sibling = SimpleNamespace(id="old-1")
    db_factory = fake_session_factory([FakeDbResult(scalar=meeting), FakeDbResult(all_rows=[sibling])])
    monkeypatch.setattr(receiver, "AsyncSessionLocal", db_factory)
    monkeypatch.setattr(receiver, "add_session_log_handler", lambda *_: "handler")

    added = []

    async def add_lang(lang):
        added.append(lang)

    monkeypatch.setattr(ms, "add_language_stream", add_lang)

    await ms.initialize()
    await ms._add_language_stream_wrapper("fr")
    await ms._remove_language_stream_wrapper("fr")

    assert ("old-1", "s1") in vm.migrations
    assert vm.registered == [("s1", "zoom", False)]
    assert vm.broadcasts[0][1]["status"] == "active"
    assert "s1" in vm.language_callbacks
    assert "s1" in vm.language_remove_callbacks
    assert "en" in added
    assert "es" in added


@pytest.mark.asyncio
async def test_meeting_session_add_remove_dispatch_and_update(monkeypatch):
    vm = FakeViewerManager()
    backfill_calls = {"session": [], "gap": []}

    class FakeBackfill:
        async def run_session_backfill(self, **kwargs):
            backfill_calls["session"].append(kwargs)

        async def backfill_gap(self, **kwargs):
            backfill_calls["gap"].append(kwargs)

    class FakeHandler:
        def __init__(self, **kwargs):
            self.language_code = kwargs["language_code"]
            self.utterance_count = 0
            self.is_new_utterance = True
            self.await_next_utterance = False
            self.stream_ready = asyncio.Event()
            self.timestamp_service = SimpleNamespace(start_time=kwargs["session_start_time"])
            self.closed = False
            self.speaker_updates = []
            self.audio = []

        async def connect(self):
            return None

        async def close(self):
            self.closed = True

        def update_speaker(self, speaker):
            self.speaker_updates.append(speaker)

        async def send_audio(self, chunk):
            self.audio.append(chunk)

    monkeypatch.setattr(receiver, "StreamHandler", FakeHandler)
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=FakeBackfill(),
        summary_service=SimpleNamespace(),
    )

    await ms.add_language_stream("en")
    assert "en" in ms.active_handlers
    ms.active_handlers["en"].utterance_count = 3
    ms.active_handlers["en"].is_new_utterance = False

    await ms.add_language_stream("fr")
    await asyncio.sleep(0)
    assert ms.active_handlers["fr"].await_next_utterance is True
    assert backfill_calls["session"][0]["upto_count"] == 2
    assert backfill_calls["gap"][0]["gap_utterance_count"] == 3

    now = receiver.datetime.now()
    ms.update_start_time(now)
    assert ms.active_handlers["en"].timestamp_service.start_time == now
    await ms.dispatch_audio("Jane", b"audio")
    assert ms.active_handlers["en"].audio == [b"audio"]
    assert ms.active_handlers["fr"].speaker_updates == ["Jane"]

    await ms.remove_language_stream("fr")
    assert ("s1", "fr") in vm.cleared


@pytest.mark.asyncio
async def test_meeting_session_add_language_stream_skips_and_errors(monkeypatch):
    vm = FakeViewerManager()

    class BrokenHandler:
        def __init__(self, **kwargs):
            self.language_code = kwargs["language_code"]

        async def connect(self):
            raise RuntimeError("nope")

        async def close(self):
            return None

    monkeypatch.setattr(receiver, "StreamHandler", BrokenHandler)
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="standalone",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms.translation_type = "two_way"
    ms.translation_language_a = "en"
    ms.translation_language_b = "fr"

    await ms.add_language_stream("fr")
    assert "fr" not in ms.active_handlers

    ms.is_closed = True
    await ms.add_language_stream("en")
    assert "en" not in ms.active_handlers


@pytest.mark.asyncio
async def test_meeting_session_email_attendees_and_close_session(monkeypatch):
    vm = FakeViewerManager()
    summary_calls = []
    email_calls = []
    lease_calls = []

    class FakeLease:
        async def stop(self, release=True):
            lease_calls.append(release)

    class FakeSummary:
        async def generate_summaries_for_attendees(self, session_id, integration):
            summary_calls.append((session_id, integration))

    class FakeEmail:
        async def send_session_transcripts(self, **kwargs):
            email_calls.append(kwargs)

    meeting = SimpleNamespace(
        attendees=["u1"],
        topic="topic",
        platform="standalone",
        started_at="start",
        translation_type="two_way",
    )
    attendee_rows = [{"id": "u1", "email": "a@example.com", "language_code": "en"}]
    db_factory = fake_session_factory(
        [FakeDbResult(), FakeDbResult(scalar=meeting), FakeDbResult(mappings_rows=attendee_rows)]
    )
    monkeypatch.setattr(receiver, "AsyncSessionLocal", db_factory)
    monkeypatch.setattr(receiver, "EmailService", lambda: FakeEmail())
    removed = []
    monkeypatch.setattr(receiver, "remove_session_log_handler", lambda h: removed.append(h))

    class Handler:
        def __init__(self):
            self.closed = False
            self.language_code = "en"

        async def close(self):
            self.closed = True

    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=FakeLease(),
        backfill_service=SimpleNamespace(),
        summary_service=FakeSummary(),
    )
    ms.session_log_handler = "handler"
    ms.active_handlers["en"] = Handler()

    t = asyncio.create_task(asyncio.sleep(10))
    ms.active_backfill_tasks.add(t)
    await ms.close_session()
    await asyncio.sleep(0)

    assert t.cancelled() is True
    assert vm.saved == [("s1", "zoom")]
    assert vm.broadcasts[-1][1]["type"] == "session_end"
    assert vm.deregistered == ["s1"]
    assert lease_calls == [True]
    assert removed == ["handler"]
    assert summary_calls == [("s1", "zoom")]
    assert email_calls and email_calls[0]["session_id"] == "s1"

    # Already closed is a no-op
    await ms.close_session()
    assert len(vm.deregistered) == 1


@pytest.mark.asyncio
async def test_meeting_session_email_attendees_empty_and_exception(monkeypatch):
    vm = FakeViewerManager()
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    db_factory = fake_session_factory([FakeDbResult(scalar=SimpleNamespace(attendees=[]))])
    monkeypatch.setattr(receiver, "AsyncSessionLocal", db_factory)
    await ms._email_attendees()

    class BrokenSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(receiver, "AsyncSessionLocal", lambda: BrokenSession())
    await ms._email_attendees()


@pytest.mark.asyncio
async def test_meeting_session_schedule_and_cancel_cleanup(monkeypatch):
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=SimpleNamespace(),
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    async def fake_close_session():
        ms.is_closed = True

    ms.close_session = fake_close_session

    receiver.ACTIVE_SESSIONS["s1"] = ms

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(receiver.asyncio, "sleep", fast_sleep)

    ms.schedule_cleanup(delay_seconds=0)
    await ms.cleanup_task

    assert "s1" not in receiver.ACTIVE_SESSIONS
    assert ms.is_closed is True

    # cancel path
    ms2 = receiver.MeetingSession(
        session_id="s2",
        integration="zoom",
        viewer_manager=SimpleNamespace(),
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms2.schedule_cleanup(delay_seconds=100)
    ms2.cancel_cleanup()
    assert ms2.cleanup_task is None


@pytest.mark.asyncio
async def test_meeting_session_schedule_cleanup_keepalive_warning(monkeypatch):
    vm = FakeViewerManager()
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    class NoisyHandler:
        language_code = "en"

        async def send_keepalive(self):
            raise RuntimeError("fail")

    ms.active_handlers["en"] = NoisyHandler()
    closed = {"ok": False}

    async def fake_close_session():
        closed["ok"] = True

    ms.close_session = fake_close_session
    receiver.ACTIVE_SESSIONS["s1"] = ms

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(receiver.asyncio, "sleep", fast_sleep)
    ms.schedule_cleanup(delay_seconds=11)
    await ms.cleanup_task
    assert closed["ok"] is True


@pytest.mark.asyncio
async def test_handle_receiver_session_existing_session_lease_lost(monkeypatch):
    vm = FakeViewerManager()
    ws = FakeSocket(messages=[])
    existing = SimpleNamespace(
        lease=SimpleNamespace(acquire=lambda **kwargs: asyncio.sleep(0, result=False)),
        cancel_cleanup=lambda: None,
        schedule_cleanup=lambda **kwargs: None,
        close_session=lambda: asyncio.sleep(0),
    )
    receiver.ACTIVE_SESSIONS["s1"] = existing

    await receiver.handle_receiver_session(
        websocket=ws,
        integration="zoom",
        session_id="s1",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    assert ws.closed and ws.closed[0][0] == 1013


@pytest.mark.asyncio
async def test_handle_receiver_session_new_session_lease_unavailable(monkeypatch):
    vm = FakeViewerManager()
    ws = FakeSocket(messages=[])

    class FakeLease:
        def __init__(self, *args, **kwargs):
            pass

        async def acquire(self, wait_timeout_seconds):
            return False

    monkeypatch.setattr(receiver, "ReceiverLease", FakeLease)
    await receiver.handle_receiver_session(
        websocket=ws,
        integration="zoom",
        session_id="s2",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    assert ws.closed and "another server instance" in ws.closed[0][1]


@pytest.mark.asyncio
async def test_handle_receiver_session_happy_path_and_graceful_end(monkeypatch):
    vm = FakeViewerManager()
    audio_msg = base64.b64encode(b"pcm").decode("utf-8")
    ws = FakeSocket(
        messages=[
            json.dumps({"type": "session_start"}),
            json.dumps({"audio": audio_msg, "userName": "Ann"}),
            json.dumps({"type": "session_end"}),
        ]
    )

    class FakeLease:
        def __init__(self, *args, **kwargs):
            pass

        async def acquire(self, wait_timeout_seconds):
            return True

    created = {}

    class FakeMeetingSession:
        def __init__(self, session_id, integration, viewer_manager, loop, lease, backfill_service, summary_service):
            self.session_id = session_id
            self.integration = integration
            self.db_start_written = False
            self.start_time = receiver.datetime.now()
            self.updated = []
            self.dispatched = []
            self.closed = 0
            self.scheduled = []
            created["obj"] = self

        async def initialize(self):
            return None

        def cancel_cleanup(self):
            return None

        def update_start_time(self, ts):
            self.updated.append(ts)

        async def dispatch_audio(self, speaker, chunk):
            self.dispatched.append((speaker, chunk))

        async def close_session(self):
            self.closed += 1

        def schedule_cleanup(self, delay_seconds):
            self.scheduled.append(delay_seconds)

    db_factory = fake_session_factory([FakeDbResult(), FakeDbResult()])
    monkeypatch.setattr(receiver, "AsyncSessionLocal", db_factory)
    monkeypatch.setattr(receiver, "ReceiverLease", FakeLease)
    monkeypatch.setattr(receiver, "MeetingSession", FakeMeetingSession)

    await receiver.handle_receiver_session(
        websocket=ws,
        integration="zoom",
        session_id="s3",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    ms = created["obj"]
    assert ms.updated
    assert ms.dispatched == [("Ann", b"pcm")]
    assert ms.closed == 1
    assert "s3" not in receiver.ACTIVE_SESSIONS


@pytest.mark.asyncio
async def test_handle_receiver_session_fallback_start_and_disconnect_cleanup(monkeypatch):
    vm = FakeViewerManager()
    audio_msg = base64.b64encode(b"pcm2").decode("utf-8")
    ws = FakeSocket(messages=[json.dumps({"audio": audio_msg})], disconnect=True)

    class FakeLease:
        def __init__(self, *args, **kwargs):
            pass

        async def acquire(self, wait_timeout_seconds):
            return True

    created = {}

    class FakeMeetingSession:
        def __init__(self, session_id, integration, viewer_manager, loop, lease, backfill_service, summary_service):
            self.session_id = session_id
            self.integration = integration
            self.db_start_written = False
            self.start_time = receiver.datetime.now()
            self.dispatched = []
            self.scheduled = []
            created["obj"] = self

        async def initialize(self):
            return None

        def cancel_cleanup(self):
            return None

        def update_start_time(self, _ts):
            return None

        async def dispatch_audio(self, speaker, chunk):
            self.dispatched.append((speaker, chunk))

        async def close_session(self):
            return None

        def schedule_cleanup(self, delay_seconds):
            self.scheduled.append(delay_seconds)

    db_factory = fake_session_factory([FakeDbResult()])
    monkeypatch.setattr(receiver, "AsyncSessionLocal", db_factory)
    monkeypatch.setattr(receiver, "ReceiverLease", FakeLease)
    monkeypatch.setattr(receiver, "MeetingSession", FakeMeetingSession)

    await receiver.handle_receiver_session(
        websocket=ws,
        integration="zoom",
        session_id="s4",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    ms = created["obj"]
    assert ms.dispatched == [("Unknown", b"pcm2")]
    assert ms.scheduled == [45]


@pytest.mark.asyncio
async def test_stream_handler_close_timeout_and_on_service_close(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )
    h.service = SimpleNamespace(
        finalize_stream=lambda: asyncio.sleep(0),
        receive_task=asyncio.create_task(asyncio.sleep(5)),
    )

    async def timeout(*_args, **_kwargs):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(receiver.asyncio, "wait_for", timeout)
    await h.close()
    await h._on_service_close(1000, "done")


@pytest.mark.asyncio
async def test_stream_handler_final_without_message_id_sets_new_utterance(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )
    h.stream_ready.set()
    h.current_message_id = None
    h.is_new_utterance = False
    await h._on_transcription_message(SonioxResult(transcription="", translation="", is_final=True))
    assert h.is_new_utterance is True


@pytest.mark.asyncio
async def test_meeting_session_initialize_db_exception_and_duplicate_language(monkeypatch):
    vm = FakeViewerManager()
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(start_heartbeat=lambda: asyncio.sleep(0)),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    class BrokenSession:
        async def __aenter__(self):
            raise RuntimeError("db fail")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(receiver, "AsyncSessionLocal", lambda: BrokenSession())
    monkeypatch.setattr(receiver, "add_session_log_handler", lambda *_: "h")
    monkeypatch.setattr(ms, "add_language_stream", lambda lang: asyncio.sleep(0))
    await ms.initialize()
    assert vm.registered

    ms.active_handlers["en"] = SimpleNamespace()
    await ms.add_language_stream("en")


@pytest.mark.asyncio
async def test_meeting_session_close_session_postprocess_and_db_error(monkeypatch):
    vm = FakeViewerManager()
    errors = {"post": 0}

    class BrokenSummary:
        async def generate_summaries_for_attendees(self, *_args, **_kwargs):
            raise RuntimeError("summary boom")

    class BrokenCtx:
        async def __aenter__(self):
            raise RuntimeError("db fail")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(stop=lambda release=True: asyncio.sleep(0)),
        backfill_service=SimpleNamespace(),
        summary_service=BrokenSummary(),
    )
    monkeypatch.setattr(receiver, "AsyncSessionLocal", lambda: BrokenCtx())
    monkeypatch.setattr(ms, "_email_attendees", lambda: asyncio.sleep(0))
    await ms.close_session()
    await asyncio.sleep(0)
    assert vm.broadcasts and vm.broadcasts[-1][1]["type"] == "session_end"


@pytest.mark.asyncio
async def test_meeting_session_schedule_cleanup_existing_task_and_cancelled(monkeypatch):
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=SimpleNamespace(),
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms.schedule_cleanup(delay_seconds=100)
    first = ms.cleanup_task
    ms.schedule_cleanup(delay_seconds=100)
    assert ms.cleanup_task is first
    ms.cancel_cleanup()


@pytest.mark.asyncio
async def test_handle_receiver_session_reconnected_no_audio_and_error_paths(monkeypatch):
    vm = FakeViewerManager()

    class FakeLease:
        def __init__(self, *args, **kwargs):
            pass

        async def acquire(self, wait_timeout_seconds):
            return True

    created = {}

    class FakeMeetingSession:
        def __init__(self, *args, **kwargs):
            self.db_start_written = False
            self.start_time = receiver.datetime.now()
            self.dispatched = []
            self.scheduled = []
            self.updated = []
            created["obj"] = self

        async def initialize(self):
            return None

        def cancel_cleanup(self):
            return None

        def update_start_time(self, ts):
            self.updated.append(ts)

        async def dispatch_audio(self, speaker, chunk):
            self.dispatched.append((speaker, chunk))

        async def close_session(self):
            return None

        def schedule_cleanup(self, delay_seconds):
            self.scheduled.append(delay_seconds)

    class BrokenCtx:
        async def __aenter__(self):
            raise RuntimeError("db fail")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(receiver, "ReceiverLease", FakeLease)
    monkeypatch.setattr(receiver, "MeetingSession", FakeMeetingSession)
    monkeypatch.setattr(receiver, "AsyncSessionLocal", lambda: BrokenCtx())

    audio_msg = base64.b64encode(b"pcm3").decode("utf-8")
    ws = FakeSocket(
        messages=[
            json.dumps({"type": "session_start"}),
            json.dumps({"type": "session_reconnected"}),
            json.dumps({"noop": 1}),
            json.dumps({"audio": audio_msg}),
            json.dumps({"type": "session_end"}),
        ]
    )
    await receiver.handle_receiver_session(
        websocket=ws,
        integration="zoom",
        session_id="s5",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms = created["obj"]
    assert ms.dispatched == [("Unknown", b"pcm3")]

    ws_bad = FakeSocket(messages=["not-json"])
    await receiver.handle_receiver_session(
        websocket=ws_bad,
        integration="zoom",
        session_id="s6",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    assert created["obj"].scheduled == [45]


@pytest.mark.asyncio
async def test_receiver_lease_acquire_existing_owner_refreshes_and_contention_sleeps(monkeypatch):
    fake = FakeRedisLease()
    monkeypatch.setattr(receiver, "RECEIVER_REDIS", fake)

    lease = receiver.ReceiverLease("s1", "owner", ttl_seconds=10)
    fake.values[lease.key] = lease.owner_value
    assert await lease.acquire(wait_timeout_seconds=1) is True

    # contention path should invoke sleep when value is owned by someone else
    fake.values[lease.key] = "someone-else"
    slept = {"n": 0}
    original_sleep = receiver.asyncio.sleep

    async def tracking_sleep(t):
        slept["n"] += 1
        await original_sleep(0)

    monkeypatch.setattr(receiver.asyncio, "sleep", tracking_sleep)
    ok = await lease.acquire(wait_timeout_seconds=0.01)
    assert ok is False
    assert slept["n"] >= 1


@pytest.mark.asyncio
async def test_receiver_lease_heartbeat_guard_break_and_stop_cancelled_branch(monkeypatch):
    fake = FakeRedisLease()
    monkeypatch.setattr(receiver, "RECEIVER_REDIS", fake)
    lease = receiver.ReceiverLease("s1", "owner", heartbeat_interval=0)

    async def no_expire():
        return False

    monkeypatch.setattr(lease, "_compare_and_expire", no_expire)
    await lease.start_heartbeat()
    existing = lease._heartbeat_task
    await lease.start_heartbeat()
    assert lease._heartbeat_task is existing
    await asyncio.sleep(0)

    # Explicitly cover CancelledError handling in stop() await block.
    lease._heartbeat_task = asyncio.create_task(asyncio.sleep(5))
    await lease.stop(release=False)


@pytest.mark.asyncio
async def test_stream_handler_reconnect_service_max_retries_logs_error(monkeypatch):
    vm = FakeViewerManager()
    h = receiver.StreamHandler(
        language_code="en",
        session_id="s1",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        session_start_time=receiver.datetime.now(),
    )

    attempts = {"n": 0}

    async def always_fail():
        attempts["n"] += 1
        raise RuntimeError("fail")

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(h, "connect", always_fail)
    monkeypatch.setattr(receiver.asyncio, "sleep", fast_sleep)
    await h.reconnect_service()
    assert attempts["n"] == 5


@pytest.mark.asyncio
async def test_meeting_session_initialize_two_way_waiting_language_a_only(monkeypatch):
    vm = FakeViewerManager()
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="standalone",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(start_heartbeat=lambda: asyncio.sleep(0)),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    meeting = SimpleNamespace(
        id="s1",
        language_hints=["en"],
        translation_type="two_way",
        translation_language_a="en",
        translation_language_b="es",
        readable_id=None,
    )
    monkeypatch.setattr(receiver, "AsyncSessionLocal", fake_session_factory([FakeDbResult(scalar=meeting)]))
    monkeypatch.setattr(receiver, "add_session_log_handler", lambda *_: "handler")
    added = []
    monkeypatch.setattr(ms, "add_language_stream", lambda lang: asyncio.sleep(0, result=added.append(lang)))
    await ms.initialize()
    assert added == ["en"]


@pytest.mark.asyncio
async def test_meeting_session_add_language_stream_duplicate_after_connect_and_idle_branch(monkeypatch):
    vm = FakeViewerManager()

    class RaceHandler:
        def __init__(self, **kwargs):
            self.language_code = kwargs["language_code"]
            self.utterance_count = 0
            self.is_new_utterance = True
            self.await_next_utterance = False
            self.stream_ready = asyncio.Event()
            self.timestamp_service = SimpleNamespace(start_time=kwargs["session_start_time"])
            self.closed = False
            self._session = None

        async def connect(self):
            # Simulate race where another task has already inserted this language.
            if self._session and self.language_code == "fr":
                self._session.active_handlers["fr"] = SimpleNamespace()

        async def close(self):
            self.closed = True

    monkeypatch.setattr(receiver, "StreamHandler", RaceHandler)
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(run_session_backfill=lambda **_: asyncio.sleep(0)),
        summary_service=SimpleNamespace(),
    )

    # Add english first.
    h_en = RaceHandler(language_code="en", session_id="s1", viewer_manager=vm, loop=None, session_start_time=ms.start_time)
    h_en._session = ms
    ms.active_handlers["en"] = h_en
    ms.active_handlers["en"].utterance_count = 2
    ms.active_handlers["en"].is_new_utterance = True

    # Idle branch for start_count/history_cutoff and race duplicate branch.
    async def make_handler(**kwargs):
        h = RaceHandler(**kwargs)
        h._session = ms
        return h

    class Factory:
        def __call__(self, **kwargs):
            h = RaceHandler(**kwargs)
            h._session = ms
            return h

    monkeypatch.setattr(receiver, "StreamHandler", Factory())
    await ms.add_language_stream("fr")


@pytest.mark.asyncio
async def test_meeting_session_add_language_stream_exception_closes_handler(monkeypatch):
    vm = FakeViewerManager()
    flags = {"closed": False}

    class BadHandler:
        def __init__(self, **kwargs):
            pass

        async def connect(self):
            raise RuntimeError("boom")

        async def close(self):
            flags["closed"] = True

    monkeypatch.setattr(receiver, "StreamHandler", BadHandler)
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    await ms.add_language_stream("en")
    assert flags["closed"] is True


@pytest.mark.asyncio
async def test_meeting_session_schedule_cleanup_success_debug_and_cancelled(monkeypatch):
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=SimpleNamespace(),
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    class GoodHandler:
        language_code = "en"

        async def send_keepalive(self):
            return None

    ms.active_handlers["en"] = GoodHandler()
    ms.close_session = lambda: asyncio.sleep(0)
    receiver.ACTIVE_SESSIONS["s1"] = ms

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(receiver.asyncio, "sleep", fast_sleep)
    ms.schedule_cleanup(delay_seconds=11)
    await ms.cleanup_task

    # CancelledError branch in cleanup job.
    ms2 = receiver.MeetingSession(
        session_id="s2",
        integration="zoom",
        viewer_manager=SimpleNamespace(),
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms2.schedule_cleanup(delay_seconds=100)
    await asyncio.sleep(0)
    ms2.cancel_cleanup()


@pytest.mark.asyncio
async def test_handle_receiver_session_existing_session_resume_path(monkeypatch):
    vm = FakeViewerManager()
    ws = FakeSocket(messages=[json.dumps({"type": "session_end"})])

    class Existing:
        def __init__(self):
            self.lease = SimpleNamespace(acquire=lambda **kwargs: asyncio.sleep(0, result=True))
            self.cancelled = 0
            self.closed = 0

        def cancel_cleanup(self):
            self.cancelled += 1

        async def close_session(self):
            self.closed += 1

        def schedule_cleanup(self, delay_seconds):
            return None

    existing = Existing()
    receiver.ACTIVE_SESSIONS["s9"] = existing
    await receiver.handle_receiver_session(
        websocket=ws,
        integration="zoom",
        session_id="s9",
        viewer_manager=vm,
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    assert existing.cancelled == 1
    assert existing.closed == 1


@pytest.mark.asyncio
async def test_meeting_session_add_language_stream_existing_language_returns(monkeypatch):
    vm = FakeViewerManager()
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    ms.active_handlers["en"] = SimpleNamespace()
    await ms.add_language_stream("en")


@pytest.mark.asyncio
async def test_meeting_session_add_language_stream_idle_branch(monkeypatch):
    vm = FakeViewerManager()

    class IdleHandler:
        def __init__(self, **kwargs):
            self.language_code = kwargs["language_code"]
            self.utterance_count = 0
            self.is_new_utterance = True
            self.await_next_utterance = False
            self.stream_ready = asyncio.Event()
            self.timestamp_service = SimpleNamespace(start_time=kwargs["session_start_time"])
            self.closed = False

        async def connect(self):
            return None

        async def close(self):
            self.closed = True

    monkeypatch.setattr(receiver, "StreamHandler", IdleHandler)
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=vm,
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )
    en = IdleHandler(language_code="en", session_id="s1", viewer_manager=vm, loop=None, session_start_time=ms.start_time)
    en.utterance_count = 4
    en.is_new_utterance = True
    ms.active_handlers["en"] = en

    await ms.add_language_stream("fr")
    assert ms.active_handlers["fr"].utterance_count == 4
    assert ms.active_handlers["fr"].await_next_utterance is False


@pytest.mark.asyncio
async def test_meeting_session_schedule_cleanup_cancellederror_branch(monkeypatch):
    ms = receiver.MeetingSession(
        session_id="s1",
        integration="zoom",
        viewer_manager=SimpleNamespace(),
        loop=asyncio.get_running_loop(),
        lease=SimpleNamespace(),
        backfill_service=SimpleNamespace(),
        summary_service=SimpleNamespace(),
    )

    async def cancel_sleep(_):
        raise asyncio.CancelledError()

    monkeypatch.setattr(receiver.asyncio, "sleep", cancel_sleep)
    ms.schedule_cleanup(delay_seconds=10)
    await ms.cleanup_task
