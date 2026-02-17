SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS TENANTS (
        tenant_id TEXT PRIMARY KEY,
        organization_name TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS TENANT_DOMAINS (
        domain TEXT PRIMARY KEY,
        tenant_id TEXT REFERENCES TENANTS(tenant_id) ON DELETE CASCADE,
        provider_type TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS TENANT_AUTH_CONFIGS (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT REFERENCES TENANTS(tenant_id) ON DELETE CASCADE,
        provider_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret_encrypted TEXT NOT NULL,
        tenant_hint TEXT,
        UNIQUE(tenant_id, provider_type)
    )
    """,
]
