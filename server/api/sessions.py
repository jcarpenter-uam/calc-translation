# NOTE: Tired of seeing this spammed on admin page "[2025-12-30T22:50:26.800][INFO][API-SESSION] Found 0 active sessions."

import logging
import os
import urllib.parse
from typing import Any, Dict, List

from core import database
from core.authentication import (
    get_admin_user_payload,
    get_current_user_payload,
    validate_client_token,
)
from core.database import SQL_GET_TRANSCRIPT_BY_MEETING_ID
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import FileResponse
from services.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)

OUTPUT_DIR = os.path.join("output")


def create_sessions_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the REST API router for session management,
    including active session viewing and transcript downloads.
    """
    router = APIRouter(
        prefix="/api/session",
    )
    LOG_STEP = "API-SESSION"

    # NOTE: Admin only
    @router.get(
        "",
        response_model=List[Dict[str, Any]],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_all_sessions():
        """Returns a JSON array of all currently active sessions."""
        with log_step(LOG_STEP):
            logger.debug("Request to get all active sessions.")
            sessions = viewer_manager.active_transcription_sessions
            result = [{"session_id": sid, **data} for sid, data in sessions.items()]
            logger.info(f"Found {len(result)} active sessions.")
            return result

    # NOTE: Requires User Auth AND Session Token
    @router.get(
        "/{integration}/{session_id:path}/download/vtt",
    )
    async def download_session_vtt(
        integration: str,
        session_id: str,
        language: str = Query(
            ..., description="The language code for the transcript to download"
        ),
        user_payload: dict = Depends(get_current_user_payload),
        token_payload: dict = Depends(validate_client_token),
    ):
        """
        Allows a user to download the WebVTT (transcript.vtt) file
        for a completed session.
        SECURED: Checks that the cookie user matches the token user.
        """
        with log_step(LOG_STEP):
            cookie_user_id = user_payload.get("sub")
            token_user_id = token_payload.get("user_id") or token_payload.get("sub")

            token_session_id = token_payload.get("session_id") or token_payload.get(
                "resource"
            )

            logger.info(
                f"Download Request: User '{cookie_user_id}' for Session '{session_id}' (Language: {language})"
            )

            if cookie_user_id != token_user_id:
                logger.warning(
                    f"Download Denied: Cookie user '{cookie_user_id}' != Token user '{token_user_id}'"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You are not authorized to access this session download.",
                )

            if token_session_id != session_id:
                logger.warning(
                    f"Download Denied: Token session '{token_session_id}' != URL session '{session_id}'"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid token for this specific session ID.",
                )
            try:
                language_code = language

                async with database.DB_POOL.acquire() as conn:
                    row = await conn.fetchrow(
                        SQL_GET_TRANSCRIPT_BY_MEETING_ID, session_id, language_code
                    )

                    file_name = row[0] if row else None

                if not file_name:
                    logger.warning(
                        f"Transcript record not found in DB for session: {session_id} (Lang: {language_code})"
                    )
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Transcript ({language_code}) not found. The session may be invalid or processing not complete.",
                    )

                safe_session_id = urllib.parse.quote(session_id, safe="")
                file_path = os.path.join(
                    OUTPUT_DIR, integration, safe_session_id, file_name
                )

                if not os.path.isfile(file_path):
                    logger.warning(f"Transcript file not found on disk: {file_path}")
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Transcript file not found on disk. It may have been moved or deleted.",
                    )

                logger.debug(
                    f"User '{cookie_user_id}' downloading transcript. File: {file_path}"
                )

                return FileResponse(
                    path=file_path,
                    filename=f"{integration}_{safe_session_id}_{language_code}.vtt",
                    media_type="text/vtt",
                )

            except HTTPException as e:
                logger.warning(
                    f"Failed download attempt by user '{cookie_user_id}' for session '{session_id}': {e.detail}"
                )
                raise e
            except Exception as e:
                logger.error(
                    f"Unexpected error for user '{cookie_user_id}' downloading session '{session_id}': {e}",
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"An error occurred while retrieving the file: {e}",
                )

    return router
