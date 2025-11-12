# TODO: Currently the view endpoints are unprotected, this is soon to change
# Emplementing zoom meeting pass and session code along with Entra ID to secure access

import logging
import os

from core.logging_setup import log_step
from fastapi import Depends, Header, WebSocketException, status

logger = logging.getLogger(__name__)

try:
    APP_SECRET_TOKEN = os.environ["SECRET_TOKEN"]
    with log_step("SYSTEM"):
        logger.debug("Successfully loaded 'SECRET_TOKEN'.")
except KeyError:
    logging.critical(
        "[SYSTEM] FATAL: 'SECRET_TOKEN' environment variable is not set. Application cannot start."
    )
    raise RuntimeError("Required environment variable 'SECRET_TOKEN' is not set.")


async def get_auth_token(
    authorization: str | None = Header(None),
) -> str:
    """
    Extracts the Bearer token from the Authorization header.
    """
    if not authorization:
        with log_step("SESSION"):
            logger.warning("Auth failed: No Authorization header.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing Authorization header"
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0] != "Bearer":
        with log_step("SESSION"):
            logger.warning("Auth failed: Invalid header format.")
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
        with log_step("SESSION"):
            logger.warning("Auth failed: Invalid token.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token"
        )

    return True
