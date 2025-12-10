import asyncio
import logging

import asyncpg
from core.config import settings

logger = logging.getLogger(__name__)

POSTGRES_DSN = settings.DATABASE_URL
DB_POOL = None
db_lock = asyncio.Lock()


async def init_db():
    """
    Initializes the database connection pool and creates tables if they don't exist.
    """
    global DB_POOL
    async with db_lock:
        if DB_POOL:
            logger.info("Database pool already initialized.")
            return

        try:
            DB_POOL = await asyncpg.create_pool(dsn=POSTGRES_DSN)
            async with DB_POOL.acquire() as conn:
                async with conn.transaction():

                    # Users & Tenants
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS USERS (
                            id TEXT PRIMARY KEY, -- EntraID User ID
                            name TEXT,
                            email TEXT,
                            language_code TEXT,
                            is_admin BOOLEAN DEFAULT FALSE
                        )
                        """
                    )
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TENANTS (
                            tenant_id TEXT PRIMARY KEY,
                            client_id TEXT NOT NULL,
                            client_secret_encrypted TEXT NOT NULL,
                            organization_name TEXT
                        )
                        """
                    )
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TENANT_DOMAINS (
                            domain TEXT PRIMARY KEY,
                            tenant_id TEXT REFERENCES TENANTS(tenant_id) ON DELETE CASCADE
                        )
                        """
                    )

                    # Integrations
                    await conn.execute(
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
                        """
                    )
                    await conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_integrations_platform_id ON INTEGRATIONS(platform, platform_user_id);"
                    )

                    # Meetings & Languages
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS MEETINGS (
                            id TEXT PRIMARY KEY,
                            integration_id INTEGER REFERENCES INTEGRATIONS(id) ON DELETE SET NULL,
                            passcode TEXT,
                            platform TEXT,
                            readable_id TEXT,
                            meeting_time TIMESTAMPTZ,
                            join_url TEXT,
                            UNIQUE(platform, readable_id)
                        )
                        """
                    )

                    # Transcripts
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TRANSCRIPTS (
                            id SERIAL PRIMARY KEY,
                            meeting_id TEXT REFERENCES MEETINGS(id) ON DELETE CASCADE,
                            language_code TEXT NOT NULL,
                            file_name TEXT NOT NULL,
                            creation_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE (meeting_id, language_code)
                        );
                        """
                    )

            logger.info("Database pool initialized successfully and schema verified.")
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}", exc_info=True)
            DB_POOL = None
            raise


# ==============================================================================
# ------------------------ SQL QUERY DEFINITIONS -------------------------------
# ==============================================================================

# --- USERS ---

SQL_UPSERT_USER = """
INSERT INTO USERS (id, name, email, language_code)
VALUES ($1, $2, $3, $4)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email,
    language_code = COALESCE(excluded.language_code, USERS.language_code);
"""

SQL_GET_USER_BY_ID = "SELECT * FROM USERS WHERE id = $1;"
SQL_GET_ALL_USERS = "SELECT * FROM USERS;"
SQL_DELETE_USER_BY_ID = "DELETE FROM USERS WHERE id = $1;"
SQL_SET_USER_ADMIN_STATUS = "UPDATE USERS SET is_admin = $1 WHERE id = $2;"
SQL_UPDATE_USER_LANGUAGE = "UPDATE USERS SET language_code = $1 WHERE id = $2;"

# --- TENANTS ---

SQL_GET_TENANT_AUTH_BY_ID = """
SELECT tenant_id, client_id, client_secret_encrypted
FROM TENANTS
WHERE tenant_id = $1;
"""

SQL_INSERT_TENANT = """
INSERT INTO TENANTS (tenant_id, client_id, client_secret_encrypted, organization_name)
VALUES ($1, $2, $3, $4)
ON CONFLICT(tenant_id) DO UPDATE SET
    client_id = excluded.client_id,
    client_secret_encrypted = excluded.client_secret_encrypted,
    organization_name = excluded.organization_name;
"""

SQL_INSERT_DOMAIN = """
INSERT INTO TENANT_DOMAINS (domain, tenant_id)
VALUES ($1, $2)
ON CONFLICT(domain) DO UPDATE SET tenant_id = excluded.tenant_id;
"""

SQL_GET_TENANT_BY_DOMAIN = """
SELECT t.tenant_id, t.client_id, t.client_secret_encrypted
FROM TENANTS t
JOIN TENANT_DOMAINS d ON t.tenant_id = d.tenant_id
WHERE d.domain = $1;
"""

SQL_GET_TENANT_BY_ID = """
SELECT 
    t.tenant_id, 
    t.client_id, 
    t.organization_name, 
    (t.client_secret_encrypted IS NOT NULL AND t.client_secret_encrypted != '') as has_secret,
    COALESCE(array_agg(d.domain) FILTER (WHERE d.domain IS NOT NULL), '{}') as domains
FROM TENANTS t
LEFT JOIN TENANT_DOMAINS d ON t.tenant_id = d.tenant_id
WHERE t.tenant_id = $1
GROUP BY t.tenant_id;
"""

SQL_GET_ALL_TENANTS = """
SELECT 
    t.tenant_id, 
    t.client_id, 
    t.organization_name, 
    (t.client_secret_encrypted IS NOT NULL AND t.client_secret_encrypted != '') as has_secret,
    COALESCE(array_agg(d.domain) FILTER (WHERE d.domain IS NOT NULL), '{}') as domains
FROM TENANTS t
LEFT JOIN TENANT_DOMAINS d ON t.tenant_id = d.tenant_id
GROUP BY t.tenant_id;
"""

SQL_DELETE_TENANT_BY_ID = "DELETE FROM TENANTS WHERE tenant_id = $1;"
SQL_DELETE_DOMAINS_BY_TENANT_ID = "DELETE FROM TENANT_DOMAINS WHERE tenant_id = $1;"


# --- INTEGRATIONS ---

SQL_UPSERT_INTEGRATION = """
INSERT INTO INTEGRATIONS (user_id, platform, platform_user_id, access_token, refresh_token, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT(user_id, platform) DO UPDATE SET
    platform_user_id = excluded.platform_user_id,
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at;
"""

SQL_GET_INTEGRATION = """
SELECT id, access_token, refresh_token, expires_at
FROM INTEGRATIONS
WHERE user_id = $1 AND platform = $2;
"""

SQL_GET_INTEGRATIONS_BY_USER = "SELECT * FROM INTEGRATIONS WHERE user_id = $1;"
SQL_DELETE_INTEGRATION = (
    "DELETE FROM INTEGRATIONS WHERE user_id = $1 AND platform = $2;"
)


# --- MEETINGS ---

SQL_INSERT_MEETING = """
INSERT INTO MEETINGS (id, integration_id, passcode, platform, readable_id, meeting_time, join_url)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT(id) DO NOTHING;
"""

SQL_GET_MEETING_BY_ID = "SELECT * FROM MEETINGS WHERE id = $1;"

SQL_GET_MEETING_BY_READABLE_ID = """
SELECT id FROM MEETINGS WHERE platform = $1 AND readable_id = $2;
"""

SQL_GET_MEETING_BY_JOIN_URL = """
SELECT m.id
FROM MEETINGS m
WHERE m.join_url LIKE '%' || $1;
"""

SQL_GET_MEETING_AUTH_BY_READABLE_ID = """
SELECT m.id, m.passcode
FROM MEETINGS m
WHERE m.platform = $1 AND m.readable_id = $2;
"""

SQL_GET_MEETINGS_BY_USER_ID = """
SELECT m.*
FROM MEETINGS m
JOIN INTEGRATIONS i ON m.integration_id = i.id
WHERE i.user_id = $1;
"""


# --- TRANSCRIPTS ---

SQL_INSERT_TRANSCRIPT = """
INSERT INTO TRANSCRIPTS (meeting_id, language_code, file_name)
VALUES ($1, $2, $3)
ON CONFLICT (meeting_id, language_code) 
DO UPDATE SET 
    file_name = excluded.file_name,
    creation_date = CURRENT_TIMESTAMP;
"""

SQL_GET_TRANSCRIPT_BY_MEETING_ID = """
SELECT file_name, creation_date 
FROM TRANSCRIPTS 
WHERE meeting_id = $1 AND language_code = $2;
"""
