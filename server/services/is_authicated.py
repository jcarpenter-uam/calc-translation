import logging

import jwt
from core.config import settings
from core.logging_setup import log_step
from fastapi import Depends, Header, WebSocketException, status

logger = logging.getLogger(__name__)


async def get_auth_token(
    authorization: str | None = Header(None),
) -> str:
    """
    Extracts the Bearer token from the Authorization header.
    (This function is unchanged and correct.)
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
    2. UPDATED: Validates the extracted JWT token.
    Checks the signature and expiration time.
    """

    if not settings.JWT_SECRET_KEY:
        logger.error("FATAL: JWT_SECRET_KEY is not configured on the server!")
        raise WebSocketException(
            code=status.WS_1011_INTERNAL_ERROR, reason="Server configuration error"
        )

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
            issuer="zoom-rtms-service",
        )

        return payload

    except jwt.ExpiredSignatureError:
        with log_step("SESSION"):
            logger.warning("Auth failed: Token has expired.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Token has expired"
        )
    except jwt.InvalidIssuerError:
        with log_step("SESSION"):
            logger.warning("Auth failed: Invalid token issuer.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token issuer"
        )
    except jwt.InvalidTokenError as e:
        with log_step("SESSION"):
            logger.warning(f"Auth failed: Invalid token. {e}")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token"
        )
