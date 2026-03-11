import asyncio
import base64
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
from types import SimpleNamespace

import pytest
import uvicorn
import websockets
from fastapi import FastAPI
from fastapi import HTTPException

from api import transcribe
from services import receiver


class FakeWebSocket:
    def __init__(self, app=None, headers=None, cookies=None):
        self.app = app or SimpleNamespace(state=SimpleNamespace())
        self.headers = headers or {}
        self.cookies = cookies or {}
        self.accepted = False
        self.closed_code = None
        self.closed_reason = None

    async def accept(self):
        self.accepted = True

    async def close(self, code, reason=None):
        self.closed_code = code
        self.closed_reason = reason


@pytest.mark.asyncio
async def test_transcribe_ws_rejects_unknown_integration():
    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app)
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="unknown", session_id="session-1")

    assert ws.accepted is True
    assert ws.closed_code == 1003


@pytest.mark.asyncio
async def test_transcribe_zoom_rejects_missing_auth_header():
    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app)
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1008
    assert ws.closed_reason == "Missing Authorization header"


@pytest.mark.asyncio
async def test_transcribe_zoom_rejects_invalid_token(monkeypatch):
    def _raise(_token):
        raise RuntimeError("bad token")

    monkeypatch.setattr(transcribe, "validate_server_token", _raise)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1008
    assert ws.closed_reason == "Authentication failed"


@pytest.mark.asyncio
async def test_transcribe_zoom_requires_identifier_in_token(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {})

    app = SimpleNamespace(state=SimpleNamespace(backfill_service=object(), summary_service=object()))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_ws_rejects_when_services_uninitialized(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)

    app = SimpleNamespace(state=SimpleNamespace())
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1011


@pytest.mark.asyncio
async def test_transcribe_ws_hands_off_to_receiver(monkeypatch):
    calls = {}

    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    async def fake_handle_receiver_session(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(transcribe, "handle_receiver_session", fake_handle_receiver_session)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    router = transcribe.create_transcribe_router(viewer_manager="manager")
    endpoint = router.routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert calls["integration"] == "zoom"
    assert calls["session_id"] == "session-1"
    assert calls["viewer_manager"] == "manager"
    assert calls["backfill_service"] == "backfill"
    assert calls["summary_service"] == "summary"


@pytest.mark.asyncio
async def test_transcribe_zoom_uses_zoom_host_id(monkeypatch):
    called = {}

    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"zoom_host_id": "zh-1"})

    async def fake_get_meeting_data(**kwargs):
        called.update(kwargs)

    async def fake_handle_receiver_session(**_kwargs):
        return None

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(transcribe, "handle_receiver_session", fake_handle_receiver_session)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert called["meeting_uuid"] == "session-1"
    assert called["zoom_host_id"] == "zh-1"


@pytest.mark.asyncio
async def test_transcribe_standalone_missing_cookie(monkeypatch):
    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="standalone", session_id="session-1")

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_standalone_invalid_cookie(monkeypatch):
    def bad_payload(token):
        raise RuntimeError("bad")

    monkeypatch.setattr(transcribe, "get_current_user_payload", bad_payload)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={"app_auth_token": "x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="standalone", session_id="session-1")

    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_standalone_payload_missing_sub(monkeypatch):
    monkeypatch.setattr(transcribe, "get_current_user_payload", lambda token: {})
    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={"app_auth_token": "x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint
    await endpoint(ws, integration="standalone", session_id="session-1")
    assert ws.closed_code == 1008


@pytest.mark.asyncio
async def test_transcribe_zoom_http_exception_closes_with_zoom_error(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def raise_http_exc(**_kwargs):
        raise HTTPException(status_code=404, detail="meeting missing")

    monkeypatch.setattr(transcribe, "get_meeting_data", raise_http_exc)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint

    await endpoint(ws, integration="zoom", session_id="session-1")

    assert ws.closed_code == 1011
    assert ws.closed_reason == "Zoom Error: meeting missing"


@pytest.mark.asyncio
async def test_transcribe_unexpected_exception_during_setup(monkeypatch):
    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    async def broken_receiver(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(transcribe, "handle_receiver_session", broken_receiver)

    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, headers={"authorization": "Bearer x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint
    await endpoint(ws, integration="zoom", session_id="session-1")
    assert ws.closed_code == 1011


@pytest.mark.asyncio
async def test_transcribe_standalone_success(monkeypatch):
    monkeypatch.setattr(transcribe, "get_current_user_payload", lambda token: {"sub": "u1"})
    calls = {}

    async def fake_handle_receiver_session(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(transcribe, "handle_receiver_session", fake_handle_receiver_session)
    app = SimpleNamespace(state=SimpleNamespace(backfill_service="backfill", summary_service="summary"))
    ws = FakeWebSocket(app=app, cookies={"app_auth_token": "x"})
    endpoint = transcribe.create_transcribe_router(viewer_manager="manager").routes[0].endpoint
    await endpoint(ws, integration="standalone", session_id="session-1")
    assert calls["integration"] == "standalone"


@pytest.mark.asyncio
async def test_transcribe_ttft_from_audio_to_first_soniox_token(monkeypatch):
    class FakeDbResult:
        def scalar_one_or_none(self):
            return None

        def all(self):
            return []

    class FakeDbSession:
        async def execute(self, _stmt):
            return FakeDbResult()

        async def commit(self):
            return None

    class FakeDbContext:
        async def __aenter__(self):
            return FakeDbSession()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeLease:
        def __init__(self, *args, **kwargs):
            pass

        async def acquire(self, wait_timeout_seconds):
            return True

        async def start_heartbeat(self):
            return None

        async def stop(self, release=True):
            return None

    class FakeViewerManager:
        def __init__(self):
            self._instance_id = "ttft-instance"
            self.language_callbacks = {}
            self.language_remove_callbacks = {}
            self.cache = SimpleNamespace(
                clear_language_cache=self._clear_language_cache,
                save_history_and_clear=self._save_history_and_clear,
            )
            self.first_token_event = asyncio.Event()
            self.first_token_at = None
            self.first_token_text = None
            self.first_word_token = None
            self.first_token_text = None
            self.first_word_token = None

        async def _clear_language_cache(self, session_id, language_code):
            return None

        async def _save_history_and_clear(self, session_id, integration):
            return None

        async def migrate_session(self, old_session_id, new_session_id):
            return None

        async def register_transcription_session(
            self, session_id, integration, shared_two_way_mode=False
        ):
            return True

        async def deregister_transcription_session(self, session_id):
            return None

        def register_language_callback(self, session_id, cb):
            self.language_callbacks[session_id] = cb

        def register_language_removal_callback(self, session_id, cb):
            self.language_remove_callbacks[session_id] = cb

        def get_waiting_languages(self, session_id):
            return set()

        async def broadcast_to_session(self, session_id, payload):
            if (
                self.first_token_at is None
                and payload.get("type") in {"partial", "final"}
                and payload.get("transcription")
            ):
                self.first_token_at = time.monotonic()
                text = str(payload.get("transcription", "")).strip()
                self.first_token_text = text
                self.first_word_token = text.split()[0] if text else ""
                self.first_token_event.set()

    class FakeSonioxService:
        def __init__(self, **kwargs):
            self.on_message_callback = kwargs["on_message_callback"]
            self.target_language = kwargs.get("target_language", "en")
            self.current_speaker = "Unknown"
            self.receive_task = None

        async def connect(self):
            return None

        async def send_chunk(self, _chunk):
            await asyncio.sleep(0.02)
            await self.on_message_callback(
                receiver.SonioxResult(
                    transcription="hello",
                    translation="hola",
                    is_final=False,
                    source_language="en",
                    target_language=self.target_language,
                    speaker=self.current_speaker,
                    start_ms=0,
                    end_ms=50,
                )
            )

        async def send_json(self, payload):
            return None

        async def finalize_stream(self):
            return None

    monkeypatch.setattr(transcribe, "validate_server_token", lambda _token: {"sub": "u1"})

    async def fake_get_meeting_data(**_kwargs):
        return None

    monkeypatch.setattr(transcribe, "get_meeting_data", fake_get_meeting_data)
    monkeypatch.setattr(receiver, "AsyncSessionLocal", lambda: FakeDbContext())
    monkeypatch.setattr(receiver, "ReceiverLease", FakeLease)
    monkeypatch.setattr(receiver, "SonioxService", FakeSonioxService)
    monkeypatch.setattr(receiver.MeetingSession, "schedule_cleanup", lambda self, delay_seconds=45: None)
    monkeypatch.setattr(receiver, "add_session_log_handler", lambda *_args, **_kwargs: None)

    receiver.ACTIVE_SESSIONS.clear()
    vm = FakeViewerManager()
    app = FastAPI()
    app.state.backfill_service = object()
    app.state.summary_service = object()
    app.include_router(transcribe.create_transcribe_router(viewer_manager=vm))

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    host, port = sock.getsockname()
    sock.close()

    config = uvicorn.Config(app=app, host=host, port=port, log_level="error", lifespan="off")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    deadline = time.time() + 5
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                break
        except OSError:
            await asyncio.sleep(0.05)
    else:
        raise AssertionError("Live test server did not start in time")

    audio_sent_at = None
    uri = f"ws://{host}:{port}/ws/transcribe/zoom/session-ttft"
    try:
        async with websockets.connect(
            uri, additional_headers={"Authorization": "Bearer x"}
        ) as ws:
            await ws.send(json.dumps({"type": "session_start"}))
            audio_msg = base64.b64encode(b"pcm-data").decode("utf-8")
            audio_sent_at = time.monotonic()
            await ws.send(json.dumps({"audio": audio_msg, "userName": "TTFT Tester"}))
            assert await asyncio.wait_for(vm.first_token_event.wait(), timeout=1.0) is True
            await ws.send(json.dumps({"type": "session_end"}))
    finally:
        server.should_exit = True
        server_thread.join(timeout=5)
        receiver.ACTIVE_SESSIONS.clear()

    assert audio_sent_at is not None
    assert vm.first_token_at is not None
    ttft_ms = (vm.first_token_at - audio_sent_at) * 1000
    print(
        f"TTFT(ms): {ttft_ms:.2f} | first_token: {vm.first_word_token!r} | first_text: {vm.first_token_text!r}"
    )
    assert 0 < ttft_ms < 500


@pytest.mark.asyncio
async def test_transcribe_ttft_live_soniox(monkeypatch):
    if os.getenv("RUN_LIVE_SONIOX_TTFT") != "1":
        pytest.skip("Set RUN_LIVE_SONIOX_TTFT=1 to run live Soniox TTFT test.")

    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is required for live Soniox TTFT test.")

    temp_dir = tempfile.mkdtemp(prefix="ttft-live-")
    download_path = os.path.join(temp_dir, "whisper_jfk.flac")
    pcm_path = os.path.join(temp_dir, "whisper_jfk_16k_mono_s16le.pcm")
    pcm_bytes = b""

    try:
        urllib.request.urlretrieve(
            "https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac",
            download_path,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                download_path,
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "s16le",
                pcm_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with open(pcm_path, "rb") as f:
            pcm_bytes = f.read()
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    if not pcm_bytes:
        shutil.rmtree(temp_dir, ignore_errors=True)
        pytest.skip("Generated PCM test input was empty.")

    class FakeDbResult:
        def scalar_one_or_none(self):
            return None

        def all(self):
            return []

    class FakeDbSession:
        async def execute(self, _stmt):
            return FakeDbResult()

        async def commit(self):
            return None

    class FakeDbContext:
        async def __aenter__(self):
            return FakeDbSession()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeLease:
        def __init__(self, *args, **kwargs):
            pass

        async def acquire(self, wait_timeout_seconds):
            return True

        async def start_heartbeat(self):
            return None

        async def stop(self, release=True):
            return None

    class FakeViewerManager:
        def __init__(self):
            self._instance_id = "ttft-live-instance"
            self.language_callbacks = {}
            self.language_remove_callbacks = {}
            self.cache = SimpleNamespace(
                clear_language_cache=self._clear_language_cache,
                save_history_and_clear=self._save_history_and_clear,
            )
            self.first_token_event = asyncio.Event()
            self.first_token_at = None

        async def _clear_language_cache(self, session_id, language_code):
            return None

        async def _save_history_and_clear(self, session_id, integration):
            return None

        async def migrate_session(self, old_session_id, new_session_id):
            return None

        async def register_transcription_session(
            self, session_id, integration, shared_two_way_mode=False
        ):
            return True

        async def deregister_transcription_session(self, session_id):
            return None

        def register_language_callback(self, session_id, cb):
            self.language_callbacks[session_id] = cb

        def register_language_removal_callback(self, session_id, cb):
            self.language_remove_callbacks[session_id] = cb

        def get_waiting_languages(self, session_id):
            return set()

        async def broadcast_to_session(self, session_id, payload):
            if (
                self.first_token_at is None
                and payload.get("type") in {"partial", "final"}
                and payload.get("transcription")
            ):
                self.first_token_at = time.monotonic()
                text = str(payload.get("transcription", "")).strip()
                self.first_token_text = text
                self.first_word_token = text.split()[0] if text else ""
                self.first_token_event.set()

    monkeypatch.setattr(
        transcribe, "get_current_user_payload", lambda token: {"sub": "ttft-user-1"}
    )
    monkeypatch.setattr(receiver, "AsyncSessionLocal", lambda: FakeDbContext())
    monkeypatch.setattr(receiver, "ReceiverLease", FakeLease)
    monkeypatch.setattr(
        receiver.MeetingSession,
        "schedule_cleanup",
        lambda self, delay_seconds=45: None,
    )
    monkeypatch.setattr(
        receiver, "add_session_log_handler", lambda *_args, **_kwargs: None
    )

    try:
        receiver.ACTIVE_SESSIONS.clear()
        vm = FakeViewerManager()
        app = FastAPI()
        app.state.backfill_service = object()

        class FakeSummaryService:
            async def generate_summaries_for_attendees(self, session_id, integration):
                return None

        app.state.summary_service = FakeSummaryService()
        app.include_router(transcribe.create_transcribe_router(viewer_manager=vm))

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        host, port = sock.getsockname()
        sock.close()

        config = uvicorn.Config(
            app=app, host=host, port=port, log_level="error", lifespan="off"
        )
        server = uvicorn.Server(config)
        server_thread = threading.Thread(target=server.run, daemon=True)
        server_thread.start()

        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                with socket.create_connection((host, port), timeout=0.2):
                    break
            except OSError:
                await asyncio.sleep(0.05)
        else:
            raise AssertionError("Live test server did not start in time")

        audio_sent_at = None
        uri = f"ws://{host}:{port}/ws/transcribe/standalone/session-ttft-live"
        try:
            async with websockets.connect(
                uri, additional_headers={"Cookie": "app_auth_token=live-ttft-token"}
            ) as ws:
                await ws.send(json.dumps({"type": "session_start"}))

                chunk_size = 3200  # 100ms @ 16kHz s16le mono
                for idx in range(0, len(pcm_bytes), chunk_size):
                    chunk = pcm_bytes[idx : idx + chunk_size]
                    if not chunk:
                        break
                    if audio_sent_at is None:
                        audio_sent_at = time.monotonic()
                    await ws.send(
                        json.dumps(
                            {
                                "audio": base64.b64encode(chunk).decode("utf-8"),
                                "userName": "TTFT Live Tester",
                            }
                        )
                    )
                    if vm.first_token_event.is_set():
                        break
                    await asyncio.sleep(0.1)

                assert await asyncio.wait_for(vm.first_token_event.wait(), timeout=20.0)
                await ws.send(json.dumps({"type": "session_end"}))
        finally:
            server.should_exit = True
            server_thread.join(timeout=5)
            receiver.ACTIVE_SESSIONS.clear()

        assert audio_sent_at is not None
        assert vm.first_token_at is not None
        ttft_ms = (vm.first_token_at - audio_sent_at) * 1000
        print(
            f"TTFT(ms): {ttft_ms:.2f} | first_token: {vm.first_word_token!r} | first_text: {vm.first_token_text!r}"
        )
        assert ttft_ms < 1300, f"TTFT too high: {ttft_ms:.2f}ms (required < 1300ms)"
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
