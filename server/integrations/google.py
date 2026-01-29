import json
import logging
import time
import urllib.parse
import uuid
from datetime import timedelta

import core.database as database
import httpx
from core.authentication import decrypt, generate_jwt_token
from core.config import settings
from core.database import SQL_GET_USER_BY_ID, SQL_UPSERT_INTEGRATION, SQL_UPSERT_USER
from core.logging_setup import log_step
from fastapi import HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

LOG_STEP = "INT-GOOGLE"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
SCOPE = "openid email profile https://www.googleapis.com/auth/calendar.readonly"

REDIRECT_PATH = "/api/auth/google/callback"


class GoogleLoginRequest(BaseModel):
    email: str
    language: str


SQL_GET_GOOGLE_CONFIG_BY_DOMAIN = """
SELECT 
    t.tenant_id, 
    ac.client_id, 
    ac.client_secret_encrypted,
    ac.tenant_hint
FROM TENANT_DOMAINS td
JOIN TENANTS t ON td.tenant_id = t.tenant_id
JOIN TENANT_AUTH_CONFIGS ac ON t.tenant_id = ac.tenant_id
WHERE td.domain = $1 AND ac.provider_type = 'google';
"""

SQL_GET_GOOGLE_CONFIG_BY_ID = """
SELECT 
    t.tenant_id, 
    ac.client_id, 
    ac.client_secret_encrypted,
    ac.tenant_hint
FROM TENANTS t
JOIN TENANT_AUTH_CONFIGS ac ON t.tenant_id = ac.tenant_id
WHERE t.tenant_id = $1 AND ac.provider_type = 'google';
"""


async def get_config_for_domain(domain: str) -> dict | None:
    with log_step(LOG_STEP):
        logger.debug(f"Checking DB for Google config for domain: {domain}")
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        try:
            async with database.DB_POOL.acquire() as conn:
                row = await conn.fetchrow(SQL_GET_GOOGLE_CONFIG_BY_DOMAIN, domain)

            if not row:
                logger.warning(f"No Google tenant config found for domain: {domain}")
                return None

            return {
                "customer_id": row["tenant_hint"],
                "client_id": row["client_id"],
                "client_secret": decrypt(row["client_secret_encrypted"]),
                "internal_id": row["tenant_id"],
            }
        except Exception as e:
            logger.error(
                f"Failed to get config for domain {domain}: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500, detail="Error retrieving tenant config."
            )


async def get_config_for_tenant(tenant_id: str) -> dict | None:
    with log_step(LOG_STEP):
        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        try:
            async with database.DB_POOL.acquire() as conn:
                row = await conn.fetchrow(SQL_GET_GOOGLE_CONFIG_BY_ID, tenant_id)

            if not row:
                return None

            return {
                "customer_id": row["tenant_hint"],
                "client_id": row["client_id"],
                "client_secret": decrypt(row["client_secret_encrypted"]),
            }
        except Exception as e:
            logger.error(
                f"Failed to get config for tenant {tenant_id}: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=500, detail="Error retrieving tenant config."
            )


async def get_valid_google_token(user_id: str) -> str | None:
    """
    Retrieves a valid access token for the user, refreshing it if necessary.
    """
    with log_step(LOG_STEP):
        if not database.DB_POOL:
            return None

        async with database.DB_POOL.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, access_token, refresh_token, expires_at FROM INTEGRATIONS WHERE user_id = $1 AND platform = 'google'",
                user_id,
            )

        if not row:
            return None

        integration_id = row["id"]
        access_token = row["access_token"]
        refresh_token = row["refresh_token"]
        expires_at = row["expires_at"] or 0

        if time.time() < (expires_at - 300):
            return access_token

        logger.info(f"Google token for user {user_id} expired. Refreshing...")

        if not refresh_token:
            logger.error(f"No refresh token for integration {integration_id}")
            return None

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

        if not user_row or not user_row.get("email"):
            return None

        domain = user_row["email"].split("@")[1]
        tenant_config = await get_config_for_domain(domain)

        if not tenant_config:
            return None

        data = {
            "client_id": tenant_config["client_id"],
            "client_secret": tenant_config["client_secret"],
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(GOOGLE_TOKEN_URL, data=data)

        if resp.status_code != 200:
            logger.error(f"Failed to refresh Google token: {resp.text}")
            return None

        token_data = resp.json()
        new_access_token = token_data["access_token"]
        new_expires_in = token_data.get("expires_in", 3600)
        new_expires_at = int(time.time()) + new_expires_in

        new_refresh_token = token_data.get("refresh_token", refresh_token)

        async with database.DB_POOL.acquire() as conn:
            await conn.execute(
                """
                UPDATE INTEGRATIONS 
                SET access_token = $1, refresh_token = $2, expires_at = $3
                WHERE id = $4
                """,
                new_access_token,
                new_refresh_token,
                new_expires_at,
                integration_id,
            )

        return new_access_token


async def handle_login(request: GoogleLoginRequest, response: Response) -> dict:
    with log_step(LOG_STEP):
        logger.debug(f"Handling Google login request for: {request.email}")
        try:
            domain = request.email.split("@")[1]
        except IndexError:
            raise HTTPException(status_code=400, detail="Invalid email address.")

        tenant_config = await get_config_for_domain(domain)

        if not tenant_config:
            raise HTTPException(
                status_code=403,
                detail=f"Domain {domain} is not configured for Google Auth.",
            )

        state = str(uuid.uuid4())

        auth_data = {
            "state": state,
            "tenant_id": tenant_config["internal_id"],
            "language": request.language,
        }

        response.set_cookie(
            key="google_auth_state",
            value=json.dumps(auth_data),
            max_age=600,
            httponly=True,
            secure=settings.APP_BASE_URL.startswith("https"),
            samesite="lax",
        )

        redirect_uri = f"{settings.APP_BASE_URL}{REDIRECT_PATH}"

        params = {
            "client_id": tenant_config["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "state": state,
            "access_type": "offline",
            "hd": domain,
        }

        auth_url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
        return {"login_url": auth_url}


async def handle_callback(request: Request) -> RedirectResponse:
    with log_step(LOG_STEP):
        url_state = request.query_params.get("state")
        code = request.query_params.get("code")
        error = request.query_params.get("error")
        cookie_data_str = request.cookies.get("google_auth_state")

        if error:
            raise HTTPException(status_code=400, detail=f"Google Auth Error: {error}")

        if not url_state or not code or not cookie_data_str:
            raise HTTPException(status_code=400, detail="Missing auth data.")

        try:
            cookie_data = json.loads(cookie_data_str)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid auth state.")

        if cookie_data.get("state") != url_state:
            raise HTTPException(status_code=400, detail="Auth state mismatch.")

        tenant_id = cookie_data.get("tenant_id")
        tenant_config = await get_config_for_tenant(tenant_id)

        if not tenant_config:
            raise HTTPException(
                status_code=500, detail="Tenant configuration not found."
            )

        redirect_uri = f"{settings.APP_BASE_URL}{REDIRECT_PATH}"

        token_data = {
            "code": code,
            "client_id": tenant_config["client_id"],
            "client_secret": tenant_config["client_secret"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        async with httpx.AsyncClient() as client:
            token_resp = await client.post(GOOGLE_TOKEN_URL, data=token_data)

        if token_resp.status_code != 200:
            logger.error(f"Google Token Exchange Failed: {token_resp.text}")
            raise HTTPException(
                status_code=400, detail="Failed to retrieve access token."
            )

        tokens = token_resp.json()
        access_token = tokens["access_token"]
        refresh_token = tokens.get("refresh_token")
        expires_at = int(time.time()) + tokens.get("expires_in", 3600)

        async with httpx.AsyncClient() as client:
            user_resp = await client.get(
                GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )

        if user_resp.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to retrieve user profile."
            )

        user_info = user_resp.json()

        user_id = user_info.get("sub")
        email = user_info.get("email")
        name = user_info.get("name")
        language = cookie_data.get("language", "en")

        if not database.DB_POOL:
            raise HTTPException(status_code=503, detail="Database not initialized.")

        async with database.DB_POOL.acquire() as conn:
            await conn.execute(SQL_UPSERT_USER, user_id, name, email, language)

            await conn.execute(
                SQL_UPSERT_INTEGRATION,
                user_id,
                "google",
                user_id,
                access_token,
                refresh_token,
                expires_at,
            )

        app_token = generate_jwt_token(
            user_id=user_id, session_id=None, expires_delta=timedelta(days=90)
        )

        redirect_response = RedirectResponse(url="/")
        is_ssl = settings.APP_BASE_URL.startswith("https")

        redirect_response.set_cookie(
            key="app_auth_token",
            value=app_token,
            max_age=90 * 24 * 60 * 60,
            httponly=True,
            secure=is_ssl,
            samesite="none" if is_ssl else "lax",
        )
        redirect_response.delete_cookie("google_auth_state")

        logger.info(f"Successfully authenticated Google user {email} ({user_id})")
        return redirect_response


async def handle_logout(response: Response, user_payload: dict) -> dict:
    """
    Logs the user out by clearing the auth cookie.
    """
    with log_step(LOG_STEP):
        response.delete_cookie("app_auth_token")
        return {"logout_url": "/"}
