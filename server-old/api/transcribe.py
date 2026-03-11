import logging

from core.authentication import get_current_user_payload
from core.logging_setup import log_step
from core.security import validate_server_token
from fastapi import APIRouter, HTTPException, Path, WebSocket, status
from integrations.zoom import get_meeting_data
from services.receiver import handle_receiver_session

logger = logging.getLogger(__name__)


def create_transcribe_router(viewer_manager):
    """
    Creates the WebSocket router for the transcription/translation endpoint.
    """
    router = APIRouter(
        prefix="/ws/transcribe",
    )
    LOG_STEP = "WS-TRANSCRIBE"

    @router.websocket("/{integration}/{session_id:path}")
    async def websocket_transcribe_endpoint(
        websocket: WebSocket,
        integration: str = Path(),
        session_id: str = Path(),
    ):
        """
        Handles the WebSocket connection for a transcription session.
        Authentication is handled conditionally based on the integration.
        """
        await websocket.accept()

        with log_step(LOG_STEP):
            try:
                logger.info(
                    f"New WebSocket connection for session: {session_id} (Integration: {integration})"
                )

                if integration == "zoom":
                    auth_header = websocket.headers.get("authorization")
                    token = ""
                    if auth_header:
                        parts = auth_header.split()
                        if len(parts) == 2 and parts[0] == "Bearer":
                            token = parts[1]

                    if not token:
                        logger.warning(
                            "Zoom WS Auth failed: Missing Authorization header"
                        )
                        await websocket.close(
                            code=status.WS_1008_POLICY_VIOLATION,
                            reason="Missing Authorization header",
                        )
                        return

                    try:
                        payload = validate_server_token(token)
                    except Exception as e:
                        logger.warning(f"Zoom WS Auth failed: {e}")
                        await websocket.close(
                            code=status.WS_1008_POLICY_VIOLATION,
                            reason="Authentication failed",
                        )
                        return

                    zoom_host_id = payload.get("zoom_host_id")
                    user_id = payload.get("sub")

                    if zoom_host_id:
                        logger.info(
                            f"Proactively fetching Zoom data using zoom_host_id: {zoom_host_id}"
                        )
                        await get_meeting_data(
                            meeting_uuid=session_id, zoom_host_id=zoom_host_id
                        )
                    elif user_id:
                        logger.info(
                            f"Proactively fetching Zoom data using user_id: {user_id}"
                        )
                        await get_meeting_data(meeting_uuid=session_id, user_id=user_id)
                    else:
                        logger.warning(
                            "Zoom connection rejected: Token has neither 'zoom_host_id' nor 'sub' (user_id)."
                        )
                        await websocket.close(
                            code=1008,
                            reason="Invalid authentication: missing required identifiers.",
                        )
                        return

                elif integration == "standalone":
                    token = websocket.cookies.get("app_auth_token")

                    if not token:
                        logger.warning(
                            "Standalone WS Auth failed: No 'app_auth_token' cookie found."
                        )
                        await websocket.close(
                            code=status.WS_1008_POLICY_VIOLATION,
                            reason="Missing authentication cookie",
                        )
                        return

                    try:
                        user_payload = get_current_user_payload(token=token)
                        user_id = user_payload.get("sub")
                        if not user_id:
                            raise Exception("User ID not found in payload")

                        logger.info(
                            f"Standalone Host authenticated: {user_id} for session {session_id}"
                        )
                    except Exception as e:
                        logger.warning(f"Standalone WS Auth failed: {e}")
                        await websocket.close(
                            code=status.WS_1008_POLICY_VIOLATION,
                            reason="Authentication failed",
                        )
                        return
                else:
                    logger.warning(f"Unknown integration type: {integration}")
                    await websocket.close(code=1003, reason="Unsupported integration")
                    return

                logger.info(f"Handing off session {session_id} to receiver.")
                backfill_service = getattr(websocket.app.state, "backfill_service", None)
                summary_service = getattr(websocket.app.state, "summary_service", None)
                if backfill_service is None or summary_service is None:
                    logger.error("Shared services are not initialized.")
                    await websocket.close(
                        code=1011,
                        reason="Server error: services not initialized.",
                    )
                    return

                await handle_receiver_session(
                    websocket=websocket,
                    integration=integration,
                    session_id=session_id,
                    viewer_manager=viewer_manager,
                    backfill_service=backfill_service,
                    summary_service=summary_service,
                )

            except HTTPException as e:
                logger.warning(
                    f"Failed to get Zoom meeting data for {session_id}: {e.detail}",
                )
                await websocket.close(code=1011, reason=f"Zoom Error: {e.detail}")
                return
            except Exception as e:
                logger.error(
                    f"Unexpected error during WebSocket setup for {session_id}: {e}",
                    exc_info=True,
                )
                await websocket.close(
                    code=1011, reason="Server error: Could not prepare session."
                )
                return

            logger.info(f"WebSocket session {session_id} closed.")

    return router
