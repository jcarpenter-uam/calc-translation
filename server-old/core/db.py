import logging

from core.logging_setup import log_step
from core.orm import AsyncSessionLocal, init_orm

logger = logging.getLogger(__name__)

LOG_STEP = "DATABASE"


async def init_db() -> None:
    """Initialize ORM-managed schema."""
    try:
        await init_orm()
        with log_step(LOG_STEP):
            logger.info("ORM initialized successfully and schema verified.")
    except Exception as e:
        with log_step(LOG_STEP):
            logger.error(f"Failed to initialize ORM: {e}", exc_info=True)
        raise


__all__ = ["AsyncSessionLocal", "init_db"]
