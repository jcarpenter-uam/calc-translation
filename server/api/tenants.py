import logging
from typing import List, Optional

import asyncpg
import core.database as database
from core.authentication import encrypt
from core.database import (
    SQL_DELETE_TENANT_BY_ID,
    SQL_GET_ALL_TENANTS,
    SQL_GET_TENANT_BY_ID,
    SQL_INSERT_TENANT,
)
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class TenantBase(BaseModel):
    """Base model with common fields."""

    domain: str
    client_id: str
    organization_name: str


class TenantCreate(TenantBase):
    """Model for creating a new tenant. Receives a plaintext secret."""

    tenant_id: str = Field(..., description="The Entra ID (Directory) Tenant ID")
    client_secret: str = Field(..., description="The plaintext client secret")


class TenantUpdate(BaseModel):
    """Model for updating a tenant. All fields are optional."""

    domain: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    organization_name: Optional[str] = None


class TenantResponse(TenantBase):
    """Model for returning tenant info. NEVER includes the secret."""

    tenant_id: str
    has_secret: bool = Field(..., description="True if a client secret is set")

    class Config:
        from_attributes = True


async def create_tenant(tenant: TenantCreate) -> TenantResponse:
    """
    Encrypts the secret and saves a new tenant config to the database.
    """
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    try:
        encrypted_secret = encrypt(tenant.client_secret)

        async with database.DB_POOL.acquire() as conn:
            await conn.execute(
                SQL_INSERT_TENANT,
                tenant.tenant_id,
                tenant.domain,
                tenant.client_id,
                encrypted_secret,
                tenant.organization_name,
            )

            new_tenant_row = await conn.fetchrow(SQL_GET_TENANT_BY_ID, tenant.tenant_id)

        return TenantResponse.model_validate(dict(new_tenant_row))

    except asyncpg.exceptions.UniqueViolationError:
        logger.warning(
            f"Failed to create tenant: domain {tenant.domain} already exists."
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A tenant with domain '{tenant.domain}' already exists.",
        )
    except Exception as e:
        logger.error(f"Error creating tenant {tenant.tenant_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error.")


async def get_all_tenants() -> List[TenantResponse]:
    """
    Retrieves all tenant configurations from the database.
    """
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    async with database.DB_POOL.acquire() as conn:
        rows = await conn.fetch(SQL_GET_ALL_TENANTS)

    return [TenantResponse.model_validate(dict(row)) for row in rows]


async def get_tenant_by_id(tenant_id: str) -> TenantResponse:
    """
    Retrieves a single tenant configuration by its Tenant ID.
    """
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    async with database.DB_POOL.acquire() as conn:
        row = await conn.fetchrow(SQL_GET_TENANT_BY_ID, tenant_id)

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with ID '{tenant_id}' not found.",
        )
    return TenantResponse.model_validate(dict(row))


async def update_tenant(tenant_id: str, patch: TenantUpdate) -> TenantResponse:
    """
    Updates an existing tenant configuration.
    """
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    update_data = patch.model_dump(exclude_unset=True)

    if "client_secret" in update_data:
        update_data["client_secret_encrypted"] = encrypt(
            update_data.pop("client_secret")
        )

    if not update_data:
        logger.warning(f"Update called for tenant {tenant_id} with no data.")
        return await get_tenant_by_id(tenant_id)

    query_parts = []
    query_args = []
    arg_counter = 1

    for key, value in update_data.items():
        query_parts.append(f"{key} = ${arg_counter}")
        query_args.append(value)
        arg_counter += 1

    query_args.append(tenant_id)

    set_clause = ", ".join(query_parts)
    query = f"UPDATE TENANTS SET {set_clause} WHERE tenant_id = ${arg_counter}"

    try:
        async with database.DB_POOL.acquire() as conn:
            result = await conn.execute(query, *query_args)

            if result == "UPDATE 0":
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Tenant with ID '{tenant_id}' not found.",
                )

        return await get_tenant_by_id(tenant_id)

    except Exception as e:
        logger.error(f"Error updating tenant {tenant_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error.")


async def delete_tenant(tenant_id: str):
    """
    Deletes a tenant configuration by its Tenant ID.
    """
    if not database.DB_POOL:
        raise HTTPException(status_code=503, detail="Database not initialized.")

    async with database.DB_POOL.acquire() as conn:
        result = await conn.execute(SQL_DELETE_TENANT_BY_ID, tenant_id)

    if result == "DELETE 0":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with ID '{tenant_id}' not found.",
        )
    return


def create_tenant_router() -> APIRouter:
    """
    Creates the REST API router for tenants.
    """
    router = APIRouter(
        prefix="/api/tenant",
    )

    @router.post(
        "/",
        response_model=TenantResponse,
        status_code=status.HTTP_201_CREATED,
        summary="Create or Update Tenant",
    )
    async def post_tenant(tenant: TenantCreate):
        """
        Create a new tenant configuration.
        If a tenant with the same `tenant_id` already exists,
        it will be updated (UPSERT).
        """
        return await create_tenant(tenant)

    @router.get(
        "/",
        response_model=List[TenantResponse],
        summary="Get All Tenants",
    )
    async def get_tenants():
        """
        Retrieve a list of all configured tenants.
        """
        return await get_all_tenants()

    @router.get(
        "/{tenant_id}",
        response_model=TenantResponse,
        summary="Get Tenant by ID",
    )
    async def get_tenant(tenant_id: str):
        """
        Retrieve a specific tenant configuration by its Tenant ID.
        """
        return await get_tenant_by_id(tenant_id)

    @router.patch(
        "/{tenant_id}",
        response_model=TenantResponse,
        summary="Update Tenant",
    )
    async def patch_tenant(tenant_id: str, patch: TenantUpdate):
        """
        Update one or more fields of an existing tenant configuration.
        Only fields provided in the request body will be updated.
        """
        return await update_tenant(tenant_id, patch)

    @router.delete(
        "/{tenant_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        summary="Delete Tenant by ID",
    )
    async def delete_tenant_endpoint(tenant_id: str):
        """
        Delete a tenant configuration by its Tenant ID.
        """
        await delete_tenant(tenant_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
