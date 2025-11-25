import logging
from datetime import datetime, timedelta, timezone

import jwt
from core.config import settings
from core.logging_setup import log_step
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Query, Request, WebSocketException, status
from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)


class TokenPayload(BaseModel):
    """Pydantic model for your JWT payload"""

    iss: str
    iat: int
    exp: int
    sub: str
    resource: str | None = None
    aud: str


def generate_jwt_token(session_id: str) -> str:
    """
    Generates a short-lived JWT for a viewing session. (HS256)
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
        "sub": "anonymous",  # TODO: Change per user with Entra
        "resource": session_id,
        "aud": "web-desktop-client",
    }

    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    return token


async def get_token_from_cookie(request: Request) -> str:
    """Extracts the auth token from the 'app_auth_token' cookie."""
    token = request.cookies.get("app_auth_token")
    if not token:
        with log_step("SESSION"):
            logger.warning("Auth failed: No 'app_auth_token' cookie.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return token


def get_current_user_payload(
    token: str = Depends(get_token_from_cookie),
) -> dict:
    """
    Validates a client-to-server token from the web browser cookie.
    Uses HS256 with the client secret.
    """
    if not settings.JWT_SECRET_KEY:
        logger.error("FATAL: JWT_SECRET_KEY is not configured on the server!")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server configuration error",
        )
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
            issuer="calc-translation-service",
            audience="web-desktop-client",
        )
        TokenPayload(**payload)
        return payload
    except jwt.ExpiredSignatureError:
        with log_step("SESSION"):
            logger.warning("Auth failed: Token has expired.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired"
        )
    except (
        jwt.InvalidIssuerError,
        jwt.InvalidAudienceError,
        jwt.InvalidTokenError,
        ValidationError,
    ) as e:
        with log_step("SESSION"):
            logger.warning(f"Auth failed: Invalid token. {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )


def validate_client_token(token: str = Query()) -> dict:
    """
    Validates a client-to-server token from the web browser (query param).
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


try:
    _cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())
except Exception as e:
    logger.error(f"Failed to initialize Fernet cipher: {e}. Is ENCRYPTION_KEY valid?")
    raise


def encrypt(plaintext: str) -> str:
    """
    Encrypts a plaintext string.
    """
    try:
        token = _cipher_suite.encrypt(plaintext.encode())
        return token.decode()
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise


def decrypt(ciphertext: str) -> str:
    """
    Decrypts a ciphertext string.
    """
    try:
        decrypted_bytes = _cipher_suite.decrypt(ciphertext.encode())
        return decrypted_bytes.decode()
    except InvalidToken:
        logger.error("Decryption failed: Invalid token or key.")
        raise HTTPException(status_code=500, detail="Internal configuration error.")
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise
