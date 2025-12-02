import logging

from core.authentication import generate_jwt_token, get_current_user_payload
from core.config import settings
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from integrations.zoom import (
    ZoomAuthRequest,
    ZoomAuthResponse,
    authenticate_zoom_session,
    exchange_code_for_token,
)
from pydantic import BaseModel

from integrations import entra

logger = logging.getLogger(__name__)


class UserResponse(BaseModel):
    id: str
    name: str | None
    email: str | None


def create_auth_router() -> APIRouter:
    """
    Creates the REST API router for auth.
    """
    router = APIRouter(
        prefix="/api/auth",
    )

    @router.post("/login")
    async def entra_login(request: entra.EntraLoginRequest, response: Response):
        """
        Handles the first step of Entra ID login.
        Expects an email and returns a redirect to Microsoft.
        """
        return await entra.handle_login(request, response)

    @router.get("/entra/callback")
    async def entra_callback(request: Request):
        """
        Handles the OAuth redirect from Microsoft Entra ID.
        Exchanges code for token and sets an auth cookie.
        """
        return await entra.handle_callback(request)

    @router.post("/logout")
    async def entra_logout(
        response: Response,
        user_payload: dict = Depends(get_current_user_payload),
    ):
        """
        Logs the user out by clearing the auth cookie and
        providing a Microsoft logout URL.
        """
        return await entra.handle_logout(response, user_payload)

    @router.post("/zoom", response_model=ZoomAuthResponse)
    async def handle_zoom_auth(
        request: ZoomAuthRequest,
        user_payload: dict = Depends(get_current_user_payload),
    ):
        """
        Authenticates a Zoom session.
        Requires user to be logged in with Entra.
        """
        try:
            if not request.join_url and not request.meetingid:
                raise HTTPException(
                    status_code=400,
                    detail="Either 'join_url' or 'meetingid' must be provided.",
                )

            user_id = user_payload.get("sub")

            session_id = await authenticate_zoom_session(request=request)

            token = generate_jwt_token(user_id=user_id, session_id=session_id)
            return ZoomAuthResponse(meetinguuid=session_id, token=token)

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
    async def handle_zoom_callback(
        request: Request,
        user_payload: dict = Depends(get_current_user_payload),
    ):
        """
        Handles the OAuth redirect from Zoom.
        Requires user to be logged in with Entra to link accounts.
        """
        code = request.query_params.get("code")
        if not code:
            raise HTTPException(
                status_code=400, detail="Missing authorization code from Zoom"
            )

        user_id = user_payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid user token")

        try:
            redirect_uri = f"{settings.APP_BASE_URL}/api/auth/zoom/callback"

            await exchange_code_for_token(code, redirect_uri, user_id)

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
