import logging
import os
import urllib.parse

from core import database
from core.authentication import get_current_user_payload, validate_client_token
from core.database import SQL_GET_TRANSCRIPT_BY_MEETING_ID
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

OUTPUT_DIR = os.path.join("output")


def create_sessions_router() -> APIRouter:
    """
    Creates the REST API router for session management,
    including active session viewing and transcript downloads.
    """
    router = APIRouter(
        prefix="/api/session",
    )
    LOG_STEP = "API-SESSION"

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
                resolved_session_id = session_id
                file_name = None

                async with database.DB_POOL.acquire() as conn:
                    row = await conn.fetchrow(
                        SQL_GET_TRANSCRIPT_BY_MEETING_ID, session_id, language_code
                    )

                    if row:
                        file_name = row[0]
                    else:
                        logger.info(
                            f"Transcript not found for {session_id}. Attempting fallback via readable_id."
                        )

                        m_row = await conn.fetchrow(
                            "SELECT readable_id FROM MEETINGS WHERE id = $1", session_id
                        )

                        if m_row and m_row["readable_id"]:
                            readable_id = m_row["readable_id"]

                            fallback_sql = """
                                SELECT t.file_name, t.meeting_id
                                FROM TRANSCRIPTS t
                                JOIN MEETINGS m ON t.meeting_id = m.id
                                WHERE m.readable_id = $1 AND t.language_code = $2
                                ORDER BY t.creation_date DESC
                                LIMIT 1
                            """
                            t_row = await conn.fetchrow(
                                fallback_sql, readable_id, language_code
                            )

                            if t_row:
                                file_name = t_row["file_name"]
                                resolved_session_id = t_row["meeting_id"]
                                logger.info(
                                    f"Fallback successful: Resolved {session_id} -> {resolved_session_id}"
                                )

                if not file_name:
                    logger.warning(
                        f"Transcript record not found in DB for session: {session_id} (Lang: {language_code})"
                    )
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Transcript ({language_code}) not found. The session may be invalid or processing not complete.",
                    )

                safe_session_id = urllib.parse.quote(resolved_session_id, safe="")
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
