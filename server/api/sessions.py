import logging
import os
import urllib.parse
from typing import Any, Dict, List

from core import database
from core.authentication import get_admin_user_payload, get_current_user_payload
from core.database import SQL_GET_TRANSCRIPT_BY_MEETING_ID
from fastapi import APIRouter, Depends, HTTPException, Path, status
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

    # NOTE: Admin only
    @router.get(
        "",
        response_model=List[Dict[str, Any]],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_all_sessions():
        """Returns a JSON array of all currently active sessions."""
        sessions = viewer_manager.active_transcription_sessions
        return [{"session_id": sid, **data} for sid, data in sessions.items()]

    # NOTE: Admin only
    @router.get(
        "/{integration}",
        response_model=List[Dict[str, Any]],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_sessions_by_integration(integration: str = Path()):
        """Returns a JSON array of all active sessions for a specific integration."""
        sessions = viewer_manager.active_transcription_sessions
        return [
            {"session_id": sid, **data}
            for sid, data in sessions.items()
            if data.get("integration") == integration
        ]

    # NOTE: Requires User Auth
    @router.get(
        "/{integration}/{session_id:path}/download/vtt",
    )
    async def download_session_vtt(
        integration: str,
        session_id: str,
        user_payload: dict = Depends(get_current_user_payload),
    ):
        """
        Allows a user to download the WebVTT (transcript.vtt) file
        for a completed session.

        This endpoint first queries the database to find the transcript record
        and then constructs the file path to serve it.
        """
        user_id = user_payload.get("sub", "unknown")

        try:
            file_name = None

            async with database.DB_POOL.acquire() as conn:
                row = await conn.fetchrow(SQL_GET_TRANSCRIPT_BY_MEETING_ID, session_id)
                if row:
                    file_name = row[0]

            if not file_name:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Transcript record not found in database. The session may be invalid or has not been processed.",
                )

            safe_session_id = urllib.parse.quote(session_id, safe="")
            file_path = os.path.join(
                OUTPUT_DIR, integration, safe_session_id, file_name
            )

            if not os.path.isfile(file_path):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Transcript file not found on disk. It may have been moved or deleted.",
                )

            logger.debug(
                f"User '{user_id}' downloading transcript for session: '{session_id}' (Integration: '{integration}'). File: {file_path}"
            )

            return FileResponse(
                path=file_path,
                filename=f"{integration}_{safe_session_id}_transcript.vtt",
                media_type="text/vtt",
            )

        except HTTPException as e:
            logger.warning(
                f"Failed download attempt by user '{user_id}' for session '{session_id}': {e.detail}"
            )
            raise e
        except Exception as e:
            logger.error(
                f"Unexpected error for user '{user_id}' downloading session '{session_id}': {e}",
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"An error occurred while retrieving the file: {e}",
            )

    # NOTE: Admin only
    @router.get(
        "/{integration}/{session_id:path}",
        response_model=Dict[str, Any],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_session_details(integration: str = Path(), session_id: str = Path()):
        """Returns status data for a specific active session."""
        session_data = viewer_manager.active_transcription_sessions.get(session_id)

        if not session_data or session_data.get("integration") != integration:
            raise HTTPException(status_code=404, detail="Active session not found")

        return {"session_id": session_id, **session_data}

    return router
