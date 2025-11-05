import os

from fastapi import APIRouter, HTTPException
from starlette.responses import FileResponse

try:
    from .debug_service import log_pipeline_step
except ImportError:

    def log_pipeline_step(tag, message, **kwargs):
        print(f"[{tag}] {message}")


HISTORY_DIR = "session_history"


def create_download_router():
    """
    Creates a FastAPI router for downloading the most recent transcript file.
    """
    router = APIRouter()

    @router.get("/api/download-vtt")
    async def download_most_recent_vtt():
        """
        Finds the *most recently created* .vtt file in the
        hardcoded 'HISTORY_DIR' and returns it as a file download.
        """
        log_pipeline_step(
            "DOWNLOAD",
            f"Download request received for most recent file in: {HISTORY_DIR}",
            detailed=False,
        )

        abs_history_dir = os.path.abspath(HISTORY_DIR)

        if not os.path.isdir(abs_history_dir):
            log_pipeline_step(
                "DOWNLOAD",
                f"ERROR: Directory not found: {abs_history_dir}",
                detailed=False,
            )
            raise HTTPException(
                status_code=404, detail=f"Session history directory not found."
            )

        vtt_files = []
        try:
            for f_name in os.listdir(abs_history_dir):
                if f_name.startswith("history_") and f_name.endswith(".vtt"):
                    full_path = os.path.join(abs_history_dir, f_name)
                    vtt_files.append(full_path)
        except Exception as e:
            log_pipeline_step(
                "DOWNLOAD",
                f"ERROR: Error listing files in directory: {e}",
                detailed=False,
            )
            raise HTTPException(
                status_code=500, detail="Error accessing session history."
            )

        if not vtt_files:
            log_pipeline_step(
                "DOWNLOAD",
                f"ERROR: No .vtt files found in {abs_history_dir}",
                detailed=False,
            )
            raise HTTPException(
                status_code=404, detail="No transcript file found in session directory."
            )

        try:
            most_recent_file = max(vtt_files, key=os.path.getctime)
            file_name = os.path.basename(most_recent_file)

            log_pipeline_step(
                "DOWNLOAD", f"Serving most recent file: {file_name}", detailed=True
            )

            return FileResponse(
                path=most_recent_file, media_type="text/vtt", filename=file_name
            )
        except Exception as e:
            log_pipeline_step(
                "DOWNLOAD", f"ERROR: Error serving file: {e}", detailed=False
            )
            raise HTTPException(
                status_code=500, detail="Error preparing file for download."
            )

    return router
