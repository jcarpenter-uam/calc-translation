# /api/session/{integration}/{id}/download/vtt || downloads the .vtt file per session

import os

import aiosqlite
from core.database import DB_PATH, SQL_GET_TRANSCRIPT_BY_MEETING_ID
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(
    prefix="/api/session",
)

OUTPUT_DIR = os.path.join("output")


# TODO: Test and connect dynamiclly to frontend
@router.get(
    "/{integration}/{session_id}/download/vtt",
    summary="Download Session VTT Transcript",
)
async def download_session_vtt(integration: str, session_id: str):
    """
    Allows a user to download the WebVTT (transcript.vtt) file
    for a completed session.

    This endpoint first queries the database to find the transcript record
    and then constructs the file path to serve it.
    """
    try:
        file_name = None
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                SQL_GET_TRANSCRIPT_BY_MEETING_ID, (session_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    file_name = row[0]

        if not file_name:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transcript record not found in database. The session may be invalid or has not been processed.",
            )

        file_path = os.path.join(OUTPUT_DIR, integration, session_id, file_name)

        if not os.path.isfile(file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transcript file not found on disk. It may have been moved or deleted.",
            )

        return FileResponse(
            path=file_path,
            filename=f"{integration}_{session_id}_transcript.vtt",
            media_type="text/vtt",
        )

    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while retrieving the file: {e}",
        )
