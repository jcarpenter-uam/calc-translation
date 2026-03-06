import builtins

import pytest
from fastapi import HTTPException

from api import logs


@pytest.mark.asyncio
async def test_get_logs_file_missing(monkeypatch, tmp_path):
    missing = tmp_path / "missing.log"
    monkeypatch.setattr(logs, "LOG_FILE", str(missing))

    response = await logs.get_server_logs(lines=100)

    assert response == {"logs": ["Log file not found."]}


@pytest.mark.asyncio
async def test_get_logs_returns_last_n_lines(monkeypatch, tmp_path):
    log_file = tmp_path / "server.log"
    log_file.write_text("a\nb\nc\nd\n", encoding="utf-8")
    monkeypatch.setattr(logs, "LOG_FILE", str(log_file))

    response = await logs.get_server_logs(lines=2)

    assert response == {"logs": ["c\n", "d\n"]}


@pytest.mark.asyncio
async def test_get_logs_raises_500_on_read_error(monkeypatch, tmp_path):
    log_file = tmp_path / "server.log"
    log_file.write_text("x\n", encoding="utf-8")
    monkeypatch.setattr(logs, "LOG_FILE", str(log_file))

    real_open = builtins.open

    def bad_open(*args, **kwargs):
        if args and args[0] == str(log_file):
            raise OSError("boom")
        return real_open(*args, **kwargs)

    monkeypatch.setattr(builtins, "open", bad_open)

    with pytest.raises(HTTPException) as exc_info:
        await logs.get_server_logs(lines=10)

    assert exc_info.value.status_code == 500


def test_create_logs_router_returns_router():
    assert logs.create_logs_router() is logs.router
