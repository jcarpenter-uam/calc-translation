SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS INTEGRATIONS (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES USERS(id) ON DELETE CASCADE,
        platform TEXT,
        platform_user_id TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expires_at BIGINT,
        UNIQUE(user_id, platform)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_integrations_platform_id ON INTEGRATIONS(platform, platform_user_id);",
]
