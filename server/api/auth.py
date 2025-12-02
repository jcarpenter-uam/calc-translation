import logging
from typing import Optional

from core.authentication import generate_jwt_token, get_current_user_payload
from core.config import settings
from core.logging_setup import log_step
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
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
        response: Response,
    ):
        """
        Handles the OAuth redirect from Zoom.
        If user is logged in, links accounts.
        If user is logged out, stashes code in a cookie and redirects to login.
        """
        code = request.query_params.get("code")
        if not code:
            raise HTTPException(
                status_code=400, detail="Missing authorization code from Zoom"
            )

        user_id: str | None = None
        try:
            user_payload = await get_current_user_payload(request)
            user_id = user_payload.get("sub")
        except HTTPException as e:
            if e.status_code in (401, 403):
                pass
            else:
                raise e

        try:
            if user_id:
                with log_step("AUTH"):
                    logger.info(f"Linking Zoom account for logged-in user {user_id}")
                redirect_uri = f"{settings.APP_BASE_URL}/api/auth/zoom/callback"
                await exchange_code_for_token(code, redirect_uri, user_id)
                return RedirectResponse(url="/")
            else:
                with log_step("AUTH"):
                    logger.info("Stashing Zoom code for logged-out user.")

                redirect_response = RedirectResponse(
                    url="/login?reason=zoom_link_required"
                )

                redirect_response.set_cookie(
                    key="zoom_oauth_pending_code",
                    value=code,
                    max_age=600,  # 10 minutes
                    httponly=True,
                    secure=settings.APP_BASE_URL.startswith("https"),
                    samesite="lax",
                )

                return redirect_response

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

    @router.post("/zoom/link-pending")
    async def link_pending_zoom_account(
        response: Response,
        user_payload: dict = Depends(get_current_user_payload),
        pending_code: Optional[str] = Cookie(None, alias="zoom_oauth_pending_code"),
    ):
        """
        Called by the frontend after login if a pending Zoom code is found.
        Links the stashed Zoom code to the now-authenticated user.
        """
        user_id = user_payload.get("sub")
        if not pending_code:
            logger.warning(
                f"User {user_id} called /link-pending but no cookie was found."
            )
            return {"status": "no_code_found"}

        try:
            with log_step("AUTH"):
                logger.info(f"Found pending Zoom code. Linking to user {user_id}...")

            redirect_uri = f"{settings.APP_BASE_URL}/api/auth/zoom/callback"
            await exchange_code_for_token(pending_code, redirect_uri, user_id)

            response.set_cookie(
                key="zoom_oauth_pending_code", value="", max_age=-1, httponly=True
            )
            logger.info(f"Successfully linked pending Zoom account for user {user_id}")
            return {"status": "success"}

        except HTTPException as e:
            logger.error(
                f"Failed to link pending Zoom code for user {user_id}: {e.detail}"
            )
            response.set_cookie(
                key="zoom_oauth_pending_code", value="", max_age=-1, httponly=True
            )
            raise e
        except Exception as e:
            logger.error(
                f"Unhandled error linking pending Zoom code for {user_id}",
                exc_info=True,
            )
            raise HTTPException(
                status_code=500, detail="An internal error occurred while linking Zoom"
            )

    return router
