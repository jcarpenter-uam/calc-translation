# /api/auth/login || EntraID login
# /api/auth/logout || EntraID logout
# /api/auth/me || EntraID account
# /api/auth/{integration} || authentication per session

import logging

from core.logging_setup import log_step
from core.security import generate_jwt_token
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from integrations.zoom import (
    ZoomAuthRequest,
    ZoomAuthResponse,
    exchange_code_for_token,
    verify_zoom_credentials,
)

logger = logging.getLogger(__name__)


def create_auth_router() -> APIRouter:
    """
    Creates the REST API router for auth.
    """
    router = APIRouter(
        prefix="/api/auth",
    )

    @router.post("/zoom", response_model=ZoomAuthResponse)
    async def handle_zoom_auth(request: ZoomAuthRequest):
        """
        Authenticates a Zoom session.
        Passes the request to the integration-specific logic.
        """
        try:
            meeting_uuid = await verify_zoom_credentials(request=request)

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

        try:
            redirect_uri = str(request.url).split("?")[0]

            await exchange_code_for_token(code, redirect_uri)

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
