import asyncio
import gc
import logging
import os
import threading
import time

import httpx
import psutil
from core.authentication import get_admin_user_payload
from core.config import settings
from fastapi import APIRouter, Depends, HTTPException
from services.receiver import ACTIVE_SESSIONS
from services.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)

START_TIME = time.time()


def _safe_mb(value: int | float | None) -> float:
    if not value:
        return 0.0
    return round(float(value) / 1024 / 1024, 2)


def _read_int_file(path: str) -> int | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if raw == "max":
            return None
        return int(raw)
    except Exception:
        return None


def create_metrics_router(viewer_manager: ConnectionManager):
    """
    Creates the REST API router for metrics.
    Requires viewer_manager to access active session data.
    """
    router = APIRouter(prefix="/api/metrics")

    @router.get("/server")
    async def get_server_metrics(
        user: dict = Depends(get_admin_user_payload),
    ):
        """
        Returns handmade server metrics (JSON), including:
        - Process-specific CPU usage (Docker friendly)
        - Active Sessions with Viewer Counts & Language Breakdowns
        """
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
        rss_mb = _safe_mb(mem_info.rss)

        try:
            load_avg = os.getloadavg()
        except OSError:
            load_avg = [0, 0, 0]

        threads = process.threads()
        thread_name_by_native_id = {
            (t.native_id or -1): t.name for t in threading.enumerate()
        }
        top_threads = sorted(
            [
                {
                    "thread_id": t.id,
                    "name": thread_name_by_native_id.get(t.id, "unknown"),
                    "cpu_seconds": round(t.user_time + t.system_time, 4),
                    "user_seconds": round(t.user_time, 4),
                    "system_seconds": round(t.system_time, 4),
                }
                for t in threads
            ],
            key=lambda x: x["cpu_seconds"],
            reverse=True,
        )[:8]

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
        cgroup_mem_percent = None
        if cgroup_mem_current is not None and cgroup_mem_max and cgroup_mem_max > 0:
            cgroup_mem_percent = round((cgroup_mem_current / cgroup_mem_max) * 100, 2)

        active_receiver_sessions = len(ACTIVE_SESSIONS)
        active_stream_handlers = sum(
            len(session.active_handlers) for session in ACTIVE_SESSIONS.values()
        )
        active_backfill_tasks = sum(
            len(session.active_backfill_tasks) for session in ACTIVE_SESSIONS.values()
        )

        active_sessions = await viewer_manager.get_global_active_sessions()
        cache_usage = await viewer_manager.cache.get_usage_stats()

        return {
            "status": "ok",
            "service": "calc-translation-server",
            "system": {
                "uptimeSeconds": uptime_seconds,
                "memoryMB": {
                    "rss": rss_mb,
                    "vms": _safe_mb(mem_info.vms),
                    "shared": _safe_mb(getattr(mem_info, "shared", 0)),
                    "uss": _safe_mb(getattr(mem_full, "uss", 0)),
                    "pss": _safe_mb(getattr(mem_full, "pss", 0)),
                    "swap": _safe_mb(getattr(mem_full, "swap", 0)),
                },
                "memoryPercent": round(process.memory_percent(), 2),
                "containerMemoryMB": {
                    "current": _safe_mb(cgroup_mem_current) if cgroup_mem_current else 0,
                    "max": _safe_mb(cgroup_mem_max) if cgroup_mem_max else 0,
                    "percent": cgroup_mem_percent,
                },
                "cpuPercent": cpu_percent,
                "cpuPercentPerCore": cpu_percent_by_core,
                "cpuTimesSec": {
                    "user": round(getattr(cpu_times, "user", 0.0), 3),
                    "system": round(getattr(cpu_times, "system", 0.0), 3),
                },
                "loadAverage": list(load_avg),
                "threads": {
                    "count": process.num_threads(),
                    "topByCpuSeconds": top_threads,
                },
                "runtime": {
                    "asyncioTaskCount": len(asyncio.all_tasks()),
                    "gc": {
                        "counts": list(gc.get_count()),
                        "thresholds": list(gc.get_threshold()),
                    },
                },
                "io": {
                    "openFilesCount": open_files_count,
                    "netConnectionsCount": net_connections_count,
                    "numFds": num_fds,
                },
                "appWorkload": {
                    "activeReceiverSessions": active_receiver_sessions,
                    "activeStreamHandlers": active_stream_handlers,
                    "activeBackfillTasks": active_backfill_tasks,
                    "transcriptCache": cache_usage,
                },
            },
            "activeSessionsCount": len(active_sessions),
            "sessions": active_sessions,
        }

    @router.get("/zoom")
    async def get_zoom_metrics(
        user: dict = Depends(get_admin_user_payload),
    ):
        """
        Proxies the metrics from the zoom microservice.
        """
        target_url = settings.ZM_METRICS_URL

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(target_url, timeout=5.0)

                if response.status_code != 200:
                    logger.error(f"Zoom service returned status {response.status_code}")
                    raise HTTPException(status_code=502, detail="Zoom service error")

                return response.json()

        except httpx.RequestError as exc:
            logger.error(f"Error requesting Zoom metrics: {exc}")
            raise HTTPException(status_code=503, detail="Zoom service unavailable")

    return router
