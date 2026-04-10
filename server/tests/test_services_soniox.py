import asyncio
import json
from types import SimpleNamespace

import pytest
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK
from websockets.frames import Close

from services import soniox


class FakeWS:
    def __init__(self, messages=None, raise_exc=None):
        self._messages = list(messages or [])
        self._raise_exc = raise_exc
        self.sent = []
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._messages:
            return self._messages.pop(0)
        if self._raise_exc:
            raise self._raise_exc
        raise StopAsyncIteration

    async def send(self, data):
        self.sent.append(data)

    async def close(self):
        self.closed = True


@pytest.fixture
def callbacks():
    calls = {"messages": [], "errors": [], "closes": []}

    async def on_msg(result):
        calls["messages"].append(result)

    async def on_err(err):
        calls["errors"].append(err)

    async def on_close(code, reason):
        calls["closes"].append((code, reason))

    return calls, on_msg, on_err, on_close


def make_service(callbacks, **kwargs):
    calls, on_msg, on_err, on_close = callbacks
    loop = kwargs.pop("loop", None)
    if loop is None:
        loop = SimpleNamespace(create_task=lambda coro: asyncio.create_task(coro))
    return soniox.SonioxService(
        on_message_callback=on_msg,
        on_error_callback=on_err,
        on_close_callback=on_close,
        loop=loop,
        **kwargs,
    )


def test_get_config_one_way_and_two_way(callbacks):
    s1 = make_service(callbacks, target_language="es", language_hints=["en"]) 
    cfg1 = s1._get_config()
    assert cfg1["translation"]["type"] == "one_way"
    assert cfg1["translation"]["target_language"] == "es"

    s2 = make_service(callbacks, translation_config={"type": "two_way", "language_a": "en", "language_b": "es"})
    cfg2 = s2._get_config()
    assert cfg2["translation"]["type"] == "two_way"


@pytest.mark.asyncio
async def test_receive_loop_partial_and_end_final(callbacks):
    calls, _, _, _ = callbacks
    svc = make_service(callbacks, target_language="es")
    msg = {
        "tokens": [
            {"text": "Hello", "is_final": True, "language": "en", "speaker": 1, "start_ms": 10, "end_ms": 100},
            {"text": "Hola", "is_final": True, "language": "es", "translation_status": "translation"},
            {"text": " world", "is_final": False, "language": "en", "start_ms": 101, "end_ms": 180},
            {"text": " mundo", "is_final": False, "language": "es", "translation_status": "translation"},
            {"text": "<end>", "is_final": True},
        ]
    }
    svc.ws = FakeWS(messages=[json.dumps(msg)])
    svc._is_connected = True

    await svc._receive_loop()

    assert len(calls["messages"]) >= 2
    first = calls["messages"][0]
    assert first.is_final is False
    assert "Hello" in first.transcription
    assert first.target_language == "es"

    last = calls["messages"][-1]
    assert last.is_final is True
    assert last.transcription == "Hello"
    assert last.translation == "Hola"


@pytest.mark.asyncio
async def test_receive_loop_finished_flag_emits_final(callbacks):
    calls, _, _, _ = callbacks
    svc = make_service(callbacks, target_language="fr")
    msg = {
        "tokens": [{"text": "Hi", "is_final": True, "language": "en"}],
        "finished": True,
    }
    svc.ws = FakeWS(messages=[json.dumps(msg)])
    svc._is_connected = True

    await svc._receive_loop()

    assert calls["messages"][-1].is_final is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error_code", "error_message"),
    [
        (503, "Cannot continue request"),
        (401, "bad key"),
        (400, "audio too long"),
    ],
)
async def test_receive_loop_error_code_always_reconnectable(
    callbacks, error_code, error_message
):
    calls, _, _, _ = callbacks

    svc = make_service(callbacks)
    svc.ws = FakeWS(
        messages=[
            json.dumps(
                {"error_code": error_code, "error_message": error_message}
            )
        ]
    )
    svc._is_connected = True
    await svc._receive_loop()
    assert isinstance(calls["errors"][-1], soniox.SonioxConnectionError)


@pytest.mark.asyncio
async def test_receive_loop_classifies_connection_reset(callbacks):
    calls, _, _, _ = callbacks
    svc = make_service(callbacks)
    svc.ws = FakeWS(messages=["not-json"])
    svc._is_connected = True

    await svc._receive_loop()

    # JSON parse error -> fatal path
    assert isinstance(calls["errors"][-1], soniox.SonioxFatalError)


@pytest.mark.asyncio
async def test_receive_loop_connection_reset_maps_to_connection_error(callbacks):
    calls, _, _, _ = callbacks
    svc = make_service(callbacks)
    svc.ws = FakeWS(raise_exc=RuntimeError("Connection reset by peer"))
    svc._is_connected = True

    await svc._receive_loop()
    assert isinstance(calls["errors"][-1], soniox.SonioxConnectionError)


@pytest.mark.asyncio
async def test_receive_loop_connection_closed_paths(callbacks):
    calls, _, _, _ = callbacks

    ok_exc = ConnectionClosedOK(
        Close(1000, "done"), Close(1000, "done"), rcvd_then_sent=True
    )
    svc_ok = make_service(callbacks)
    svc_ok.final_transcription_tokens = ["bye"]
    svc_ok.ws = FakeWS(raise_exc=ok_exc)
    svc_ok._is_connected = True
    await svc_ok._receive_loop()
    assert calls["closes"][-1][0] == 1000
    assert calls["messages"][-1].is_final is True

    err_exc = ConnectionClosedError(
        Close(1011, "err"), Close(1011, "err"), rcvd_then_sent=True
    )
    svc_err = make_service(callbacks)
    svc_err.ws = FakeWS(raise_exc=err_exc)
    svc_err._is_connected = True
    await svc_err._receive_loop()
    assert isinstance(calls["errors"][-1], soniox.SonioxConnectionError)


@pytest.mark.asyncio
async def test_receive_loop_diarization_and_non_text_tokens(callbacks):
    calls, _, _, _ = callbacks
    svc = make_service(callbacks, target_language="es", enable_speaker_diarization=True)
    msg = {
        "tokens": [
            {"text": "", "is_final": False},  # ignored
            {"text": "hi", "is_final": False, "language": "en", "speaker": 2, "start_ms": -5, "end_ms": 7},
            {"text": " hola", "is_final": False, "translation_status": "translation", "language": "es"},
        ]
    }
    svc.ws = FakeWS(messages=[json.dumps(msg)])
    svc._is_connected = True

    await svc._receive_loop()
    partial = calls["messages"][-1]
    assert partial.speaker == "Speaker 2"
    assert partial.start_ms == 0
    assert partial.end_ms == 7


@pytest.mark.asyncio
async def test_connect_send_chunk_send_json_finalize(monkeypatch, callbacks):
    svc = make_service(callbacks, target_language="es")
    fake_ws = FakeWS()

    async def fake_connect(url, ping_interval=20, ping_timeout=10):
        return fake_ws

    monkeypatch.setattr(soniox.websockets, "connect", fake_connect)

    created = {}

    class FakeLoop:
        def create_task(self, coro):
            task = asyncio.create_task(coro)
            created["task"] = task
            return task

    svc.loop = FakeLoop()

    await svc.connect()
    assert svc._is_connected is True
    assert fake_ws.sent and isinstance(json.loads(fake_ws.sent[0]), dict)

    await svc.send_chunk(b"abc")
    await svc.send_json({"type": "keepalive"})
    await svc.finalize_stream()

    assert b"abc" in fake_ws.sent
    assert json.dumps({"type": "keepalive"}) in fake_ws.sent
    assert "" in fake_ws.sent
    assert svc._is_connected is False

    created["task"].cancel()
    with pytest.raises(asyncio.CancelledError):
        await created["task"]


@pytest.mark.asyncio
async def test_connect_failure_resets_state(monkeypatch, callbacks):
    svc = make_service(callbacks, session_id="sess-1")

    async def boom(*args, **kwargs):
        raise RuntimeError("cannot connect")

    monkeypatch.setattr(soniox.websockets, "connect", boom)
    with pytest.raises(RuntimeError):
        await svc.connect()
    assert svc._is_connected is False


@pytest.mark.asyncio
async def test_send_chunk_error_marks_disconnected(callbacks):
    svc = make_service(callbacks)

    class BadWS(FakeWS):
        async def send(self, data):
            raise RuntimeError("send failed")

    svc.ws = BadWS()
    svc._is_connected = True

    await svc.send_chunk(b"x")
    assert svc._is_connected is False


@pytest.mark.asyncio
async def test_finalize_stream_warn_path_and_skip_path(callbacks):
    svc = make_service(callbacks)

    class BadWS(FakeWS):
        async def send(self, data):
            raise RuntimeError("closed")

    svc.ws = BadWS()
    svc._is_connected = True
    await svc.finalize_stream()
    assert svc._is_connected is False

    # already disconnected branch
    svc2 = make_service(callbacks)
    await svc2.finalize_stream()


@pytest.mark.asyncio
async def test_send_json_closed_connection_is_ignored(callbacks):
    svc = make_service(callbacks)

    ok_exc = ConnectionClosedOK(
        Close(1000, "done"), Close(1000, "done"), rcvd_then_sent=True
    )

    class ClosedWS(FakeWS):
        async def send(self, data):
            raise ok_exc

    svc.ws = ClosedWS()
    svc._is_connected = True

    await svc.send_json({"type": "keepalive"})
    assert svc._is_connected is False


@pytest.mark.asyncio
async def test_send_json_connection_closed_error_marks_disconnected(callbacks):
    svc = make_service(callbacks)

    err_exc = ConnectionClosedError(
        Close(1011, "err"), Close(1011, "err"), rcvd_then_sent=True
    )

    class ClosedWS(FakeWS):
        async def send(self, data):
            raise err_exc

    svc.ws = ClosedWS()
    svc._is_connected = True

    await svc.send_json({"type": "keepalive"})
    assert svc._is_connected is False


@pytest.mark.asyncio
async def test_send_json_skip_when_already_disconnected(callbacks):
    svc = make_service(callbacks)
    fake_ws = FakeWS()
    svc.ws = fake_ws
    svc._is_connected = False

    await svc.send_json({"type": "keepalive"})
    assert fake_ws.sent == []
