from fastapi import HTTPException
from pydantic import BaseModel


class ZoomAuthRequest(BaseModel):
    """Matches the JSON body from the frontend"""

    meetingid: str
    meetingpass: str | None = None


class ZoomAuthResponse(BaseModel):
    """Matches the JSON response the frontend expects"""

    meetinguuid: str
    token: str


# TODO: REPLACE
# --- Hardcoded Credentials ---
VALID_MEETING_ID = "80012345678"
VALID_PASSCODE = ""
VALID_UUID = "test"


def verify_zoom_credentials(request: ZoomAuthRequest) -> str:
    """
    Checks the meeting ID and passcode against hardcoded variables.

    - Receives: The ZoomAuthRequest Pydantic model
    - Returns: The 'meeting_uuid' (str) if valid.
    - Raises: HTTPException if invalid.
    """

    normalized_id = request.meetingid.replace(" ", "")

    if normalized_id != VALID_MEETING_ID:
        raise HTTPException(status_code=404, detail="Meeting ID not found")

    if request.meetingpass != VALID_PASSCODE:
        raise HTTPException(status_code=401, detail="Invalid Passcode")

    return VALID_UUID
