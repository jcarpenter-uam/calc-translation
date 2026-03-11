import logging
import os
from collections import deque

from core.authentication import get_admin_user_payload
from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/logs")

LOG_FILE = "server.log"


@router.get("/")
async def get_server_logs(
    lines: int = Query(100, ge=1, le=1000),
    dependencies=[Depends(get_admin_user_payload)],
):
    """
    Returns the last N lines of the server log file.
    """
    if not os.path.exists(LOG_FILE):
        return {"logs": ["Log file not found."]}

    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
            last_lines = deque(f, maxlen=lines)
            return {"logs": list(last_lines)}

    except Exception as e:
        logger.error(f"Failed to read log file: {e}")
        raise HTTPException(status_code=500, detail="Could not read logs")


def create_logs_router():
    return router
