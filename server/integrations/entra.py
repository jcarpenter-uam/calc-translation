import json
import logging
import time
import uuid
from datetime import timedelta

import msal
from core.authentication import decrypt, generate_jwt_token
from core.config import settings
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from models.integrations import Integration
from models.tenants import Tenant, TenantAuthConfig, TenantDomain
from models.users import User
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger(__name__)

LOG_STEP = "INT-ENTRA"


class EntraLoginRequest(BaseModel):
    email: str
    language: str


REDIRECT_PATH = "/api/auth/entra/callback"
SCOPE = ["User.Read", "Calendars.Read"]


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
                    TenantAuthConfig.provider_type == "microsoft",
                )
            )
            row = result.first()

        if not row:
            return None

        return {
            "tenant_id": row.tenant_hint,
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
                    TenantAuthConfig.provider_type == "microsoft",
                )
            )
            row = result.first()

        if not row:
            return None

        return {
            "tenant_id": row.tenant_hint,
            "client_id": row.client_id,
            "client_secret": decrypt(row.client_secret_encrypted),
        }


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
    return app.get_authorization_request_url(SCOPE, state=state, redirect_uri=redirect_uri)


def _get_token_from_code(tenant_config: dict, code: str) -> dict:
    app = _build_msal_app(tenant_config)
    redirect_uri = f"{settings.APP_BASE_URL}{REDIRECT_PATH}"
    return app.acquire_token_by_authorization_code(code, scopes=SCOPE, redirect_uri=redirect_uri)


async def get_valid_microsoft_token(user_id: str) -> str | None:
    with log_step(LOG_STEP):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Integration).where(
                    Integration.user_id == user_id,
                    Integration.platform == "microsoft",
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

        app = _build_msal_app(tenant_config)
        result = app.acquire_token_by_refresh_token(integration.refresh_token, scopes=SCOPE)
        if "error" in result:
            logger.error(f"MSAL Refresh Error: {result.get('error_description')}")
            return None

        new_access_token = result.get("access_token")
        new_refresh_token = result.get("refresh_token")
        new_expires_at = int(time.time()) + result.get("expires_in", 3600)

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


async def handle_login(request: EntraLoginRequest, response: Response) -> RedirectResponse:
    with log_step(LOG_STEP):
        try:
            domain = request.email.split("@")[1]
        except IndexError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email address provided.")

        tenant_config = await get_config_for_domain(domain)
        if not tenant_config:
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
        return {"login_url": _build_auth_url(tenant_config, state)}


async def handle_callback(request: Request) -> RedirectResponse:
    with log_step(LOG_STEP):
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

        tenant_config = await get_config_for_tenant(cookie_data.get("tenant_id"))
        if not tenant_config:
            raise HTTPException(status_code=500, detail="Tenant configuration not found.")

        token_response = _get_token_from_code(tenant_config, code)
        if "error" in token_response:
            raise HTTPException(status_code=400, detail=f"Token error: {token_response.get('error_description')}")

        claims = token_response.get("id_token_claims", {})
        user_id = claims.get("oid")
        user_email = claims.get("preferred_username")
        user_name = claims.get("name")
        if not user_id:
            raise HTTPException(status_code=400, detail="Could not identify user.")

        user_language = cookie_data.get("language")
        access_token = token_response.get("access_token")
        refresh_token = token_response.get("refresh_token")
        expires_at = int(time.time()) + token_response.get("expires_in", 3599)

        async with AsyncSessionLocal() as session:
            user_stmt = insert(User).values(
                id=user_id,
                name=user_name,
                email=user_email,
                language_code=user_language,
            )
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
                platform="microsoft",
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
        is_production_ssl = settings.APP_BASE_URL.startswith("https")
        redirect_response.set_cookie(
            key="app_auth_token",
            value=app_token,
            max_age=90 * 24 * 60 * 60,
            httponly=True,
            secure=is_production_ssl,
            samesite="none" if is_production_ssl else "lax",
        )
        redirect_response.delete_cookie("entra_auth_state")
        return redirect_response


async def handle_logout(response: Response, user_payload: dict) -> dict:
    with log_step(LOG_STEP):
        response.delete_cookie("app_auth_token")
        post_logout_url = f"{settings.APP_BASE_URL}/"
        logout_url = (
            f"https://login.microsoftonline.com/common/oauth2/v2.0/logout"
            f"?post_logout_redirect_uri={post_logout_url}"
        )
        return {"logout_url": logout_url}
