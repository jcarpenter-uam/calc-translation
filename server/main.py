import logging

from core.logging_setup import setup_logging

setup_logging()

from core.config import settings

logger = logging.getLogger(__name__)

logger.info(f"Configuration loaded. Log level set to: {settings.LOGGING_LEVEL}")

from api.auth import create_auth_router
from api.logs import create_logs_router
from api.sessions import create_sessions_router
from api.tenants import create_tenant_router
from api.transcribe import create_transcribe_router
from api.users import create_user_router
from api.viewing import create_viewer_router
from core import database
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
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
    await database.init_db()


transcript_cache = TranscriptCache()
viewer_manager = ConnectionManager(cache=transcript_cache)

transcribe_router = create_transcribe_router(viewer_manager=viewer_manager)
app.include_router(transcribe_router)

viewer_router = create_viewer_router(viewer_manager=viewer_manager)
app.include_router(viewer_router)

sessions_router = create_sessions_router(viewer_manager=viewer_manager)
app.include_router(sessions_router)

tenant_router = create_tenant_router()
app.include_router(tenant_router)

user_router = create_user_router()
app.include_router(user_router)

auth_router = create_auth_router()
app.include_router(auth_router)

logs_router = create_logs_router()
app.include_router(logs_router)

app.mount(
    "/icon.png",
    StaticFiles(directory="web/dist", html=True, check_dir=False),
    name="icon",
)

app.mount("/assets", StaticFiles(directory="web/dist/assets"), name="assets")

app.mount(
    "/translations", StaticFiles(directory="web/dist/translations"), name="translations"
)


@app.get("/{full_path:path}", response_class=FileResponse)
async def serve_spa(request: Request, full_path: str):
    """
    Serve the single-page application's index.html for any path
    not handled by API routes or static file mounts.
    """
    return FileResponse("web/dist/index.html")
