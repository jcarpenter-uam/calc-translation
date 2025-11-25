import json
import logging
import uuid

import core.database as database
import msal
from auth.encryption import decrypt
from core.config import settings
from core.database import (
    SQL_GET_TENANT_AUTH_BY_ID,
    SQL_GET_TENANT_BY_DOMAIN,
    SQL_UPSERT_USER,
)
from core.security import generate_jwt_token
from fastapi import HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class EntraLoginRequest(BaseModel):
    email: str


REDIRECT_PATH = "/api/auth/entra/callback"
SCOPE = ["User.Read"]


async def get_config_for_domain(domain: str) -> dict | None:
    logger.info(f"Checking DB for config for domain: {domain}")
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    try:
        async with database.DB_POOL.acquire() as conn:
            row = await conn.fetchrow(SQL_GET_TENANT_BY_DOMAIN, domain)

        if not row:
            return None

        return {
            "tenant_id": row["tenant_id"],
            "client_id": row["client_id"],
            "client_secret": decrypt(row["client_secret_encrypted"]),
        }
    except Exception as e:
        logger.error(f"Failed to get config for domain {domain}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error retrieving tenant config.")


async def get_config_for_tenant(tenant_id: str) -> dict | None:
    logger.info(f"Checking DB for config for tenant_id: {tenant_id}")
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    try:
        async with database.DB_POOL.acquire() as conn:
            row = await conn.fetchrow(SQL_GET_TENANT_AUTH_BY_ID, tenant_id)

        if not row:
            return None

        return {
            "tenant_id": row["tenant_id"],
            "client_id": row["client_id"],
            "client_secret": decrypt(row["client_secret_encrypted"]),
        }
    except Exception as e:
        logger.error(f"Failed to get config for tenant {tenant_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Error retrieving tenant config.")


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


async def handle_login(
    request: EntraLoginRequest, response: Response
) -> RedirectResponse:
    try:
        domain = request.email.split("@")[1]
    except IndexError:
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
    auth_data = {"state": state, "tenant_id": tenant_config["tenant_id"]}

    response.set_cookie(
        key="entra_auth_state",
        value=json.dumps(auth_data),
        max_age=600,
        httponly=True,
        secure=settings.APP_BASE_URL.startswith("https"),
        samesite="lax",
    )
    auth_url = _build_auth_url(tenant_config, state)
    return {"login_url": auth_url}


async def handle_callback(request: Request) -> RedirectResponse:
    url_state = request.query_params.get("state")
    code = request.query_params.get("code")
    cookie_data_str = request.cookies.get("entra_auth_state")

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
        logger.error(f"Could not find config for tenant_id {tenant_id} from cookie.")
        raise HTTPException(status_code=500, detail="Tenant configuration not found.")

    token_response = _get_token_from_code(tenant_config, code)

    if "error" in token_response:
        logger.warning(f"MSAL error: {token_response['error_description']}")
        raise HTTPException(
            status_code=400,
            detail=f"Token error: {token_response.get('error_description')}",
        )

    claims = token_response.get("id_token_claims", {})

    session_id = claims.get("oid")
    user_email = claims.get("preferred_username")
    user_name = claims.get("name")

    if not session_id:
        logger.error("Could not find 'oid' (Object ID) in token claims.")
        raise HTTPException(status_code=400, detail="Could not identify user.")

    if not database.DB_POOL:
        logger.error("Database pool not available to save user.")
        raise HTTPException(status_code=503, detail="Database not initialized.")

    try:
        async with database.DB_POOL.acquire() as conn:
            await conn.execute(SQL_UPSERT_USER, session_id, user_name, user_email)
        logger.info(f"Upserted user: {user_email} (OID: {session_id})")
    except Exception as e:
        logger.error(f"Failed to upsert user {session_id}: {e}", exc_info=True)

    app_token = generate_jwt_token(session_id=session_id)

    redirect_response = RedirectResponse(url="/")

    redirect_response.set_cookie(
        key="app_auth_token",
        value=app_token,
        max_age=60 * 60,
        httponly=True,
        secure=False,
        samesite="lax",
    )

    redirect_response.delete_cookie("entra_auth_state")

    return redirect_response


async def handle_logout(response: Response) -> dict:
    logger.info("Handling user logout.")
    response.delete_cookie("app_auth_token")
    post_logout_url = f"{settings.APP_BASE_URL}/"
    logout_url = (
        f"https://login.microsoftonline.com/common/oauth2/v2.0/logout"
        f"?post_logout_redirect_uri={post_logout_url}"
    )
    return {"logout_url": logout_url}
