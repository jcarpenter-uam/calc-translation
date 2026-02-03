import logging
from datetime import datetime, timedelta, timezone

import core.database as database
import jwt
from core.config import settings
from core.database import SQL_GET_USER_BY_ID
from core.logging_setup import log_step
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Query, Request, WebSocketException, status
from pydantic import BaseModel, ValidationError
from starlette.requests import HTTPConnection

logger = logging.getLogger(__name__)

LOG_STEP = "AUTHENTICATION"


class TokenPayload(BaseModel):
    """Pydantic model for your JWT payload"""

    iss: str
    iat: int
    exp: int
    sub: str
    resource: str | None = None
    aud: str


def generate_jwt_token(
    user_id: str, session_id: str | None = None, expires_delta: timedelta | None = None
) -> str:
    """
    Generates a short-lived JWT for a viewing session. (HS256)
    - If session_id is None, it's a main user auth token.
    - If session_id is provided, it's a session auth token.
    """
    now = datetime.now(timezone.utc)

    if expires_delta is None:
        expires_delta = timedelta(hours=3)  # 3 Hours

    payload = {
        "iss": "calc-translation-service",
        "iat": now,
        "exp": now + expires_delta,
        "sub": user_id,
        "resource": session_id,
        "aud": "web-desktop-client",
    }

    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    return token


async def get_token_from_cookie(request: HTTPConnection) -> str:
    """Extracts the auth token from the 'app_auth_token' cookie."""
    token = request.cookies.get("app_auth_token")
    if not token:
        with log_step(LOG_STEP):
            logger.debug(
                "Client Auth failed: No 'app_auth_token' cookie found in request."
            )
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
        unverified_payload = jwt.decode(token, options={"verify_signature": False})
        user_id = unverified_payload.get("sub", "Unknown")

        with log_step(LOG_STEP):
            logger.warning(
                f"Client Auth failed: HTTP Token has expired. User: {user_id}"
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired"
        )
    except (
        jwt.InvalidIssuerError,
        jwt.InvalidAudienceError,
        jwt.InvalidTokenError,
        ValidationError,
    ) as e:
        with log_step(LOG_STEP):
            logger.warning(f"Client Auth failed: Invalid token. {e}")
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
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
            issuer="calc-translation-service",
            audience="web-desktop-client",
        )
        if not payload.get("resource"):
            with log_step(LOG_STEP):
                logger.warning(
                    "Client Auth failed: WebSocket token is missing 'resource' claim."
                )
            raise WebSocketException(
                code=status.WS_1008_POLICY_VIOLATION, reason="Invalid session token"
            )

        return payload
    except jwt.ExpiredSignatureError:
        unverified_payload = jwt.decode(token, options={"verify_signature": False})
        user_id = unverified_payload.get("sub", "Unknown")
        session_id = unverified_payload.get("resource", "Unknown")
        with log_step(LOG_STEP):
            logger.warning(
                f"Client Auth failed: WS Token has expired. User: {user_id}, Session: {session_id}"
            )
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Token has expired"
        )
    except jwt.InvalidIssuerError:
        with log_step(LOG_STEP):
            logger.warning("Client Auth failed: Invalid token issuer.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token issuer"
        )
    except jwt.InvalidAudienceError:
        with log_step(LOG_STEP):
            logger.warning("Client Auth failed: Invalid token audience.")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token audience"
        )
    except jwt.InvalidTokenError as e:
        with log_step(LOG_STEP):
            logger.warning(f"Client Auth failed: Invalid token. {e}")
        raise WebSocketException(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token"
        )


try:
    _cipher_suite = Fernet(settings.ENCRYPTION_KEY.encode())
except Exception as e:
    with log_step(LOG_STEP):
        logger.error(
            f"Failed to initialize Fernet cipher: {e}. Is ENCRYPTION_KEY valid?"
        )
        raise


def encrypt(plaintext: str) -> str:
    """
    Encrypts a plaintext string.
    """
    try:
        token = _cipher_suite.encrypt(plaintext.encode())
        return token.decode()
    except Exception as e:
        with log_step(LOG_STEP):
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
        with log_step(LOG_STEP):
            logger.error("Decryption failed: Invalid token or key.")
            raise HTTPException(status_code=500, detail="Internal configuration error.")
    except Exception as e:
        with log_step(LOG_STEP):
            logger.error(f"Decryption failed: {e}")
            raise


async def get_admin_user_payload(
    payload: dict = Depends(get_current_user_payload),
) -> dict:
    """
    Dependency that checks if the current authenticated user is an admin.
    Raises 403 Forbidden if not.
    """
    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid auth token payload")

    if not database.DB_POOL:
        with log_step(LOG_STEP):
            logger.error("Admin check failed: Database not initialized.")
            raise HTTPException(status_code=503, detail="Database not initialized.")

    async with database.DB_POOL.acquire() as conn:
        user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

    if not user_row:
        with log_step(LOG_STEP):
            logger.error(f"Authenticated admin user {user_id} not found in DB.")
            raise HTTPException(status_code=401, detail="User not found.")

    if not user_row.get("is_admin"):
        with log_step(LOG_STEP):
            logger.warning(f"User {user_id} attempted unauthorized admin access.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Requires admin privileges",
        )

    return payload
