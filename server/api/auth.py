# /api/auth/login || EntraID login
# /api/auth/logout || EntraID logout
# /api/auth/me || EntraID account
# /api/auth/{integration} || authentication per session


from fastapi import APIRouter, HTTPException
from integrations.zoom import ZoomAuthRequest, ZoomAuthResponse, verify_zoom_credentials
from services.is_authenticated import generate_jwt_token


def create_auth_router() -> APIRouter:
    """
    Creates the REST API router for auth.
    """
    router = APIRouter(
        prefix="/api/auth",
    )

    @router.post("/zoom", response_model=ZoomAuthResponse)
    def handle_zoom_auth(request: ZoomAuthRequest):
        """
        Authenticates a Zoom session.
        Passes the request to the integration-specific logic.
        """
        try:
            meeting_uuid = verify_zoom_credentials(request=request)

            token = generate_jwt_token(session_id=meeting_uuid)

            return ZoomAuthResponse(meetinguuid=meeting_uuid, token=token)

        except HTTPException as e:
            raise e
        except Exception as e:
            raise HTTPException(
                status_code=500, detail="An internal server error occurred."
            )

    return router
