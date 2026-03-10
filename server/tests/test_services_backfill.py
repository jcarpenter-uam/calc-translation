import asyncio
from types import SimpleNamespace

import pytest

from services import backfill


class FakeCompletions:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)

    async def create(self, **kwargs):
        if not self.outcomes:
            raise RuntimeError("no outcome")
        nxt = self.outcomes.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=nxt))])


class FakeClient:
    def __init__(self, outcomes):
        self.chat = SimpleNamespace(completions=FakeCompletions(outcomes))


class FakeCache:
    def __init__(self):
        self.messages = {}

    async def get_message(self, session_id, lang, message_id):
        return self.messages.get((session_id, lang, message_id))


class FakeViewerManager:
    def __init__(self):
        self.cache = FakeCache()
        self.broadcasts = []

    async def broadcast_to_session(self, session_id, payload):
        self.broadcasts.append((session_id, payload))


@pytest.fixture
def svc(monkeypatch):
    monkeypatch.setattr(backfill, "AsyncOpenAI", lambda **kwargs: FakeClient(["ok"]))
    return backfill.BackfillService()


@pytest.mark.asyncio
async def test_translate_text_success(svc):
    svc.client = FakeClient([" translated "])
    out = await svc._translate_text("hello", "en", "es")
    assert out == "translated"


@pytest.mark.asyncio
async def test_translate_text_unexpected_error_returns_empty(svc):
    svc.client = FakeClient([RuntimeError("boom")])
    out = await svc._translate_text("hello", "en", "es")
    assert out == ""


@pytest.mark.asyncio
async def test_translate_text_retries_status_error_then_succeeds(monkeypatch, svc):
    class FakeStatusError(Exception):
        def __init__(self, status_code):
            self.status_code = status_code
            super().__init__(f"status={status_code}")

    FakeTimeout = type("FakeTimeout", (Exception,), {})
    sleeps = []

    async def fake_sleep(t):
        sleeps.append(t)

    monkeypatch.setattr(backfill, "APIStatusError", FakeStatusError)
    monkeypatch.setattr(backfill, "APITimeoutError", FakeTimeout)
    monkeypatch.setattr(backfill.random, "uniform", lambda _a, _b: 0.0)
    monkeypatch.setattr(backfill.asyncio, "sleep", fake_sleep)

    svc.client = FakeClient([FakeStatusError(429), "done"])
    out = await svc._translate_text("hello", "en", "es")
    assert out == "done"
    assert sleeps and sleeps[0] == 2.0


@pytest.mark.asyncio
async def test_translate_text_timeout_then_permanent_failure(monkeypatch, svc):
    class FakeStatusError(Exception):
        def __init__(self, status_code):
            self.status_code = status_code
            super().__init__(f"status={status_code}")

    FakeTimeout = type("FakeTimeout", (Exception,), {})

    monkeypatch.setattr(backfill, "APIStatusError", FakeStatusError)
    monkeypatch.setattr(backfill, "APITimeoutError", FakeTimeout)
    monkeypatch.setattr(backfill.random, "uniform", lambda _a, _b: 0.0)

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(backfill.asyncio, "sleep", fast_sleep)
    svc.client = FakeClient([FakeTimeout("timeout"), FakeStatusError(400)])
    out = await svc._translate_text("hello", "en", "es")
    assert out == ""


@pytest.mark.asyncio
async def test_fetch_or_wait_for_item_immediate(svc):
    vm = FakeViewerManager()
    vm.cache.messages[("s1", "en", "1_en")] = {"message_id": "1_en"}
    out = await svc._fetch_or_wait_for_item("s1", "1_en", vm)
    assert out["message_id"] == "1_en"


@pytest.mark.asyncio
async def test_fetch_or_wait_for_item_eventual(monkeypatch, svc):
    vm = FakeViewerManager()
    calls = {"n": 0}

    async def fake_sleep(_):
        calls["n"] += 1
        if calls["n"] == 2:
            vm.cache.messages[("s1", "en", "1_en")] = {"message_id": "1_en"}

    monkeypatch.setattr(backfill.asyncio, "sleep", fake_sleep)

    out = await svc._fetch_or_wait_for_item("s1", "1_en", vm)
    assert out["message_id"] == "1_en"


@pytest.mark.asyncio
async def test_fetch_or_wait_for_item_timeout_returns_none(monkeypatch, svc):
    vm = FakeViewerManager()

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(backfill.asyncio, "sleep", fast_sleep)
    out = await svc._fetch_or_wait_for_item("s1", "9_en", vm)
    assert out is None


@pytest.mark.asyncio
async def test_process_backfill_item_ignores_invalid_items(monkeypatch, svc):
    vm = FakeViewerManager()
    async def no_translation(*args, **kwargs):
        return ""

    monkeypatch.setattr(svc, "_translate_text", no_translation)

    await svc._process_backfill_item({"message_id": "1_en", "type": "status_update", "isfinalize": True}, "s1", "es", vm)
    await svc._process_backfill_item({"message_id": "1_en", "type": "final", "isfinalize": True}, "s1", "es", vm)
    await svc._process_backfill_item({"message_id": "bad", "type": "final", "isfinalize": True, "transcription": "x"}, "s1", "es", vm)

    assert vm.broadcasts == []


@pytest.mark.asyncio
async def test_process_backfill_item_success(monkeypatch, svc):
    vm = FakeViewerManager()

    async def fake_translate(text, source_lang, target_lang):
        return "hola"

    monkeypatch.setattr(svc, "_translate_text", fake_translate)

    await svc._process_backfill_item(
        {
            "message_id": "2_en",
            "type": "final",
            "isfinalize": True,
            "transcription": "hello",
            "speaker": "A",
            "vtt_timestamp": "00:00:01.000 --> 00:00:02.000",
        },
        "s1",
        "es",
        vm,
    )

    assert vm.broadcasts
    payload = vm.broadcasts[0][1]
    assert payload["message_id"] == "2_es"
    assert payload["translation"] == "hola"
    assert payload["is_backfill"] is True


@pytest.mark.asyncio
async def test_run_session_backfill_start_end_and_processing(monkeypatch, svc):
    vm = FakeViewerManager()

    async def fake_fetch(session_id, message_id, viewer_manager):
        if message_id == "1_en":
            return {"message_id": "1_en", "type": "final", "isfinalize": True, "transcription": "a"}
        return None

    calls = []

    async def fake_process(item, session_id, target_lang, viewer_manager):
        calls.append(item["message_id"])

    monkeypatch.setattr(svc, "_fetch_or_wait_for_item", fake_fetch)
    monkeypatch.setattr(svc, "_process_backfill_item", fake_process)

    await svc.run_session_backfill("s1", "es", vm, upto_count=2)

    assert vm.broadcasts[0][1]["type"] == "backfill_start"
    assert vm.broadcasts[-1][1]["type"] == "backfill_end"
    assert calls == ["1_en"]


@pytest.mark.asyncio
async def test_run_session_backfill_handles_exception(monkeypatch, svc):
    vm = FakeViewerManager()

    async def boom(*args, **kwargs):
        raise RuntimeError("explode")

    monkeypatch.setattr(svc, "_fetch_or_wait_for_item", boom)
    await svc.run_session_backfill("s1", "es", vm, upto_count=1)

    assert vm.broadcasts and vm.broadcasts[0][1]["type"] == "backfill_start"
    assert all(item[1]["type"] != "backfill_end" for item in vm.broadcasts)


@pytest.mark.asyncio
async def test_backfill_gap_found_and_missing(monkeypatch, svc):
    vm = FakeViewerManager()
    processed = []

    async def fake_process(item, session_id, target_lang, viewer_manager):
        processed.append(item["message_id"])

    monkeypatch.setattr(svc, "_process_backfill_item", fake_process)

    # Found path
    vm.cache.messages[("s1", "en", "3_en")] = {"message_id": "3_en", "type": "final", "isfinalize": True, "transcription": "x"}
    await svc.backfill_gap("s1", "es", 3, vm)
    assert "3_en" in processed

    # Missing path (fast sleep)
    processed.clear()

    async def fast_sleep(_):
        return None

    monkeypatch.setattr(backfill.asyncio, "sleep", fast_sleep)
    await svc.backfill_gap("s1", "es", 9, vm)
    assert processed == []


@pytest.mark.asyncio
async def test_backfill_gap_handles_exception(monkeypatch, svc):
    vm = FakeViewerManager()

    async def bad_get(*args, **kwargs):
        raise RuntimeError("cache down")

    monkeypatch.setattr(vm.cache, "get_message", bad_get)
    await svc.backfill_gap("s1", "es", 4, vm)


@pytest.mark.asyncio
async def test_process_backfill_item_handles_indexerror_from_message_id(monkeypatch, svc):
    vm = FakeViewerManager()

    class WeirdId:
        def split(self, *_args, **_kwargs):
            raise IndexError("bad split")

    await svc._process_backfill_item(
        {
            "message_id": WeirdId(),
            "type": "final",
            "isfinalize": True,
            "transcription": "hello",
        },
        "s1",
        "es",
        vm,
    )
    assert vm.broadcasts == []
