import logging
from typing import Any, Dict, List, Optional, Union

from core.authentication import encrypt, get_admin_user_payload
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, HTTPException, Response, status
from models.tenants import Tenant, TenantAuthConfig, TenantDomain
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger(__name__)


class DomainEntry(BaseModel):
    domain: str
    provider: Optional[str] = None


class TenantBase(BaseModel):
    domains: List[Union[str, DomainEntry]]
    client_id: str
    organization_name: str

    @field_validator("domains", mode="before")
    def parse_domains(cls, v):
        if not v:
            return []
        normalized = []
        for item in v:
            if isinstance(item, str):
                normalized.append(DomainEntry(domain=item))
            elif isinstance(item, dict):
                normalized.append(DomainEntry(**item))
            else:
                normalized.append(item)
        return normalized


class TenantCreate(TenantBase):
    tenant_id: str = Field(..., description="The Entra ID (Directory) Tenant ID")
    client_secret: str = Field(..., description="The plaintext client secret")
    provider_type: str = Field(default="microsoft", description="The auth provider")


class TenantUpdate(BaseModel):
    domains: Optional[List[Union[str, DomainEntry]]] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    organization_name: Optional[str] = None
    tenant_hint: Optional[str] = None
    provider_type: Optional[str] = "microsoft"

    @field_validator("domains", mode="before")
    def parse_domains(cls, v):
        if v is None:
            return None
        normalized = []
        for item in v:
            if isinstance(item, str):
                normalized.append(DomainEntry(domain=item))
            elif isinstance(item, dict):
                normalized.append(DomainEntry(**item))
            else:
                normalized.append(item)
        return normalized


class TenantResponse(TenantBase):
    tenant_id: str
    has_secret: bool = Field(..., description="True if a client secret is set")
    auth_methods: Optional[Dict[str, Any]] = Field(default=None)
    domains: List[DomainEntry]

    class Config:
        from_attributes = True


async def _build_tenant_response(session, tenant_id: str, provider: str = "microsoft"):
    tenant_result = await session.execute(select(Tenant).where(Tenant.tenant_id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    if not tenant:
        return None

    auth_rows = (
        await session.execute(
            select(TenantAuthConfig).where(TenantAuthConfig.tenant_id == tenant_id)
        )
    ).scalars().all()
    domain_rows = (
        await session.execute(
            select(TenantDomain).where(TenantDomain.tenant_id == tenant_id).order_by(TenantDomain.domain)
        )
    ).scalars().all()

    auth_methods: Dict[str, Any] = {}
    for row in auth_rows:
        auth_methods[row.provider_type] = {
            "client_id": row.client_id or "",
            "has_secret": bool(row.client_secret_encrypted),
            "tenant_hint": row.tenant_hint,
        }

    config = auth_methods.get(provider)
    if not config and "microsoft" in auth_methods:
        config = auth_methods["microsoft"]
    elif not config and auth_methods:
        config = list(auth_methods.values())[0]
    if not config:
        config = {"client_id": "", "has_secret": False}

    return TenantResponse(
        tenant_id=tenant.tenant_id,
        organization_name=tenant.organization_name or "",
        domains=[DomainEntry(domain=d.domain, provider=d.provider_type) for d in domain_rows],
        client_id=config.get("client_id", ""),
        has_secret=config.get("has_secret", False),
        auth_methods=auth_methods,
    )


def create_tenant_router() -> APIRouter:
    router = APIRouter(prefix="/api/tenant")
    LOG_STEP = "API-TENANT"

    @router.post("/", response_model=TenantResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(get_admin_user_payload)])
    async def post_tenant(tenant: TenantCreate):
        with log_step(LOG_STEP):
            encrypted_secret = encrypt(tenant.client_secret)
            try:
                async with AsyncSessionLocal() as session:
                    await session.execute(
                        insert(Tenant)
                        .values(tenant_id=tenant.tenant_id, organization_name=tenant.organization_name)
                        .on_conflict_do_update(
                            index_elements=[Tenant.tenant_id],
                            set_={"organization_name": tenant.organization_name},
                        )
                    )

                    auth_stmt = insert(TenantAuthConfig).values(
                        tenant_id=tenant.tenant_id,
                        provider_type=tenant.provider_type,
                        client_id=tenant.client_id,
                        client_secret_encrypted=encrypted_secret,
                        tenant_hint=tenant.tenant_id,
                    )
                    auth_stmt = auth_stmt.on_conflict_do_update(
                        index_elements=[TenantAuthConfig.tenant_id, TenantAuthConfig.provider_type],
                        set_={
                            "client_id": auth_stmt.excluded.client_id,
                            "client_secret_encrypted": auth_stmt.excluded.client_secret_encrypted,
                            "tenant_hint": auth_stmt.excluded.tenant_hint,
                        },
                    )
                    await session.execute(auth_stmt)

                    await session.execute(
                        delete(TenantDomain).where(TenantDomain.tenant_id == tenant.tenant_id)
                    )
                    for d_entry in tenant.domains or []:
                        await session.execute(
                            insert(TenantDomain)
                            .values(
                                domain=d_entry.domain,
                                tenant_id=tenant.tenant_id,
                                provider_type=d_entry.provider,
                            )
                            .on_conflict_do_update(
                                index_elements=[TenantDomain.domain],
                                set_={
                                    "tenant_id": tenant.tenant_id,
                                    "provider_type": d_entry.provider,
                                },
                            )
                        )

                    await session.commit()
                    response = await _build_tenant_response(session, tenant.tenant_id, tenant.provider_type)
                    return response
            except Exception as e:
                logger.error(f"Error creating tenant {tenant.tenant_id}: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail="Internal server error.")

    @router.get("/", response_model=List[TenantResponse], dependencies=[Depends(get_admin_user_payload)])
    async def get_tenants():
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                tenant_ids = (
                    await session.execute(select(Tenant.tenant_id).order_by(Tenant.tenant_id))
                ).scalars().all()
                responses = [await _build_tenant_response(session, tid) for tid in tenant_ids]
            return [r for r in responses if r is not None]

    @router.get("/{tenant_id}", response_model=TenantResponse, dependencies=[Depends(get_admin_user_payload)])
    async def get_tenant(tenant_id: str):
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                response = await _build_tenant_response(session, tenant_id)
            if not response:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Tenant with ID '{tenant_id}' not found.")
            return response

    @router.patch("/{tenant_id}", response_model=TenantResponse, dependencies=[Depends(get_admin_user_payload)])
    async def patch_tenant(tenant_id: str, patch: TenantUpdate):
        with log_step(LOG_STEP):
            update_data = patch.model_dump(exclude_unset=True)
            provider = update_data.pop("provider_type", "microsoft")
            new_domains = update_data.pop("domains", None)

            auth_updates = {}
            if "client_id" in update_data:
                auth_updates["client_id"] = update_data.pop("client_id")
            if "client_secret" in update_data:
                auth_updates["client_secret_encrypted"] = encrypt(update_data.pop("client_secret"))
            if "tenant_hint" in update_data:
                auth_updates["tenant_hint"] = update_data.pop("tenant_hint")

            tenant_updates = update_data

            try:
                async with AsyncSessionLocal() as session:
                    if tenant_updates:
                        await session.execute(
                            update(Tenant).where(Tenant.tenant_id == tenant_id).values(**tenant_updates)
                        )

                    if auth_updates:
                        existing = (
                            await session.execute(
                                select(TenantAuthConfig).where(
                                    TenantAuthConfig.tenant_id == tenant_id,
                                    TenantAuthConfig.provider_type == provider,
                                )
                            )
                        ).scalar_one_or_none()

                        if existing:
                            await session.execute(
                                update(TenantAuthConfig)
                                .where(
                                    TenantAuthConfig.tenant_id == tenant_id,
                                    TenantAuthConfig.provider_type == provider,
                                )
                                .values(**auth_updates)
                            )
                        else:
                            c_id = auth_updates.get("client_id")
                            c_secret = auth_updates.get("client_secret_encrypted")
                            t_hint = auth_updates.get("tenant_hint", tenant_id)
                            if not c_id or not c_secret:
                                raise HTTPException(
                                    status_code=status.HTTP_400_BAD_REQUEST,
                                    detail=f"Client ID and Secret are required when adding a new {provider} configuration.",
                                )
                            await session.execute(
                                insert(TenantAuthConfig).values(
                                    tenant_id=tenant_id,
                                    provider_type=provider,
                                    client_id=c_id,
                                    client_secret_encrypted=c_secret,
                                    tenant_hint=t_hint,
                                )
                            )

                    if new_domains is not None:
                        await session.execute(delete(TenantDomain).where(TenantDomain.tenant_id == tenant_id))
                        for d_entry in new_domains:
                            domain_value = d_entry.domain if isinstance(d_entry, DomainEntry) else d_entry["domain"]
                            provider_value = d_entry.provider if isinstance(d_entry, DomainEntry) else d_entry.get("provider")
                            await session.execute(
                                insert(TenantDomain)
                                .values(domain=domain_value, tenant_id=tenant_id, provider_type=provider_value)
                                .on_conflict_do_update(
                                    index_elements=[TenantDomain.domain],
                                    set_={"tenant_id": tenant_id, "provider_type": provider_value},
                                )
                            )

                    await session.commit()
                    response = await _build_tenant_response(session, tenant_id, provider)

                if not response:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Tenant with ID '{tenant_id}' not found.")
                return response
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error updating tenant {tenant_id}: {e}", exc_info=True)
                raise HTTPException(status_code=500, detail="Internal server error.")

    @router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(get_admin_user_payload)])
    async def delete_tenant_endpoint(tenant_id: str):
        with log_step(LOG_STEP):
            async with AsyncSessionLocal() as session:
                result = await session.execute(delete(Tenant).where(Tenant.tenant_id == tenant_id))
                await session.commit()

            if result.rowcount == 0:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Tenant with ID '{tenant_id}' not found.")
            return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.delete("/{tenant_id}/auth/{provider_type}", dependencies=[Depends(get_admin_user_payload)])
    async def delete_tenant_auth_method(tenant_id: str, provider_type: str):
        with log_step(LOG_STEP):
            if provider_type not in ["microsoft", "google"]:
                raise HTTPException(status_code=400, detail="Invalid provider type.")

            async with AsyncSessionLocal() as session:
                await session.execute(
                    delete(TenantAuthConfig).where(
                        TenantAuthConfig.tenant_id == tenant_id,
                        TenantAuthConfig.provider_type == provider_type,
                    )
                )
                await session.execute(
                    update(TenantDomain)
                    .where(
                        TenantDomain.tenant_id == tenant_id,
                        TenantDomain.provider_type == provider_type,
                    )
                    .values(provider_type=None)
                )

                remaining = await session.execute(
                    select(func.count()).select_from(TenantAuthConfig).where(TenantAuthConfig.tenant_id == tenant_id)
                )
                count = remaining.scalar_one()

                if count == 0:
                    await session.execute(delete(Tenant).where(Tenant.tenant_id == tenant_id))
                    await session.commit()
                    return Response(status_code=status.HTTP_204_NO_CONTENT)

                await session.commit()
                row = await _build_tenant_response(session, tenant_id)
                if not row:
                    return Response(status_code=status.HTTP_204_NO_CONTENT)
                return row

    return router
