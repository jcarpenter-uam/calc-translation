import os

from fastapi import Depends, Header, WebSocketException, status

from .debug_service import log_pipeline_step

try:
    APP_SECRET_TOKEN = os.environ["WS_TRANSCRIBE_SECRET_TOKEN"]
    log_pipeline_step(
        "SYSTEM", f"Successfully loaded 'WS_TRANSCRIBE_SECRET_TOKEN'.", detailed=True
    )
except KeyError:
    log_pipeline_step(
        "SYSTEM",
        "FATAL: 'WS_TRANSCRIBE_SECRET_TOKEN' environment variable is not set. Application cannot start.",
        detailed=False,
    )
    raise RuntimeError(
        "Required environment variable 'WS_TRANSCRIBE_SECRET_TOKEN' is not set."
    )


async def get_auth_token(
    authorization: str | None = Header(None),
) -> str:
    """
    Extracts the Bearer token from the Authorization header.
    """
    if not authorization:
        log_pipeline_step(
            "SESSION", "Auth failed: No Authorization header.", detailed=False
        )
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing Authorization header"
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer":
        log_pipeline_step(
            "SESSION", "Auth failed: Invalid header format.", detailed=False
        )
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Invalid Authorization header format. Expected 'Bearer <token>'",
        )

    return parts[1]


async def validate_token(token: str = Depends(get_auth_token)):
    """
    Validates the extracted token.
    For this simple case, we just check our shared secret.
    """
    if token != APP_SECRET_TOKEN:
        log_pipeline_step("SESSION", "Auth failed: Invalid token.", detailed=False)
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token"
        )

    return True
