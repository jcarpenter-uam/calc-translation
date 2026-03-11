from types import SimpleNamespace

import pytest
import asyncio

from api import metrics


def test_escape_label_value_escapes_special_chars():
    raw = 'a\\b\n"c"'
    escaped = metrics._escape_label_value(raw)
    assert escaped == 'a\\\\b\\n\\"c\\"'


def test_read_int_file_handles_values(tmp_path):
    f = tmp_path / "x"
    f.write_text("42", encoding="utf-8")
    assert metrics._read_int_file(str(f)) == 42

    f.write_text("max", encoding="utf-8")
    assert metrics._read_int_file(str(f)) is None


def test_read_int_file_missing_returns_none():
    assert metrics._read_int_file("/path/that/does/not/exist") is None


def test_format_metric_skips_none():
    lines = []
    metrics._format_metric(lines, "m", None, "h")
    assert lines == []


def test_collect_process_metrics_handles_optional_failures(monkeypatch):
    class FakeProcess:
        def cpu_percent(self, interval=None):
            return 12.34

        def cpu_times(self):
            return SimpleNamespace(user=1.2, system=2.3)

        def memory_info(self):
            return SimpleNamespace(rss=100, vms=200, shared=50)

        def memory_full_info(self):
            raise RuntimeError("no full info")

        def memory_percent(self):
            return 9.8765

        def num_threads(self):
            return 7

        def num_fds(self):
            raise RuntimeError("no fds")

        def open_files(self):
            raise RuntimeError("no open files")

        def net_connections(self, kind="inet"):
            raise RuntimeError("no net")

    monkeypatch.setattr(metrics.psutil, "Process", lambda: FakeProcess())
    monkeypatch.setattr(metrics.psutil, "cpu_percent", lambda interval=None, percpu=True: [10.0, 20.0])
    monkeypatch.setattr(metrics.os, "getloadavg", lambda: (_ for _ in ()).throw(OSError("unsupported")))

    out = metrics._collect_process_metrics()

    assert out["process_rss_bytes"] == 100
    assert out["process_uss_bytes"] == 0
    assert out["num_fds"] is None
    assert out["open_files_count"] == 0
    assert out["net_connections_count"] == 0
    assert out["load_1"] == 0


@pytest.mark.asyncio
async def test_collect_server_metrics_aggregates(monkeypatch):
    async def fake_to_thread(func, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(metrics.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        metrics,
        "_collect_process_metrics",
        lambda: {
            "uptime_seconds": 1,
            "process_rss_bytes": 2,
            "process_vms_bytes": 3,
            "process_shared_bytes": 4,
            "process_uss_bytes": 5,
            "process_pss_bytes": 6,
            "process_swap_bytes": 7,
            "process_memory_percent": 8,
            "process_cpu_percent": 9,
            "cpu_percent_per_core": [1.0],
            "process_cpu_time_user_seconds": 10,
            "process_cpu_time_system_seconds": 11,
            "load_1": 12,
            "load_5": 13,
            "load_15": 14,
            "threads_count": 15,
            "open_files_count": 16,
            "net_connections_count": 17,
            "num_fds": 18,
        },
    )
    monkeypatch.setattr(metrics, "_read_int_file", lambda _path: 123)
    monkeypatch.setattr(metrics, "ACTIVE_SESSIONS", {"a": SimpleNamespace(active_handlers=[1], active_backfill_tasks=[1, 2])})

    class FakeManager:
        async def get_global_active_sessions(self):
            return [
                {"session_id": "s1", "integration": "standalone", "shared_two_way_mode": True, "viewers": 3},
                {"session_id": "s2", "integration": "zoom", "shared_two_way_mode": False, "viewers": 2},
            ]

    out = await metrics._collect_server_metrics(FakeManager())

    assert out["active_sessions_total"] == 2
    assert out["active_participants"] == 4
    assert out["active_host_plus_viewers"] == 5
    assert out["active_sessions_by_integration"]["zoom"] == 1


@pytest.mark.asyncio
async def test_collect_server_metrics_defaults_unknown_integration(monkeypatch):
    async def fake_to_thread(func, *args, **kwargs):
        return {
            "uptime_seconds": 1,
            "process_rss_bytes": 2,
            "process_vms_bytes": 3,
            "process_shared_bytes": 4,
            "process_uss_bytes": 5,
            "process_pss_bytes": 6,
            "process_swap_bytes": 7,
            "process_memory_percent": 8,
            "process_cpu_percent": 9,
            "cpu_percent_per_core": [1.0],
            "process_cpu_time_user_seconds": 10,
            "process_cpu_time_system_seconds": 11,
            "load_1": 12,
            "load_5": 13,
            "load_15": 14,
            "threads_count": 15,
            "open_files_count": 16,
            "net_connections_count": 17,
            "num_fds": 18,
        }

    monkeypatch.setattr(metrics.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(metrics, "_read_int_file", lambda _path: None)
    monkeypatch.setattr(metrics, "ACTIVE_SESSIONS", {})

    class FakeManager:
        async def get_global_active_sessions(self):
            return [{"session_id": "x", "viewers": "2", "shared_two_way_mode": False}]

    out = await metrics._collect_server_metrics(FakeManager())

    assert out["active_sessions_by_integration"]["unknown"] == 1
    assert out["active_sessions_by_mode"]["one_way"] == 1


def test_to_prometheus_text_includes_core_metrics_and_labels():
    payload = {
        "uptime_seconds": 1,
        "process_rss_bytes": 2,
        "process_vms_bytes": 3,
        "process_shared_bytes": 4,
        "process_uss_bytes": 5,
        "process_pss_bytes": 6,
        "process_swap_bytes": 7,
        "process_memory_percent": 8.5,
        "container_memory_current_bytes": 9,
        "container_memory_max_bytes": 10,
        "process_cpu_percent": 11.2,
        "process_cpu_time_user_seconds": 12.3,
        "process_cpu_time_system_seconds": 13.4,
        "load_1": 0.1,
        "load_5": 0.2,
        "load_15": 0.3,
        "threads_count": 14,
        "asyncio_task_count": 15,
        "open_files_count": 16,
        "net_connections_count": 17,
        "num_fds": 18,
        "active_receiver_sessions": 19,
        "active_stream_handlers": 20,
        "active_backfill_tasks": 21,
        "active_viewer_sessions": 22,
        "active_sessions_total": 23,
        "active_viewer_connections": 24,
        "active_participants": 25,
        "active_host_plus_viewers": 26,
        "cpu_percent_per_core": [1.1, 2.2],
        "gc_count_gen0": 27,
        "gc_count_gen1": 28,
        "gc_count_gen2": 29,
        "active_sessions_by_integration": {"zoom": 1},
        "active_sessions_by_mode": {"one_way": 1},
        "active_standalone_by_mode": {"one_way": 1, "two_way": 0},
        "active_sessions": [
            {
                "session_id": 's"1',
                "integration": "zoom",
                "shared_two_way_mode": False,
                "viewers": 3,
                "participants": 3,
                "host_plus_viewers": 3,
            }
        ],
    }

    out = metrics._to_prometheus_text(payload)

    assert "calc_translation_process_uptime_seconds 1" in out
    assert 'calc_translation_process_cpu_core_percent{core="0"} 1.1' in out
    assert 'calc_translation_session_viewers{session_id="s\\"1",integration="zoom",mode="one_way"} 3' in out


@pytest.mark.asyncio
async def test_metrics_router_startup_shutdown_and_endpoint(monkeypatch):
    call_count = {"n": 0}

    async def fake_collect(_manager):
        call_count["n"] += 1
        return {
            "uptime_seconds": 1,
            "process_rss_bytes": 1,
            "process_vms_bytes": 1,
            "process_shared_bytes": 1,
            "process_uss_bytes": 1,
            "process_pss_bytes": 1,
            "process_swap_bytes": 1,
            "process_memory_percent": 1,
            "container_memory_current_bytes": 1,
            "container_memory_max_bytes": 1,
            "process_cpu_percent": 1,
            "process_cpu_time_user_seconds": 1,
            "process_cpu_time_system_seconds": 1,
            "load_1": 1,
            "load_5": 1,
            "load_15": 1,
            "threads_count": 1,
            "asyncio_task_count": 1,
            "open_files_count": 1,
            "net_connections_count": 1,
            "num_fds": 1,
            "active_receiver_sessions": 0,
            "active_stream_handlers": 0,
            "active_backfill_tasks": 0,
            "active_viewer_sessions": 0,
            "active_sessions_total": 0,
            "active_viewer_connections": 0,
            "active_participants": 0,
            "active_host_plus_viewers": 0,
            "cpu_percent_per_core": [0.0],
            "gc_count_gen0": 0,
            "gc_count_gen1": 0,
            "gc_count_gen2": 0,
            "active_sessions_by_integration": {},
            "active_sessions_by_mode": {},
            "active_standalone_by_mode": {"one_way": 0, "two_way": 0},
            "active_sessions": [],
        }

    monkeypatch.setattr(metrics, "_collect_server_metrics", fake_collect)

    router = metrics.create_metrics_router(viewer_manager=object())
    startup = router.on_startup[0]
    shutdown = router.on_shutdown[0]
    endpoint = next(r.endpoint for r in router.routes if r.path == "/api/metrics")

    await startup()
    response = await endpoint()
    await shutdown()

    assert "calc_translation_process_uptime_seconds" in response.body.decode("utf-8")
    assert call_count["n"] >= 1


@pytest.mark.asyncio
async def test_metrics_router_endpoint_collects_when_snapshot_empty(monkeypatch):
    async def fake_collect(_manager):
        return {
            "uptime_seconds": 1,
            "process_rss_bytes": 1,
            "process_vms_bytes": 1,
            "process_shared_bytes": 1,
            "process_uss_bytes": 1,
            "process_pss_bytes": 1,
            "process_swap_bytes": 1,
            "process_memory_percent": 1,
            "container_memory_current_bytes": 1,
            "container_memory_max_bytes": 1,
            "process_cpu_percent": 1,
            "process_cpu_time_user_seconds": 1,
            "process_cpu_time_system_seconds": 1,
            "load_1": 1,
            "load_5": 1,
            "load_15": 1,
            "threads_count": 1,
            "asyncio_task_count": 1,
            "open_files_count": 1,
            "net_connections_count": 1,
            "num_fds": 1,
            "active_receiver_sessions": 0,
            "active_stream_handlers": 0,
            "active_backfill_tasks": 0,
            "active_viewer_sessions": 0,
            "active_sessions_total": 0,
            "active_viewer_connections": 0,
            "active_participants": 0,
            "active_host_plus_viewers": 0,
            "cpu_percent_per_core": [0.0],
            "gc_count_gen0": 0,
            "gc_count_gen1": 0,
            "gc_count_gen2": 0,
            "active_sessions_by_integration": {},
            "active_sessions_by_mode": {},
            "active_standalone_by_mode": {"one_way": 0, "two_way": 0},
            "active_sessions": [],
        }

    monkeypatch.setattr(metrics, "_collect_server_metrics", fake_collect)

    router = metrics.create_metrics_router(viewer_manager=object())
    endpoint = next(r.endpoint for r in router.routes if r.path == "/api/metrics")
    response = await endpoint()

    assert response.media_type.startswith("text/plain")


@pytest.mark.asyncio
async def test_metrics_router_refresh_loop_handles_exception_and_cancel(monkeypatch):
    call_index = {"n": 0}
    loop_sleep_calls = {"n": 0}
    real_sleep = asyncio.sleep

    async def fake_sleep(seconds):
        loop_sleep_calls["n"] += 1
        await real_sleep(0)

    async def fake_collect(_manager):
        call_index["n"] += 1
        if call_index["n"] == 3:
            raise RuntimeError("boom")
        if call_index["n"] >= 4:
            await real_sleep(3600)
        return {
            "uptime_seconds": 1,
            "process_rss_bytes": 1,
            "process_vms_bytes": 1,
            "process_shared_bytes": 1,
            "process_uss_bytes": 1,
            "process_pss_bytes": 1,
            "process_swap_bytes": 1,
            "process_memory_percent": 1,
            "container_memory_current_bytes": 1,
            "container_memory_max_bytes": 1,
            "process_cpu_percent": 1,
            "process_cpu_time_user_seconds": 1,
            "process_cpu_time_system_seconds": 1,
            "load_1": 1,
            "load_5": 1,
            "load_15": 1,
            "threads_count": 1,
            "asyncio_task_count": 1,
            "open_files_count": 1,
            "net_connections_count": 1,
            "num_fds": 1,
            "active_receiver_sessions": 0,
            "active_stream_handlers": 0,
            "active_backfill_tasks": 0,
            "active_viewer_sessions": 0,
            "active_sessions_total": 0,
            "active_viewer_connections": 0,
            "active_participants": 0,
            "active_host_plus_viewers": 0,
            "cpu_percent_per_core": [0.0],
            "gc_count_gen0": 0,
            "gc_count_gen1": 0,
            "gc_count_gen2": 0,
            "active_sessions_by_integration": {},
            "active_sessions_by_mode": {},
            "active_standalone_by_mode": {"one_way": 0, "two_way": 0},
            "active_sessions": [],
        }

    monkeypatch.setattr(metrics.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(metrics, "_collect_server_metrics", fake_collect)

    router = metrics.create_metrics_router(viewer_manager=object())
    startup = router.on_startup[0]
    shutdown = router.on_shutdown[0]

    await startup()
    while call_index["n"] < 4:
        await real_sleep(0)
    await shutdown()

    assert loop_sleep_calls["n"] >= 1
