from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Path
from services.connection_manager import ConnectionManager


def create_clients_router(viewer_manager: ConnectionManager) -> APIRouter:
    """
    Creates the REST API router for viewing client and session status.
    """
    router = APIRouter(
        prefix="/api/clients",
    )

    @router.get("", response_model=List[Dict[str, Any]])
    async def get_all_clients():
        """Returns a JSON array of all currently connected clients."""
        sessions = viewer_manager.active_transcription_sessions
        return [{"session_id": sid, **data} for sid, data in sessions.items()]

    @router.get("/{integration}", response_model=List[Dict[str, Any]])
    async def get_clients_by_integration(integration: str = Path()):
        """Returns a JSON array of all clients for a specific integration."""
        sessions = viewer_manager.active_transcription_sessions
        return [
            {"session_id": sid, **data}
            for sid, data in sessions.items()
            if data.get("integration") == integration
        ]

    @router.get("/{integration}/{session_id}", response_model=Dict[str, Any])
    async def get_client_session(integration: str = Path(), session_id: str = Path()):
        """Returns status data for a specific session."""
        session_data = viewer_manager.active_transcription_sessions.get(session_id)

        if not session_data or session_data.get("integration") != integration:
            raise HTTPException(status_code=404, detail="Session not found")

        return {"session_id": session_id, **session_data}

    return router
