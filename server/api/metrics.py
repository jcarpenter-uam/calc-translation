import asyncio
import gc
import os
import time
from typing import Any

import psutil
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from services.receiver import ACTIVE_SESSIONS
from services.connection_manager import ConnectionManager

START_TIME = time.time()


def _read_int_file(path: str) -> int | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if raw == "max":
            return None
        return int(raw)
    except Exception:
        return None


def _format_metric(
    lines: list[str],
    name: str,
    value: Any,
    help_text: str,
    metric_type: str = "gauge",
):
    if value is None:
        return
    lines.append(f"# HELP {name} {help_text}")
    lines.append(f"# TYPE {name} {metric_type}")
    lines.append(f"{name} {value}")


def _escape_label_value(value: str) -> str:
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace('"', '\\"')
    )


async def _collect_server_metrics(viewer_manager: ConnectionManager) -> dict[str, Any]:
    uptime_seconds = int(time.time() - START_TIME)

    process = psutil.Process()
    cpu_percent = process.cpu_percent(interval=0.1)
    cpu_percent_by_core = psutil.cpu_percent(interval=None, percpu=True)
    cpu_times = process.cpu_times()

    mem_info = process.memory_info()
    try:
        mem_full = process.memory_full_info()
    except Exception:
        mem_full = mem_info

    try:
        load_avg = os.getloadavg()
    except OSError:
        load_avg = [0, 0, 0]

    num_fds = None
    try:
        num_fds = process.num_fds()
    except Exception:
        pass

    open_files_count = 0
    try:
        open_files_count = len(process.open_files())
    except Exception:
        pass

    net_connections_count = 0
    try:
        net_connections_count = len(process.net_connections(kind="inet"))
    except Exception:
        pass

    cgroup_mem_current = _read_int_file("/sys/fs/cgroup/memory.current")
    cgroup_mem_max = _read_int_file("/sys/fs/cgroup/memory.max")

    active_receiver_sessions = len(ACTIVE_SESSIONS)
    active_stream_handlers = sum(
        len(session.active_handlers) for session in ACTIVE_SESSIONS.values()
    )
    active_backfill_tasks = sum(
        len(session.active_backfill_tasks) for session in ACTIVE_SESSIONS.values()
    )

    active_sessions = await viewer_manager.get_global_active_sessions()
    active_viewer_connections = sum(
        int(session.get("viewers", 0)) for session in active_sessions
    )
    active_participants = 0
    active_host_plus_viewers = 0

    active_sessions_by_integration: dict[str, int] = {}
    active_sessions_by_mode: dict[str, int] = {}
    active_standalone_by_mode = {"one_way": 0, "two_way": 0}
    active_sessions_enriched: list[dict[str, Any]] = []

    for session in active_sessions:
        integration = session.get("integration") or "unknown"
        mode = "two_way" if session.get("shared_two_way_mode") else "one_way"
        viewers = int(session.get("viewers", 0))
        if integration == "standalone":
            participants = max(viewers - 1, 0)
            host_plus_viewers = viewers
        else:
            participants = viewers
            host_plus_viewers = viewers

        active_participants += participants
        active_host_plus_viewers += host_plus_viewers

        active_sessions_by_integration[integration] = (
            active_sessions_by_integration.get(integration, 0) + 1
        )
        active_sessions_by_mode[mode] = active_sessions_by_mode.get(mode, 0) + 1
        if integration == "standalone":
            active_standalone_by_mode[mode] = active_standalone_by_mode.get(mode, 0) + 1
        active_sessions_enriched.append(
            {
                **session,
                "participants": participants,
                "host_plus_viewers": host_plus_viewers,
            }
        )

    return {
        "uptime_seconds": uptime_seconds,
        "process_rss_bytes": mem_info.rss,
        "process_vms_bytes": mem_info.vms,
        "process_shared_bytes": getattr(mem_info, "shared", 0),
        "process_uss_bytes": getattr(mem_full, "uss", 0),
        "process_pss_bytes": getattr(mem_full, "pss", 0),
        "process_swap_bytes": getattr(mem_full, "swap", 0),
        "process_memory_percent": round(process.memory_percent(), 4),
        "container_memory_current_bytes": cgroup_mem_current,
        "container_memory_max_bytes": cgroup_mem_max,
        "process_cpu_percent": round(cpu_percent, 4),
        "cpu_percent_per_core": cpu_percent_by_core,
        "process_cpu_time_user_seconds": round(getattr(cpu_times, "user", 0.0), 6),
        "process_cpu_time_system_seconds": round(getattr(cpu_times, "system", 0.0), 6),
        "load_1": round(load_avg[0], 4),
        "load_5": round(load_avg[1], 4),
        "load_15": round(load_avg[2], 4),
        "threads_count": process.num_threads(),
        "asyncio_task_count": len(asyncio.all_tasks()),
        "gc_count_gen0": gc.get_count()[0],
        "gc_count_gen1": gc.get_count()[1],
        "gc_count_gen2": gc.get_count()[2],
        "open_files_count": open_files_count,
        "net_connections_count": net_connections_count,
        "num_fds": num_fds,
        "active_receiver_sessions": active_receiver_sessions,
        "active_stream_handlers": active_stream_handlers,
        "active_backfill_tasks": active_backfill_tasks,
        "active_viewer_sessions": len(active_sessions),
        "active_sessions_total": len(active_sessions),
        "active_viewer_connections": active_viewer_connections,
        "active_participants": active_participants,
        "active_host_plus_viewers": active_host_plus_viewers,
        "active_sessions_by_integration": active_sessions_by_integration,
        "active_sessions_by_mode": active_sessions_by_mode,
        "active_standalone_by_mode": active_standalone_by_mode,
        "active_sessions": active_sessions_enriched,
    }


def _to_prometheus_text(metrics: dict[str, Any]) -> str:
    lines: list[str] = []
    _format_metric(
        lines,
        "calc_translation_process_uptime_seconds",
        metrics["uptime_seconds"],
        "Server process uptime in seconds.",
        "counter",
    )
    _format_metric(
        lines,
        "calc_translation_process_resident_memory_bytes",
        metrics["process_rss_bytes"],
        "Resident memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_virtual_memory_bytes",
        metrics["process_vms_bytes"],
        "Virtual memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_shared_memory_bytes",
        metrics["process_shared_bytes"],
        "Shared memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_unique_memory_bytes",
        metrics["process_uss_bytes"],
        "Unique set size memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_proportional_memory_bytes",
        metrics["process_pss_bytes"],
        "Proportional set size memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_swap_memory_bytes",
        metrics["process_swap_bytes"],
        "Swap memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_memory_percent",
        metrics["process_memory_percent"],
        "Process memory percent usage.",
    )
    _format_metric(
        lines,
        "calc_translation_container_memory_current_bytes",
        metrics["container_memory_current_bytes"],
        "Container current memory usage in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_container_memory_max_bytes",
        metrics["container_memory_max_bytes"],
        "Container memory limit in bytes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_cpu_percent",
        metrics["process_cpu_percent"],
        "Process CPU percent usage.",
    )
    _format_metric(
        lines,
        "calc_translation_process_cpu_user_seconds_total",
        metrics["process_cpu_time_user_seconds"],
        "Process user CPU time in seconds.",
        "counter",
    )
    _format_metric(
        lines,
        "calc_translation_process_cpu_system_seconds_total",
        metrics["process_cpu_time_system_seconds"],
        "Process system CPU time in seconds.",
        "counter",
    )
    _format_metric(
        lines,
        "calc_translation_system_load_average_1m",
        metrics["load_1"],
        "System load average over 1 minute.",
    )
    _format_metric(
        lines,
        "calc_translation_system_load_average_5m",
        metrics["load_5"],
        "System load average over 5 minutes.",
    )
    _format_metric(
        lines,
        "calc_translation_system_load_average_15m",
        metrics["load_15"],
        "System load average over 15 minutes.",
    )
    _format_metric(
        lines,
        "calc_translation_process_threads",
        metrics["threads_count"],
        "Process thread count.",
    )
    _format_metric(
        lines,
        "calc_translation_runtime_asyncio_tasks",
        metrics["asyncio_task_count"],
        "Current asyncio task count.",
    )
    _format_metric(
        lines,
        "calc_translation_process_open_files",
        metrics["open_files_count"],
        "Open file descriptors as file handles count.",
    )
    _format_metric(
        lines,
        "calc_translation_process_network_connections",
        metrics["net_connections_count"],
        "Process INET network connections count.",
    )
    _format_metric(
        lines,
        "calc_translation_process_file_descriptors",
        metrics["num_fds"],
        "Number of process file descriptors.",
    )
    _format_metric(
        lines,
        "calc_translation_active_receiver_sessions",
        metrics["active_receiver_sessions"],
        "Active receiver sessions in memory.",
    )
    _format_metric(
        lines,
        "calc_translation_active_stream_handlers",
        metrics["active_stream_handlers"],
        "Active stream handlers across receiver sessions.",
    )
    _format_metric(
        lines,
        "calc_translation_active_backfill_tasks",
        metrics["active_backfill_tasks"],
        "Active backfill tasks across receiver sessions.",
    )
    _format_metric(
        lines,
        "calc_translation_active_viewer_sessions",
        metrics["active_viewer_sessions"],
        "Active session count (legacy metric name kept for compatibility).",
    )
    _format_metric(
        lines,
        "calc_translation_active_sessions_total",
        metrics["active_sessions_total"],
        "Total active transcription sessions.",
    )
    _format_metric(
        lines,
        "calc_translation_active_viewer_connections",
        metrics["active_viewer_connections"],
        "Total connected viewer sockets across active sessions (host not included).",
    )
    _format_metric(
        lines,
        "calc_translation_active_participants",
        metrics["active_participants"],
        "Estimated participants excluding host.",
    )
    _format_metric(
        lines,
        "calc_translation_active_host_plus_viewers",
        metrics["active_host_plus_viewers"],
        "Estimated host plus viewers.",
    )

    cpu_per_core = metrics["cpu_percent_per_core"]
    lines.append(
        "# HELP calc_translation_process_cpu_core_percent CPU percent by logical core."
    )
    lines.append("# TYPE calc_translation_process_cpu_core_percent gauge")
    for idx, core_percent in enumerate(cpu_per_core):
        lines.append(
            f'calc_translation_process_cpu_core_percent{{core="{idx}"}} {round(core_percent, 4)}'
        )

    gc_counts = [
        metrics["gc_count_gen0"],
        metrics["gc_count_gen1"],
        metrics["gc_count_gen2"],
    ]
    lines.append("# HELP calc_translation_runtime_gc_objects_by_generation GC object count by generation.")
    lines.append("# TYPE calc_translation_runtime_gc_objects_by_generation gauge")
    for idx, value in enumerate(gc_counts):
        lines.append(
            f'calc_translation_runtime_gc_objects_by_generation{{generation="{idx}"}} {value}'
        )

    lines.append(
        "# HELP calc_translation_active_sessions_by_integration Active sessions grouped by integration."
    )
    lines.append("# TYPE calc_translation_active_sessions_by_integration gauge")
    for integration, count in metrics["active_sessions_by_integration"].items():
        integration_safe = _escape_label_value(integration)
        lines.append(
            f'calc_translation_active_sessions_by_integration{{integration="{integration_safe}"}} {count}'
        )

    lines.append(
        "# HELP calc_translation_active_sessions_by_mode Active sessions grouped by translation mode."
    )
    lines.append("# TYPE calc_translation_active_sessions_by_mode gauge")
    for mode, count in metrics["active_sessions_by_mode"].items():
        mode_safe = _escape_label_value(mode)
        lines.append(
            f'calc_translation_active_sessions_by_mode{{mode="{mode_safe}"}} {count}'
        )

    lines.append(
        "# HELP calc_translation_active_standalone_sessions_by_mode Active standalone sessions grouped by translation mode."
    )
    lines.append("# TYPE calc_translation_active_standalone_sessions_by_mode gauge")
    for mode, count in metrics["active_standalone_by_mode"].items():
        mode_safe = _escape_label_value(mode)
        lines.append(
            f'calc_translation_active_standalone_sessions_by_mode{{mode="{mode_safe}"}} {count}'
        )

    lines.append(
        "# HELP calc_translation_session_viewers Connected viewers per active session."
    )
    lines.append("# TYPE calc_translation_session_viewers gauge")
    lines.append(
        "# HELP calc_translation_session_participants Estimated participants per active session excluding host."
    )
    lines.append("# TYPE calc_translation_session_participants gauge")
    lines.append(
        "# HELP calc_translation_session_host_plus_viewers Estimated host plus viewers per active session."
    )
    lines.append("# TYPE calc_translation_session_host_plus_viewers gauge")
    for session in metrics["active_sessions"]:
        session_id = session.get("session_id") or "unknown"
        integration = session.get("integration") or "unknown"
        mode = "two_way" if session.get("shared_two_way_mode") else "one_way"
        session_id_safe = _escape_label_value(session_id)
        integration_safe = _escape_label_value(integration)
        mode_safe = _escape_label_value(mode)
        viewers = int(session.get("viewers", 0))
        participants = int(session.get("participants", viewers))
        host_plus_viewers = int(session.get("host_plus_viewers", viewers))
        lines.append(
            f'calc_translation_session_viewers{{session_id="{session_id_safe}",integration="{integration_safe}",mode="{mode_safe}"}} {viewers}'
        )
        lines.append(
            f'calc_translation_session_participants{{session_id="{session_id_safe}",integration="{integration_safe}",mode="{mode_safe}"}} {participants}'
        )
        lines.append(
            f'calc_translation_session_host_plus_viewers{{session_id="{session_id_safe}",integration="{integration_safe}",mode="{mode_safe}"}} {host_plus_viewers}'
        )

    return "\n".join(lines) + "\n"


def create_metrics_router(viewer_manager: ConnectionManager):
    """
    Creates the REST API router for metrics.
    Requires viewer_manager to access active session data.
    """
    router = APIRouter()

    async def _build_server_metrics_response() -> PlainTextResponse:
        metrics = await _collect_server_metrics(viewer_manager)
        body = _to_prometheus_text(metrics)
        return PlainTextResponse(
            content=body,
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )

    @router.get("/api/metrics", response_class=PlainTextResponse)
    async def get_prometheus_metrics():
        return await _build_server_metrics_response()

    return router
