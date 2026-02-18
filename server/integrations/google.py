import json
import logging
import time
import urllib.parse
import uuid
from datetime import timedelta

from core.authentication import decrypt, generate_jwt_token
from core.config import settings
from core.db import AsyncSessionLocal
from core.http_client import get_http_client
from core.logging_setup import log_step
from fastapi import HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from models.integrations import Integration
from models.tenants import Tenant, TenantAuthConfig, TenantDomain
from models.users import User
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

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


async def get_config_for_domain(domain: str) -> dict | None:
    with log_step(LOG_STEP):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(
                    Tenant.tenant_id,
                    TenantAuthConfig.client_id,
                    TenantAuthConfig.client_secret_encrypted,
                    TenantAuthConfig.tenant_hint,
                )
                .join(TenantDomain, TenantDomain.tenant_id == Tenant.tenant_id)
                .join(TenantAuthConfig, TenantAuthConfig.tenant_id == Tenant.tenant_id)
                .where(
                    TenantDomain.domain == domain,
                    TenantAuthConfig.provider_type == "google",
                )
            )
            row = result.first()

        if not row:
            return None

        return {
            "customer_id": row.tenant_hint,
            "client_id": row.client_id,
            "client_secret": decrypt(row.client_secret_encrypted),
            "internal_id": row.tenant_id,
        }


async def get_config_for_tenant(tenant_id: str) -> dict | None:
    with log_step(LOG_STEP):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(
                    TenantAuthConfig.client_id,
                    TenantAuthConfig.client_secret_encrypted,
                    TenantAuthConfig.tenant_hint,
                ).where(
                    TenantAuthConfig.tenant_id == tenant_id,
                    TenantAuthConfig.provider_type == "google",
                )
            )
            row = result.first()

        if not row:
            return None

        return {
            "customer_id": row.tenant_hint,
            "client_id": row.client_id,
            "client_secret": decrypt(row.client_secret_encrypted),
        }


async def get_valid_google_token(user_id: str) -> str | None:
    with log_step(LOG_STEP):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Integration).where(
                    Integration.user_id == user_id,
                    Integration.platform == "google",
                )
            )
            integration = result.scalar_one_or_none()

        if not integration:
            return None

        expires_at = integration.expires_at or 0
        if time.time() < (expires_at - 300):
            return integration.access_token

        if not integration.refresh_token:
            return None

        async with AsyncSessionLocal() as session:
            user_result = await session.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()

        if not user or not user.email:
            return None

        domain = user.email.split("@")[1]
        tenant_config = await get_config_for_domain(domain)
        if not tenant_config:
            return None

        data = {
            "client_id": tenant_config["client_id"],
            "client_secret": tenant_config["client_secret"],
            "refresh_token": integration.refresh_token,
            "grant_type": "refresh_token",
        }

        client = get_http_client()
        resp = await client.post(GOOGLE_TOKEN_URL, data=data)

        if resp.status_code != 200:
            logger.error(f"Failed to refresh Google token: {resp.text}")
            return None

        token_data = resp.json()
        new_access_token = token_data["access_token"]
        new_expires_at = int(time.time()) + token_data.get("expires_in", 3600)
        new_refresh_token = token_data.get("refresh_token", integration.refresh_token)

        async with AsyncSessionLocal() as session:
            await session.execute(
                update(Integration)
                .where(Integration.id == integration.id)
                .values(
                    access_token=new_access_token,
                    refresh_token=new_refresh_token,
                    expires_at=new_expires_at,
                )
            )
            await session.commit()

        return new_access_token


async def handle_login(request: GoogleLoginRequest, response: Response) -> dict:
    with log_step(LOG_STEP):
        try:
            domain = request.email.split("@")[1]
        except IndexError:
            raise HTTPException(status_code=400, detail="Invalid email address.")

        tenant_config = await get_config_for_domain(domain)
        if not tenant_config:
            raise HTTPException(status_code=403, detail=f"Domain {domain} is not configured for Google Auth.")

        state = str(uuid.uuid4())
        auth_data = {"state": state, "tenant_id": tenant_config["internal_id"], "language": request.language}

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
        return {"login_url": f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"}


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

        tenant_config = await get_config_for_tenant(cookie_data.get("tenant_id"))
        if not tenant_config:
            raise HTTPException(status_code=500, detail="Tenant configuration not found.")

        redirect_uri = f"{settings.APP_BASE_URL}{REDIRECT_PATH}"
        token_data = {
            "code": code,
            "client_id": tenant_config["client_id"],
            "client_secret": tenant_config["client_secret"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }

        client = get_http_client()
        token_resp = await client.post(GOOGLE_TOKEN_URL, data=token_data)
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to retrieve access token.")

        tokens = token_resp.json()
        access_token = tokens["access_token"]
        refresh_token = tokens.get("refresh_token")
        expires_at = int(time.time()) + tokens.get("expires_in", 3600)

        user_resp = await client.get(
            GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to retrieve user profile.")

        user_info = user_resp.json()
        user_id = user_info.get("sub")
        email = user_info.get("email")
        name = user_info.get("name")
        language = cookie_data.get("language", "en")

        async with AsyncSessionLocal() as session:
            user_stmt = insert(User).values(id=user_id, name=name, email=email, language_code=language)
            user_stmt = user_stmt.on_conflict_do_update(
                index_elements=[User.id],
                set_={
                    "name": user_stmt.excluded.name,
                    "email": user_stmt.excluded.email,
                    "language_code": user_stmt.excluded.language_code,
                },
            )
            await session.execute(user_stmt)

            int_stmt = insert(Integration).values(
                user_id=user_id,
                platform="google",
                platform_user_id=user_id,
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=expires_at,
            )
            int_stmt = int_stmt.on_conflict_do_update(
                index_elements=[Integration.user_id, Integration.platform],
                set_={
                    "platform_user_id": int_stmt.excluded.platform_user_id,
                    "access_token": int_stmt.excluded.access_token,
                    "refresh_token": int_stmt.excluded.refresh_token,
                    "expires_at": int_stmt.excluded.expires_at,
                },
            )
            await session.execute(int_stmt)
            await session.commit()

        app_token = generate_jwt_token(user_id=user_id, session_id=None, expires_delta=timedelta(days=90))
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
    with log_step(LOG_STEP):
        response.delete_cookie("app_auth_token")
        return {"logout_url": "/"}
