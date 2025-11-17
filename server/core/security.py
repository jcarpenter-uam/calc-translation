import logging
from datetime import datetime, timedelta, timezone

import jwt
from core.config import settings
from core.logging_setup import log_step
from fastapi import Depends, Header, HTTPException, Query, WebSocketException, status

logger = logging.getLogger(__name__)


def generate_jwt_token(session_id: str) -> str:
    """
    Generates a short-lived JWT for a viewing session.
    """
    if not settings.JWT_SECRET_KEY:
        logger.error("FATAL: JWT_SECRET_KEY is not configured on the server!")
        raise HTTPException(status_code=500, detail="Server configuration error")

    now = datetime.now(timezone.utc)
    expires_delta = timedelta(hours=1)

    payload = {
        "iss": "calc-translation-service",
        "iat": now,
        "exp": now + expires_delta,
        "sub": "anonymous",  # NOTE: Will get fixed after EntraID
        "resource": session_id,
    }

    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    return token


def decode_jwt_payload(token: str) -> dict:
    """
    Decodes and validates a JWT token.
    Returns the payload on success, raises WebSocketException on failure.
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


async def validate_token_http(token: str = Depends(get_auth_token_from_header)) -> dict:
    """
    Validates a token from an HTTP header.
    Returns the decoded payload.
    """
    return decode_jwt_payload(token)


async def validate_token_ws(token: str = Query()) -> dict:
    """
    Dependency to validate a token from a WebSocket query parameter.
    Returns the decoded payload.
    """
    if not token:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing auth token"
        )
    return decode_jwt_payload(token)
