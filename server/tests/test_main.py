import pytest
from fastapi.responses import FileResponse

import main


@pytest.mark.asyncio
async def test_startup_and_shutdown_events(monkeypatch):
    calls = []

    class FakeBackfill:
        pass

    class FakeSummary:
        pass

    class FakeCache:
        async def ping(self):
            calls.append("cache.ping")

        async def close(self):
            calls.append("cache.close")

    class FakeViewer:
        async def start(self):
            calls.append("viewer.start")

        async def close(self):
            calls.append("viewer.close")

    async def fake_init_http():
        calls.append("http.init")

    async def fake_close_http():
        calls.append("http.close")

    async def fake_init_db():
        calls.append("db.init")

    async def fake_close_receiver():
        calls.append("receiver.close")

    monkeypatch.setattr(main, "BackfillService", FakeBackfill)
    monkeypatch.setattr(main, "SummaryService", FakeSummary)
    monkeypatch.setattr(main, "transcript_cache", FakeCache())
    monkeypatch.setattr(main, "viewer_manager", FakeViewer())
    monkeypatch.setattr(main, "init_http_client", fake_init_http)
    monkeypatch.setattr(main, "close_http_client", fake_close_http)
    monkeypatch.setattr(main.db, "init_db", fake_init_db)
    monkeypatch.setattr(main, "close_receiver_resources", fake_close_receiver)

    await main.startup_event()
    assert isinstance(main.app.state.backfill_service, FakeBackfill)
    assert isinstance(main.app.state.summary_service, FakeSummary)
    assert calls[:4] == ["http.init", "db.init", "cache.ping", "viewer.start"]

    await main.shutdown_event()
    assert calls[-4:] == ["viewer.close", "cache.close", "receiver.close", "http.close"]


@pytest.mark.asyncio
async def test_serve_spa_returns_index_file():
    resp = await main.serve_spa(request=None, full_path="deep/path")
    assert isinstance(resp, FileResponse)
    assert resp.path == "web/dist/index.html"


def test_main_app_routes_include_expected_paths():
    paths = {route.path for route in main.app.routes}
    assert "/api/metrics" in paths
    assert "/{full_path:path}" in paths
