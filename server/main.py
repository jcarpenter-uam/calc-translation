import os

import uvicorn
from dotenv import load_dotenv

load_dotenv()

from api.transcribe import create_transcribe_router
from api.viewing import create_viewer_router
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from services.cache import TranscriptCache
from services.connection_manager import ConnectionManager
from services.debug import log_pipeline_step
from services.download_transcript import create_download_router

app = FastAPI(
    title="CALC Transcription and Translation API",
    description="A WebSocket API to stream audio for real-time transcription and translation.",
)

DEBUG_MODE = os.getenv("DEBUG_MODE", "False").lower() == "true"
log_pipeline_step(
    "SYSTEM",
    f"Debug mode is: {'ON' if DEBUG_MODE else 'OFF'}",
    detailed=False,
)

transcript_cache = TranscriptCache()
viewer_manager = ConnectionManager(cache=transcript_cache)

transcribe_router = create_transcribe_router(viewer_manager=viewer_manager)
app.include_router(transcribe_router)

viewer_router = create_viewer_router(viewer_manager=viewer_manager)
app.include_router(viewer_router)

download_router = create_download_router()
app.include_router(download_router)


app.mount("/", StaticFiles(directory="web/dist", html=True), name="web")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
