import json
import logging
from typing import Any, Dict, List, Optional

import asyncpg
import core.database as database
from core.authentication import encrypt, get_admin_user_payload
from core.database import (
    SQL_COUNT_TENANT_AUTH_CONFIGS,
    SQL_DELETE_DOMAINS_BY_TENANT_ID,
    SQL_DELETE_TENANT_AUTH_CONFIG,
    SQL_DELETE_TENANT_BY_ID,
    SQL_GET_ALL_TENANTS,
    SQL_GET_TENANT_BY_ID,
    SQL_INSERT_DOMAIN,
    SQL_INSERT_TENANT_AUTH,
    SQL_INSERT_TENANT_BASE,
)
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class TenantBase(BaseModel):
    """Base model with common fields."""

    domains: List[str]
    client_id: str
    organization_name: str


class TenantCreate(TenantBase):
    """Model for creating a new tenant. Receives a plaintext secret."""

    tenant_id: str = Field(..., description="The Entra ID (Directory) Tenant ID")
    client_secret: str = Field(..., description="The plaintext client secret")
    provider_type: str = Field(
        default="microsoft", description="The auth provider (default: microsoft)"
    )


class TenantUpdate(BaseModel):
    """Model for updating a tenant. All fields are optional."""

    domains: Optional[List[str]] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    organization_name: Optional[str] = None
    tenant_hint: Optional[str] = None
    provider_type: Optional[str] = "microsoft"


class TenantResponse(TenantBase):
    """Model for returning tenant info. NEVER includes the secret."""

    tenant_id: str
    has_secret: bool = Field(..., description="True if a client secret is set")
    auth_methods: Optional[Dict[str, Any]] = Field(
        default=None, description="Configuration status for all providers"
    )

    class Config:
        from_attributes = True


def map_row_to_response(row, provider="microsoft") -> TenantResponse:
    """
    Helper to convert the DB result back into the flat TenantResponse
    expected by the frontend.
    """
    auth_methods = row.get("auth_methods")
    if isinstance(auth_methods, str):
        auth_methods = json.loads(auth_methods)

    if not auth_methods:
        auth_methods = {}

    config = auth_methods.get(provider)
    if not config and "microsoft" in auth_methods:
        config = auth_methods["microsoft"]
    elif not config and auth_methods:
        config = list(auth_methods.values())[0]

    if not config:
        config = {"client_id": "", "has_secret": False}

    return TenantResponse(
        tenant_id=row["tenant_id"],
        organization_name=row["organization_name"] or "",
        domains=row["domains"] or [],
        client_id=config.get("client_id", ""),
        has_secret=config.get("has_secret", False),
        auth_methods=auth_methods,
    )


def create_tenant_router() -> APIRouter:
    """
    Creates the REST API router for tenants.
    """
    router = APIRouter(
        prefix="/api/tenant",
    )
    LOG_STEP = "API-TENANT"

    # NOTE: Admin only
    @router.post(
        "/",
        response_model=TenantResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def post_tenant(tenant: TenantCreate):
        """
        Create a new tenant configuration.
        If a tenant with the same `tenant_id` already exists,
        it will be updated (UPSERT).
        """
        with log_step(LOG_STEP):
            logger.debug(f"Attempting to create/update tenant: {tenant.tenant_id}")
            if not database.DB_POOL:
                logger.error("Database not initialized during tenant creation.")
                raise HTTPException(status_code=503, detail="Database not initialized.")

            try:
                encrypted_secret = encrypt(tenant.client_secret)

                async with database.DB_POOL.acquire() as conn:
                    async with conn.transaction():
                        await conn.execute(
                            SQL_INSERT_TENANT_BASE,
                            tenant.tenant_id,
                            tenant.organization_name,
                        )

                        await conn.execute(
                            SQL_INSERT_TENANT_AUTH,
                            tenant.tenant_id,
                            tenant.provider_type,
                            tenant.client_id,
                            encrypted_secret,
                            tenant.tenant_id,
                        )

                        await conn.execute(
                            SQL_DELETE_DOMAINS_BY_TENANT_ID, tenant.tenant_id
                        )

                        if tenant.domains:
                            for domain in tenant.domains:
                                await conn.execute(
                                    SQL_INSERT_DOMAIN, domain, tenant.tenant_id
                                )

                        row = await conn.fetchrow(
                            SQL_GET_TENANT_BY_ID, tenant.tenant_id
                        )
                        return map_row_to_response(row, tenant.provider_type)

            except asyncpg.exceptions.UniqueViolationError:
                logger.warning(f"Failed to create tenant: Unique violation occurred.")
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A conflict occurred while creating the tenant.",
                )
            except Exception as e:
                logger.error(
                    f"Error creating tenant {tenant.tenant_id}: {e}", exc_info=True
                )
                raise HTTPException(status_code=500, detail="Internal server error.")

    # NOTE: Admin only
    @router.get(
        "/",
        response_model=List[TenantResponse],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_tenants():
        """
        Retrieve a list of all configured tenants.
        """
        with log_step(LOG_STEP):
            if not database.DB_POOL:
                logger.error("Database not initialized during get tenants.")
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                rows = await conn.fetch(SQL_GET_ALL_TENANTS)

            return [map_row_to_response(row) for row in rows]

    # NOTE: Admin only
    @router.get(
        "/{tenant_id}",
        response_model=TenantResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_tenant(tenant_id: str):
        """
        Retrieve a specific tenant configuration by its Tenant ID.
        """
        with log_step(LOG_STEP):
            if not database.DB_POOL:
                logger.error(f"Database not initialized during get tenant: {tenant_id}")
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                row = await conn.fetchrow(SQL_GET_TENANT_BY_ID, tenant_id)

            if not row:
                logger.warning(f"Tenant not found: {tenant_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Tenant with ID '{tenant_id}' not found.",
                )
            return map_row_to_response(row)

    # NOTE: Admin only
    @router.patch(
        "/{tenant_id}",
        response_model=TenantResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def patch_tenant(tenant_id: str, patch: TenantUpdate):
        """
        Update one or more fields of an existing tenant configuration.
        """
        with log_step(LOG_STEP):
            logger.debug(f"Request to update tenant: {tenant_id}")
            if not database.DB_POOL:
                logger.error(
                    f"Database not initialized during patch tenant: {tenant_id}"
                )
                raise HTTPException(status_code=503, detail="Database not initialized.")

            update_data = patch.model_dump(exclude_unset=True)
            provider = update_data.pop("provider_type", "microsoft")

            new_domains = None
            if "domains" in update_data:
                new_domains = update_data.pop("domains")

            auth_updates = {}
            if "client_id" in update_data:
                auth_updates["client_id"] = update_data.pop("client_id")
            if "client_secret" in update_data:
                auth_updates["client_secret_encrypted"] = encrypt(
                    update_data.pop("client_secret")
                )
            if "tenant_hint" in update_data:
                auth_updates["tenant_hint"] = update_data.pop("tenant_hint")

            tenant_updates = update_data

            try:
                async with database.DB_POOL.acquire() as conn:
                    async with conn.transaction():

                        if tenant_updates:
                            q_parts = [
                                f"{k} = ${i+1}"
                                for i, k in enumerate(tenant_updates.keys())
                            ]
                            q_vals = list(tenant_updates.values())
                            q_vals.append(tenant_id)
                            query = f"UPDATE TENANTS SET {', '.join(q_parts)} WHERE tenant_id = ${len(q_vals)}"
                            await conn.execute(query, *q_vals)

                        if auth_updates:
                            exists = await conn.fetchval(
                                "SELECT 1 FROM TENANT_AUTH_CONFIGS WHERE tenant_id=$1 AND provider_type=$2",
                                tenant_id,
                                provider,
                            )

                            if exists:
                                q_parts = [
                                    f"{k} = ${i+1}"
                                    for i, k in enumerate(auth_updates.keys())
                                ]
                                q_vals = list(auth_updates.values())
                                q_vals.append(tenant_id)
                                q_vals.append(provider)
                                query = f"UPDATE TENANT_AUTH_CONFIGS SET {', '.join(q_parts)} WHERE tenant_id = ${len(q_vals)-1} AND provider_type = ${len(q_vals)}"
                                await conn.execute(query, *q_vals)
                            else:
                                c_id = auth_updates.get("client_id")
                                c_secret = auth_updates.get("client_secret_encrypted")
                                t_hint = auth_updates.get("tenant_hint", tenant_id)

                                if not c_id or not c_secret:
                                    raise HTTPException(
                                        status_code=status.HTTP_400_BAD_REQUEST,
                                        detail=f"Client ID and Secret are required when adding a new {provider} configuration.",
                                    )

                                await conn.execute(
                                    SQL_INSERT_TENANT_AUTH,
                                    tenant_id,
                                    provider,
                                    c_id,
                                    c_secret,
                                    t_hint,
                                )

                        if new_domains is not None:
                            await conn.execute(
                                SQL_DELETE_DOMAINS_BY_TENANT_ID, tenant_id
                            )
                            for domain in new_domains:
                                await conn.execute(SQL_INSERT_DOMAIN, domain, tenant_id)

                        row = await conn.fetchrow(SQL_GET_TENANT_BY_ID, tenant_id)

                if not row:
                    logger.warning(
                        f"Tenant not found after update attempt: {tenant_id}"
                    )
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Tenant with ID '{tenant_id}' not found.",
                    )

                return map_row_to_response(row, provider)

            except Exception as e:
                logger.error(f"Error updating tenant {tenant_id}: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail="Internal server error.")

    # NOTE: Admin only
    @router.delete(
        "/{tenant_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def delete_tenant_endpoint(tenant_id: str):
        """
        Delete a tenant configuration by its Tenant ID.
        """
        with log_step(LOG_STEP):
            logger.debug(f"Request to delete tenant: {tenant_id}")
            if not database.DB_POOL:
                logger.error(
                    f"Database not initialized during delete tenant: {tenant_id}"
                )
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                result = await conn.execute(SQL_DELETE_TENANT_BY_ID, tenant_id)

            if result == "DELETE 0":
                logger.warning(f"Tenant not found for deletion: {tenant_id}")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Tenant with ID '{tenant_id}' not found.",
                )

            return Response(status_code=status.HTTP_204_NO_CONTENT)

    # NOTE: Admin only
    @router.delete(
        "/{tenant_id}/auth/{provider_type}",
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def delete_tenant_auth_method(tenant_id: str, provider_type: str):
        """
        Deletes a specific authentication method (e.g., 'microsoft' or 'google').
        If no authentication methods remain for the tenant, the tenant itself is deleted.
        """
        with log_step(LOG_STEP):
            logger.debug(
                f"Request to delete auth method {provider_type} for tenant {tenant_id}"
            )

            if provider_type not in ["microsoft", "google"]:
                raise HTTPException(status_code=400, detail="Invalid provider type.")

            if not database.DB_POOL:
                raise HTTPException(status_code=503, detail="Database not initialized.")

            async with database.DB_POOL.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(
                        SQL_DELETE_TENANT_AUTH_CONFIG, tenant_id, provider_type
                    )

                    count = await conn.fetchval(
                        SQL_COUNT_TENANT_AUTH_CONFIGS, tenant_id
                    )

                    if count == 0:
                        logger.info(
                            f"No auth methods remaining for {tenant_id}. Deleting tenant."
                        )
                        await conn.execute(SQL_DELETE_TENANT_BY_ID, tenant_id)
                        return Response(status_code=status.HTTP_204_NO_CONTENT)
                    else:
                        row = await conn.fetchrow(SQL_GET_TENANT_BY_ID, tenant_id)
                        if not row:
                            return Response(status_code=status.HTTP_204_NO_CONTENT)

                        return map_row_to_response(row)

    return router
