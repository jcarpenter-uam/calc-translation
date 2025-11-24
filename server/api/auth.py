import logging

from core.config import settings
from core.logging_setup import log_step
from core.security import generate_jwt_token
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from integrations.test import TestAuthRequest, authenticate_test_session
from integrations.zoom import (
    ZoomAuthRequest,
    ZoomAuthResponse,
    authenticate_zoom_session,
    exchange_code_for_token,
)

logger = logging.getLogger(__name__)


def create_auth_router() -> APIRouter:
    """
    Creates the REST API router for auth.
    """
    router = APIRouter(
        prefix="/api/auth",
    )

    @router.post("/test", response_model=ZoomAuthResponse)
    async def handle_test_auth(request: TestAuthRequest):
        """
        Generates a token for a dynamic test session ID provided
        in the request body.
        """
        try:
            session_id = await authenticate_test_session(request)

            logger.info(f"Generating test token for session: {session_id}")
            token = generate_jwt_token(session_id=session_id)
            return ZoomAuthResponse(meetinguuid=session_id, token=token)

        except HTTPException as e:
            raise e
        except Exception as e:
            with log_step("AUTH"):
                logger.error(
                    f"Unhandled error in POST /api/auth/test: {e}", exc_info=True
                )
            raise HTTPException(
                status_code=500, detail="An internal server error occurred."
            )

    @router.post("/zoom", response_model=ZoomAuthResponse)
    async def handle_zoom_auth(request: ZoomAuthRequest):
        """
        Authenticates a Zoom session.
        Passes the request to the integration-specific logic.
        """
        test_user_id = "TEST_USER_ID"  # NOTE: Temp until EntraID is integrated
        try:
            if not request.join_url and not request.meetingid:
                raise HTTPException(
                    status_code=400,
                    detail="Either 'join_url' or 'meetingid' must be provided.",
                )

            meeting_uuid = await authenticate_zoom_session(request=request)

            token = generate_jwt_token(session_id=meeting_uuid)
            return ZoomAuthResponse(meetinguuid=meeting_uuid, token=token)

        except HTTPException as e:
            raise e
        except Exception as e:
            with log_step("AUTH"):
                logger.error(
                    f"Unhandled error in POST /api/auth/zoom: {e}", exc_info=True
                )
            raise HTTPException(
                status_code=500, detail="An internal server error occurred."
            )

    @router.get("/zoom/callback")
    async def handle_zoom_callback(request: Request):
        """
        Handles the OAuth redirect from Zoom.
        Passes the code to the zoom integration logic to exchange for a token.
        """
        code = request.query_params.get("code")
        if not code:
            raise HTTPException(
                status_code=400, detail="Missing authorization code from Zoom"
            )

        test_user_id = "TEST_USER_ID"  # NOTE: Temp until EntraID is integrated

        try:
            redirect_uri = f"{settings.APP_BASE_URL}/api/auth/zoom/callback"

            await exchange_code_for_token(code, redirect_uri, test_user_id)

            return RedirectResponse(url="/")

        except HTTPException as e:
            raise e
        except Exception as e:
            with log_step("AUTH"):
                logger.error(
                    f"Unhandled error in GET /api/auth/zoom/callback: {e}",
                    exc_info=True,
                )
            raise HTTPException(
                status_code=500, detail="An internal server error occurred"
            )

    return router
