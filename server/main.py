import logging

from core.logging_setup import setup_logging

setup_logging()

from core.config import settings

logger = logging.getLogger(__name__)

logger.info(f"Configuration loaded. Log level set to: {settings.LOGGING_LEVEL}")
correction_status = (
    "Enabled" if settings.OLLAMA_URL and settings.ALIBABA_API_KEY else "Disabled"
)
logger.info(f"Configuration loaded. Correction: {correction_status}")

from api.auth import create_auth_router
from api.clients import create_clients_router
from api.sessions import router as sessions_router
from api.tenants import create_tenant_router
from api.transcribe import create_transcribe_router
from api.viewing import create_viewer_router
from core import database
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from services.cache import TranscriptCache
from services.connection_manager import ConnectionManager

app = FastAPI(
    title="CALC Transcription and Translation API",
    description="A WebSocket API to stream audio for real-time transcription and translation.",
)


@app.on_event("startup")
async def startup_event():
    """
    On application startup, initialize the database.
    This ensures the DB file and tables are ready before handling requests.
    """
    logger.info("Running startup tasks...")
    await database.init_db()
    logger.info("Startup tasks completed.")


transcript_cache = TranscriptCache()
viewer_manager = ConnectionManager(cache=transcript_cache)

transcribe_router = create_transcribe_router(viewer_manager=viewer_manager)
app.include_router(transcribe_router)

viewer_router = create_viewer_router(viewer_manager=viewer_manager)
app.include_router(viewer_router)

clients_router = create_clients_router(viewer_manager=viewer_manager)
app.include_router(clients_router)

app.include_router(sessions_router)

tenant_router = create_tenant_router()
app.include_router(tenant_router)

auth_router = create_auth_router()
app.include_router(auth_router)

app.mount("/", StaticFiles(directory="web/dist", html=True), name="web")
