# /api/session/{integration}/{id}/download/vtt || downloads the .vtt file per session

import os

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

router = APIRouter(
    prefix="/api/session",
)

VTT_FILENAME = "transcript.vtt"
OUTPUT_DIR = os.path.join("output")


@router.get(
    "/{integration}/{session_id}/download/vtt",
    summary="Download Session VTT Transcript",
)
async def download_session_vtt(integration: str, session_id: str):
    """
    Allows a user to download the WebVTT (transcript.vtt) file
    for a completed session.
    """
    try:
        file_path = os.path.join(OUTPUT_DIR, integration, session_id, VTT_FILENAME)

        if not os.path.isfile(file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transcript file not found. The session may be invalid or has not been processed.",
            )

        return FileResponse(
            path=file_path,
            filename=f"{integration}_{session_id}_transcript.vtt",
            media_type="text/vtt",
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred while retrieving the file: {e}",
        )
