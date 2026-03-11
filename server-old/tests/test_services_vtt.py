from datetime import datetime, timedelta

import pytest

from services import vtt
from tests.helpers import FakeResult, fake_session_local


def test_timestamp_service_formats_and_clamps_negative():
    ts = vtt.TimestampService(start_time=datetime(2026, 1, 1, 0, 0, 0))
    assert ts._format_timedelta(timedelta(seconds=-1)) == "00:00:00.000"
    assert ts._format_timedelta(timedelta(hours=1, minutes=2, seconds=3, milliseconds=456)) == "01:02:03.456"


def test_timestamp_service_marks_and_completes_with_offsets():
    ts = vtt.TimestampService(start_time=datetime(2026, 1, 1, 0, 0, 0))
    ts.mark_utterance_start("1_a", start_ms=1500)
    stamp = ts.complete_utterance("1_a", end_ms=2200)
    assert stamp == "00:00:01.500 --> 00:00:02.200"


def test_timestamp_service_complete_without_start_and_negative_end(monkeypatch):
    class FakeDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 1, 0, 0, 0, 500000)

    monkeypatch.setattr(vtt, "datetime", FakeDateTime)
    ts = vtt.TimestampService(start_time=datetime(2026, 1, 1, 0, 0, 1))
    stamp = ts.complete_utterance("missing", end_ms=None)
    assert "-->" in stamp


def test_timestamp_service_complete_clamps_end_before_start(monkeypatch):
    times = iter(
        [
            datetime(2026, 1, 1, 0, 0, 2),  # mark start
            datetime(2026, 1, 1, 0, 0, 1),  # complete end (earlier)
        ]
    )

    class FakeDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return next(times)

    monkeypatch.setattr(vtt, "datetime", FakeDateTime)
    ts = vtt.TimestampService(start_time=datetime(2026, 1, 1, 0, 0, 0))
    ts.mark_utterance_start("m1")
    stamp = ts.complete_utterance("m1")
    start, end = stamp.split(" --> ")
    assert start == end


def test_parse_timestamp_and_vtt_range():
    assert vtt._parse_timestamp_seconds("01:02:03.5") == 3723.5
    assert vtt._parse_timestamp_seconds(None) == 0.0
    assert vtt._parse_vtt_range("00:00:01.000 --> 00:00:02.500") == (1.0, 2.5)
    assert vtt._parse_vtt_range("bad") == (0.0, 0.0)


def test_align_history_handles_empty_cases():
    assert vtt.align_history([], [{"vtt_timestamp": "00:00:01.000 --> 00:00:02.000", "translation": "x"}]) == []

    master = [{"vtt_timestamp": "00:00:01.000 --> 00:00:02.000", "speaker": "A"}]
    aligned = vtt.align_history(master, [])
    assert aligned[0]["translation"] == ""


def test_align_history_assigns_by_overlap():
    master = [
        {"vtt_timestamp": "00:00:00.000 --> 00:00:02.000", "speaker": "A"},
        {"vtt_timestamp": "00:00:02.000 --> 00:00:04.000", "speaker": "B"},
    ]
    target = [
        {"vtt_timestamp": "00:00:00.500 --> 00:00:01.500", "translation": "hola"},
        {"vtt_timestamp": "00:00:02.200 --> 00:00:03.000", "transcription": "mundo"},
    ]

    aligned = vtt.align_history(master, target)

    assert aligned[0]["translation"] == "hola"
    assert aligned[1]["translation"] == "mundo"


def test_align_history_skips_empty_text_items():
    master = [{"vtt_timestamp": "00:00:00.000 --> 00:00:02.000", "speaker": "A"}]
    target = [{"vtt_timestamp": "00:00:00.500 --> 00:00:01.500", "translation": ""}]
    aligned = vtt.align_history(master, target)
    assert aligned[0]["translation"] == ""


@pytest.mark.asyncio
async def test_create_vtt_file_no_history_returns(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    await vtt.create_vtt_file("s1", "zoom", "en", [])
    assert not (tmp_path / "output").exists()


@pytest.mark.asyncio
async def test_create_vtt_file_writes_file_and_updates_db(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(vtt, "AsyncSessionLocal", fake_session_local(FakeResult()))

    history = [
        {
            "message_id": "2_x",
            "speaker": "B",
            "transcription": "hello",
            "translation": "hola",
            "vtt_timestamp": "00:00:02.000 --> 00:00:03.000",
        },
        {
            "message_id": "1_x",
            "speaker": "A",
            "transcription": "hi",
            "translation": "hi",
            "vtt_timestamp": "00:00:01.000 --> 00:00:02.000",
        },
    ]

    await vtt.create_vtt_file("s1", "zoom", "en", history)

    p = tmp_path / "output" / "zoom" / "s1" / "transcript_en.vtt"
    text = p.read_text(encoding="utf-8")
    assert "WEBVTT" in text
    assert "A: hi" in text
    assert "B: hola" in text
    assert "hello" in text


@pytest.mark.asyncio
async def test_create_vtt_file_sort_and_message_id_fallback(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(vtt, "AsyncSessionLocal", fake_session_local(FakeResult()))

    history = [
        {
            "message_id": "bad",
            "speaker": "A",
            "transcription": "x",
            "translation": "",
            "vtt_timestamp": "00:00:00.000 --> 00:00:01.000",
        },
        {
            "speaker": "B",
            "transcription": "y",
            "translation": "",
            "vtt_timestamp": "00:00:01.000 --> 00:00:02.000",
        },
    ]
    await vtt.create_vtt_file("s1", "zoom", "en", history)
    text = (tmp_path / "output" / "zoom" / "s1" / "transcript_en.vtt").read_text(
        encoding="utf-8"
    )
    assert "A: x" in text
    assert "B: y" in text


@pytest.mark.asyncio
async def test_create_vtt_file_handles_unique_violation(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    class BadSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def execute(self, _stmt):
            raise RuntimeError("unique_violation")

        async def commit(self):
            return None

    monkeypatch.setattr(vtt, "AsyncSessionLocal", lambda: BadSession())

    await vtt.create_vtt_file(
        "s1",
        "zoom",
        "en",
        [{"message_id": "1", "speaker": "A", "transcription": "x", "translation": "x", "vtt_timestamp": "00:00:00.000 --> 00:00:01.000"}],
    )


@pytest.mark.asyncio
async def test_create_vtt_file_handles_generic_error(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    class BadSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def execute(self, _stmt):
            raise RuntimeError("db down")

        async def commit(self):
            return None

    monkeypatch.setattr(vtt, "AsyncSessionLocal", lambda: BadSession())
    await vtt.create_vtt_file(
        "s1",
        "zoom",
        "en",
        [
            {
                "message_id": "1",
                "speaker": "A",
                "transcription": "x",
                "translation": "x",
                "vtt_timestamp": "00:00:00.000 --> 00:00:01.000",
            }
        ],
    )
