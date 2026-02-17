from sqlalchemy import Column, ForeignKey, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID

from core.orm import Base


class Tenant(Base):
    __tablename__ = "tenants"

    tenant_id = Column(Text, primary_key=True)
    organization_name = Column(Text)


class TenantDomain(Base):
    __tablename__ = "tenant_domains"

    domain = Column(Text, primary_key=True)
    tenant_id = Column(Text, ForeignKey("tenants.tenant_id", ondelete="CASCADE"))
    provider_type = Column(Text)


class TenantAuthConfig(Base):
    __tablename__ = "tenant_auth_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider_type", name="uq_tenant_provider"),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    tenant_id = Column(Text, ForeignKey("tenants.tenant_id", ondelete="CASCADE"))
    provider_type = Column(Text, nullable=False)
    client_id = Column(Text, nullable=False)
    client_secret_encrypted = Column(Text, nullable=False)
    tenant_hint = Column(Text)
