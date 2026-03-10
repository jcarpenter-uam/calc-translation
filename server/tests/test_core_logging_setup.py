import logging
from pathlib import Path

from core import logging_setup


def test_redact_url():
    msg = "Visit https://example.com/a/b?x=1 and http://foo.bar"
    out = logging_setup.redact_url(msg)
    assert "/a/b?x=1" in out
    assert "/" in out
    assert "example.com" not in out


def test_plain_and_custom_formatter_include_context_and_redact():
    logging_setup.session_id_var.set("s1")
    logging_setup.speaker_var.set("sp")
    logging_setup.message_id_var.set("m1")
    logging_setup.step_var.set("STEP")

    record = logging.LogRecord(
        name="t",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="url=https://example.com/x",
        args=(),
        exc_info=None,
    )
    plain = logging_setup.PlainFormatter().format(record)
    colored = logging_setup.CustomFormatter().format(record)

    assert "[STEP]" in plain
    assert "[session=s1]" in plain
    assert "example.com" not in plain
    assert "/x" in plain
    assert "/x" in colored


def test_log_step_context_manager_restores_step():
    original = logging_setup.step_var.get()
    with logging_setup.log_step("INNER"):
        assert logging_setup.step_var.get() == "INNER"
    assert logging_setup.step_var.get() == original


def test_session_filter_behaviour():
    flt = logging_setup.SessionFilter("s1")
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "m", (), None)

    logging_setup.session_id_var.set(None)
    assert flt.filter(record) is True

    logging_setup.session_id_var.set("s1")
    assert flt.filter(record) is True

    logging_setup.session_id_var.set("s2")
    assert flt.filter(record) is False


def test_add_and_remove_session_log_handler(tmp_path, monkeypatch):
    root = logging.getLogger()
    before = len(root.handlers)

    monkeypatch.chdir(tmp_path)
    handler = logging_setup.add_session_log_handler("s/1", "zoom")
    assert handler is not None
    assert len(root.handlers) == before + 1

    logs_dir = tmp_path / "logs" / "zoom"
    assert logs_dir.exists()
    assert any(Path(h.baseFilename).exists() for h in root.handlers if hasattr(h, "baseFilename"))

    logging_setup.remove_session_log_handler(handler)
    assert len(root.handlers) == before


def test_add_session_log_handler_failure(monkeypatch):
    monkeypatch.setattr(logging_setup.os, "makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError("boom")))
    assert logging_setup.add_session_log_handler("s1", "zoom") is None


def test_remove_session_log_handler_failure_logs_error(monkeypatch):
    class BadHandler:
        def close(self):
            raise OSError("close fail")

    monkeypatch.setattr(logging, "error", lambda *_a, **_k: None)
    logging_setup.remove_session_log_handler(BadHandler())
