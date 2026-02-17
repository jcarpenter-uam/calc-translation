import logging
import uuid
from datetime import datetime
from typing import List, Literal, Optional
from urllib.parse import urlparse

from core.config import settings
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import HTTPException
from models.integrations import Integration
from models.meetings import Meeting
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger(__name__)

LOG_STEP = "INT-STANDALONE"


class StandaloneAuthRequest(BaseModel):
    join_url: Optional[str] = None
    host: bool = False
    language_hints: Optional[List[str]] = None
    translation_type: Optional[Literal["one_way", "two_way"]] = "one_way"
    language_a: Optional[str] = None
    language_b: Optional[str] = None


class StandaloneAuthResponse(BaseModel):
    sessionId: str
    token: str
    type: str
    joinUrl: Optional[str] = None


async def authenticate_standalone_session(request: StandaloneAuthRequest) -> str:
    search_id = None
    if request.join_url:
        try:
            parsed = urlparse(request.join_url)
            if parsed.path:
                search_id = parsed.path.strip("/").split("/")[-1]
            else:
                search_id = request.join_url
        except Exception:
            search_id = request.join_url

    if not search_id:
        raise HTTPException(status_code=400, detail="A Join URL is required.")

    async with AsyncSessionLocal() as session:
        with log_step(LOG_STEP):
            row = await session.execute(
                select(Meeting.id).where(Meeting.id == search_id, Meeting.platform == "standalone")
            )
            meeting_id = row.scalar_one_or_none()
            if meeting_id:
                return meeting_id
            raise HTTPException(status_code=404, detail="Meeting not found.")


async def create_standalone_session(
    user_id: str,
    language_hints: Optional[List[str]] = None,
    translation_type: str = "one_way",
    language_a: Optional[str] = None,
    language_b: Optional[str] = None,
) -> tuple[str, str]:
    meeting_uuid = str(uuid.uuid4())
    base_url = settings.APP_BASE_URL.rstrip("/")
    join_url = f"{base_url}/sessions/standalone/{meeting_uuid}"
    now = datetime.now()

    with log_step(LOG_STEP):
        async with AsyncSessionLocal() as session:
            row = await session.execute(
                select(Integration).where(
                    Integration.user_id == user_id,
                    Integration.platform.in_(["microsoft", "google"]),
                )
            )
            integration = row.scalar_one_or_none()
            if not integration:
                raise HTTPException(
                    status_code=400,
                    detail="User must be authenticated with a valid provider (Microsoft or Google) to host.",
                )

            stmt = insert(Meeting).values(
                id=meeting_uuid,
                integration_id=integration.id,
                passcode=None,
                platform="standalone",
                readable_id=None,
                meeting_time=now,
                join_url=join_url,
                topic=None,
                language_hints=language_hints,
                translation_type=translation_type,
                translation_language_a=language_a,
                translation_language_b=language_b,
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=[Meeting.id])
            await session.execute(stmt)
            await session.commit()

    return meeting_uuid, join_url
