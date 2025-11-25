import logging

import jwt
from core.config import settings
from core.logging_setup import log_step
from fastapi import Depends, Header, WebSocketException, status

logger = logging.getLogger(__name__)


async def get_auth_token_from_header(
    authorization: str | None = Header(None),
) -> str:
    """Extracts the Bearer token from the Authorization header."""
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


def validate_server_token(
    token: str = Depends(get_auth_token_from_header),
) -> dict:
    """
    Validates a server-to-server token from the Express service.
    Uses RS256 with the public key.
    """
    if not settings.ZM_PUBLIC_KEY:
        logger.error("FATAL: ZM_PUBLIC_KEY is not configured on the server!")
        raise WebSocketException(
            code=status.WS_1011_INTERNAL_ERROR, reason="Server configuration error"
        )
    try:
        payload = jwt.decode(
            token,
            settings.ZM_PUBLIC_KEY,
            algorithms=["RS256"],
            issuer="zoom-rtms-service",  # NOTE: This will need to change per integration added
            audience="python-backend",
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
    except jwt.InvalidAudienceError:
        with log_step("SESSION"):
            logger.warning("Auth failed: Invalid token audience.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token audience"
        )
    except jwt.InvalidTokenError as e:
        with log_step("SESSION"):
            logger.warning(f"Auth failed: Invalid token. {e}")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token"
        )
