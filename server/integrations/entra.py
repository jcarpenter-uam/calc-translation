import json
import logging
import time
import uuid
from datetime import timedelta

import core.database as database
import msal
from core.authentication import decrypt, generate_jwt_token
from core.config import settings
from core.database import SQL_GET_USER_BY_ID, SQL_UPSERT_INTEGRATION, SQL_UPSERT_USER
from core.logging_setup import log_step
from fastapi import HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

LOG_STEP = "INT-ENTRA"


class EntraLoginRequest(BaseModel):
    email: str
    language: str


REDIRECT_PATH = "/api/auth/entra/callback"
SCOPE = ["User.Read", "Calendars.Read"]


SQL_GET_ENTRA_CONFIG_BY_DOMAIN = """
SELECT 
    t.tenant_id, 
    ac.client_id, 
    ac.client_secret_encrypted,
    ac.tenant_hint
FROM TENANT_DOMAINS td
JOIN TENANTS t ON td.tenant_id = t.tenant_id
JOIN TENANT_AUTH_CONFIGS ac ON t.tenant_id = ac.tenant_id
WHERE td.domain = $1 AND ac.provider_type = 'microsoft';
"""

SQL_GET_ENTRA_CONFIG_BY_ID = """
SELECT 
    t.tenant_id, 
    ac.client_id, 
    ac.client_secret_encrypted,
    ac.tenant_hint
FROM TENANTS t
JOIN TENANT_AUTH_CONFIGS ac ON t.tenant_id = ac.tenant_id
WHERE t.tenant_id = $1 AND ac.provider_type = 'microsoft';
"""


async def get_config_for_domain(domain: str) -> dict | None:
    with log_step(LOG_STEP):
        logger.debug(f"Checking DB for Entra config for domain: {domain}")
        if not database.DB_POOL:
            logger.error("Database not initialized during get_config_for_domain.")
            raise HTTPException(status_code=503, detail="Database not initialized.")

        try:
            async with database.DB_POOL.acquire() as conn:
                row = await conn.fetchrow(SQL_GET_ENTRA_CONFIG_BY_DOMAIN, domain)

            if not row:
                logger.warning(f"No Entra tenant config found for domain: {domain}")
                return None

            logger.debug(f"Found Entra config for domain: {domain}")
            return {
                "tenant_id": row["tenant_hint"],
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
        logger.debug(f"Checking DB for config for tenant_id: {tenant_id}")
        if not database.DB_POOL:
            logger.error("Database not initialized during get_config_for_tenant.")
            raise HTTPException(status_code=503, detail="Database not initialized.")

        try:
            async with database.DB_POOL.acquire() as conn:
                row = await conn.fetchrow(SQL_GET_ENTRA_CONFIG_BY_ID, tenant_id)

            if not row:
                logger.warning(f"No Entra config found for tenant_id: {tenant_id}")
                return None

            logger.debug(f"Found config for tenant_id: {tenant_id}")
            return {
                "tenant_id": row["tenant_hint"],
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


def _build_msal_app(tenant_config: dict) -> msal.ConfidentialClientApplication:
    authority = f"https://login.microsoftonline.com/{tenant_config['tenant_id']}"
    return msal.ConfidentialClientApplication(
        tenant_config["client_id"],
        authority=authority,
        client_credential=tenant_config["client_secret"],
    )


def _build_auth_url(tenant_config: dict, state: str) -> str:
    app = _build_msal_app(tenant_config)
    redirect_uri = f"{settings.APP_BASE_URL}{REDIRECT_PATH}"

    return app.get_authorization_request_url(
        SCOPE, state=state, redirect_uri=redirect_uri
    )


def _get_token_from_code(tenant_config: dict, code: str) -> dict:
    app = _build_msal_app(tenant_config)
    redirect_uri = f"{settings.APP_BASE_URL}{REDIRECT_PATH}"

    return app.acquire_token_by_authorization_code(
        code, scopes=SCOPE, redirect_uri=redirect_uri
    )


async def get_valid_microsoft_token(user_id: str) -> str | None:
    with log_step(LOG_STEP):
        if not database.DB_POOL:
            logger.error("Database not initialized.")
            return None

        async with database.DB_POOL.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, access_token, refresh_token, expires_at, platform_user_id FROM INTEGRATIONS WHERE user_id = $1 AND platform = 'microsoft'",
                user_id,
            )

        if not row:
            logger.warning(f"No Microsoft integration found for user {user_id}")
            return None

        integration_id = row["id"]
        access_token = row["access_token"]
        refresh_token = row["refresh_token"]
        expires_at = row["expires_at"] or 0

        if time.time() < (expires_at - 300):
            return access_token

        logger.info(f"Microsoft token for user {user_id} expired. Refreshing...")

        if not refresh_token:
            logger.error(f"No refresh token for integration {integration_id}")
            return None

        async with database.DB_POOL.acquire() as conn:
            user_row = await conn.fetchrow(SQL_GET_USER_BY_ID, user_id)

        if not user_row or not user_row.get("email"):
            logger.error(
                f"User {user_id} not found or has no email. Cannot refresh token."
            )
            return None

        try:
            domain = user_row["email"].split("@")[1]
            tenant_config = await get_config_for_domain(domain)
        except Exception as e:
            logger.error(f"Failed to determine domain/config for user {user_id}: {e}")
            return None

        if not tenant_config:
            logger.error(f"No tenant config found for domain {domain}")
            return None

        app = _build_msal_app(tenant_config)
        result = app.acquire_token_by_refresh_token(refresh_token, scopes=SCOPE)

        if "error" in result:
            logger.error(f"MSAL Refresh Error: {result.get('error_description')}")
            return None

        new_access_token = result.get("access_token")
        new_refresh_token = result.get("refresh_token")
        new_expires_in = result.get("expires_in", 3600)
        new_expires_at = int(time.time()) + new_expires_in

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

        logger.info(f"Successfully refreshed Microsoft token for user {user_id}")
        return new_access_token


async def handle_login(
    request: EntraLoginRequest, response: Response
) -> RedirectResponse:
    with log_step(LOG_STEP):
        logger.debug(f"Handling Entra login request for email: {request.email}")
        try:
            domain = request.email.split("@")[1]
        except IndexError:
            logger.warning(f"Invalid email address provided: {request.email}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid email address provided.",
            )

        tenant_config = await get_config_for_domain(domain)

        if not tenant_config:
            logger.warning(f"Login attempt from unconfigured domain: {domain}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your organization's domain ({domain}) is not configured.",
            )

        state = str(uuid.uuid4())

        auth_data = {
            "state": state,
            "tenant_id": tenant_config.get("internal_id") or tenant_config["tenant_id"],
            "language": request.language,
        }

        response.set_cookie(
            key="entra_auth_state",
            value=json.dumps(auth_data),
            max_age=600,
            httponly=True,
            secure=settings.APP_BASE_URL.startswith("https"),
            samesite="lax",
        )
        auth_url = _build_auth_url(tenant_config, state)
        logger.debug(f"Redirecting user from domain {domain} to auth URL.")
        return {"login_url": auth_url}


async def handle_callback(request: Request) -> RedirectResponse:
    with log_step(LOG_STEP):
        url_state = request.query_params.get("state")
        code = request.query_params.get("code")
        cookie_data_str = request.cookies.get("entra_auth_state")

        if not url_state or not code or not cookie_data_str:
            logger.warning("Callback missing auth data (state, code, or cookie).")
            raise HTTPException(status_code=400, detail="Missing auth data.")
        try:
            cookie_data = json.loads(cookie_data_str)
        except json.JSONDecodeError:
            logger.warning("Invalid auth state cookie (JSON decode error).")
            raise HTTPException(status_code=400, detail="Invalid auth state.")
        if cookie_data.get("state") != url_state:
            logger.warning("Auth state mismatch.")
            raise HTTPException(status_code=400, detail="Auth state mismatch.")

        tenant_id = cookie_data.get("tenant_id")

        tenant_config = await get_config_for_tenant(tenant_id)
        if not tenant_config:
            logger.error(
                f"Could not find config for tenant_id {tenant_id} from cookie."
            )
            raise HTTPException(
                status_code=500, detail="Tenant configuration not found."
            )

        token_response = _get_token_from_code(tenant_config, code)

        if "error" in token_response:
            logger.warning(f"MSAL error: {token_response['error_description']}")
            raise HTTPException(
                status_code=400,
                detail=f"Token error: {token_response.get('error_description')}",
            )

        claims = token_response.get("id_token_claims", {})

        user_id = claims.get("oid")
        user_email = claims.get("preferred_username")
        user_name = claims.get("name")

        if not user_id:
            logger.error("Could not find 'oid' (Object ID) in token claims.")
            raise HTTPException(status_code=400, detail="Could not identify user.")

        if not database.DB_POOL:
            logger.error("Database pool not available to save user.")
            raise HTTPException(status_code=503, detail="Database not initialized.")

        user_language = cookie_data.get("language")

        try:
            async with database.DB_POOL.acquire() as conn:
                await conn.execute(
                    SQL_UPSERT_USER, user_id, user_name, user_email, user_language
                )
            logger.debug(f"Upserted user: {user_email} (OID: {user_id})")
        except Exception as e:
            logger.error(f"Failed to upsert user {user_id}: {e}", exc_info=True)

        access_token = token_response.get("access_token")
        refresh_token = token_response.get("refresh_token")
        expires_in = token_response.get("expires_in", 3599)
        expires_at = int(time.time()) + expires_in

        try:
            async with database.DB_POOL.acquire() as conn:
                await conn.execute(
                    SQL_UPSERT_INTEGRATION,
                    user_id,
                    "microsoft",
                    user_id,
                    access_token,
                    refresh_token,
                    expires_at,
                )
            logger.debug(f"Stored Microsoft tokens for user {user_id}")
        except Exception as e:
            logger.error(f"Failed to store Microsoft tokens: {e}")

        app_token = generate_jwt_token(
            user_id=user_id, session_id=None, expires_delta=timedelta(days=90)
        )

        redirect_response = RedirectResponse(url="/")

        is_production_ssl = settings.APP_BASE_URL.startswith("https")

        samesite_policy = "none" if is_production_ssl else "lax"
        secure_policy = is_production_ssl

        redirect_response.set_cookie(
            key="app_auth_token",
            value=app_token,
            max_age=90 * 24 * 60 * 60,  # 90 Days
            httponly=True,
            secure=secure_policy,
            samesite=samesite_policy,
        )

        redirect_response.delete_cookie("entra_auth_state")

        logger.info(f"Successfully authenticated user {user_id} ({user_email}).")
        return redirect_response


async def handle_logout(response: Response, user_payload: dict) -> dict:
    """
    Logs the user out by clearing the auth cookie and
    providing a Microsoft logout URL.
    """
    with log_step(LOG_STEP):
        user_id = user_payload.get("sub", "unknown")
        logger.info(f"Handling user logout for user: {user_id}.")

        response.delete_cookie("app_auth_token")

        post_logout_url = f"{settings.APP_BASE_URL}/"

        logout_url = (
            f"https://login.microsoftonline.com/common/oauth2/v2.0/logout"
            f"?post_logout_redirect_uri={post_logout_url}"
        )

        return {"logout_url": logout_url}
