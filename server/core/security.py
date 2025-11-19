# NOTE: Test that after authenticating with a given zoom meeting,
# The user cannot access other zoom meetings with the same JWT

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
        "aud": "web-desktop-client",
    }

    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    return token


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
            issuer="zoom-rtms-service",
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


def validate_client_token(token: str = Query()) -> dict:
    """
    Validates a client-to-server token from the web browser.
    Uses HS256 with the client secret.
    """
    if not token:
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing auth token"
        )
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
            issuer="calc-translation-service",
            audience="web-desktop-client",
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
