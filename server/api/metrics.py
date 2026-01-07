import logging
import os
import time

import httpx
import psutil
from core.authentication import get_admin_user_payload
from core.config import settings
from fastapi import APIRouter, Depends, HTTPException
from services.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)

START_TIME = time.time()


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
        cpu_percent = process.cpu_percent(interval=None)

        mem_info = process.memory_info()
        rss_mb = round(mem_info.rss / 1024 / 1024)

        try:
            load_avg = os.getloadavg()
        except OSError:
            load_avg = [0, 0, 0]

        sessions_map = viewer_manager.active_transcription_sessions
        active_sessions = []

        for sid, data in sessions_map.items():
            sockets = viewer_manager.sessions.get(sid, [])
            total_viewers = len(sockets)

            language_counts = {}
            for ws in sockets:
                lang = viewer_manager.socket_languages.get(ws, "unknown")
                language_counts[lang] = language_counts.get(lang, 0) + 1

            active_sessions.append(
                {
                    "session_id": sid,
                    **data,
                    "viewers": total_viewers,
                    "viewer_languages": language_counts,
                }
            )

        return {
            "status": "ok",
            "service": "calc-translation-server",
            "system": {
                "uptimeSeconds": uptime_seconds,
                "memoryMB": {"rss": rss_mb},
                "cpuPercent": cpu_percent,
                "loadAverage": list(load_avg),
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
