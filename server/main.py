import logging

import uvicorn
from core.config import settings
from core.logging_setup import log_step, setup_logging

setup_logging()

logger = logging.getLogger(__name__)

from api.clients import create_clients_router
from api.sessions import router as sessions_router
from api.transcribe import create_transcribe_router
from api.viewing import create_viewer_router
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from services.cache import TranscriptCache
from services.connection_manager import ConnectionManager

app = FastAPI(
    title="CALC Transcription and Translation API",
    description="A WebSocket API to stream audio for real-time transcription and translation.",
)

with log_step("SYSTEM"):
    logger.info(
        f"Application starting up. Log level set to: {settings.LOGGING_LEVEL.upper()}"
    )

transcript_cache = TranscriptCache()
viewer_manager = ConnectionManager(cache=transcript_cache)

transcribe_router = create_transcribe_router(viewer_manager=viewer_manager)
app.include_router(transcribe_router)

viewer_router = create_viewer_router(viewer_manager=viewer_manager)
app.include_router(viewer_router)

clients_router = create_clients_router(viewer_manager=viewer_manager)
app.include_router(clients_router)

app.include_router(sessions_router)

app.mount("/", StaticFiles(directory="web/dist", html=True), name="web")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
