import asyncio
import logging
import os

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

        if not POSTGRES_DSN:
            logger.error("DATABASE_URL is not set. Cannot initialize database.")
            raise ValueError("DATABASE_URL environment variable is not set.")

        try:
            DB_POOL = await asyncpg.create_pool(dsn=POSTGRES_DSN)
            async with DB_POOL.acquire() as conn:
                async with conn.transaction():
                    # Create USERS table
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS USERS (
                            id TEXT PRIMARY KEY, -- EntraID User ID
                            name TEXT,
                            email TEXT
                        )
                        """
                    )
                    # Create TENANTS table for Entra ID
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TENANTS (
                            tenant_id TEXT PRIMARY KEY,
                            domain TEXT NOT NULL UNIQUE,
                            client_id TEXT NOT NULL,
                            client_secret_encrypted TEXT NOT NULL,
                            organization_name TEXT
                        )
                        """
                    )
                    # Add an index for faster domain lookups
                    await conn.execute(
                        """
                        CREATE INDEX IF NOT EXISTS idx_tenants_domain
                        ON TENANTS(domain);
                        """
                    )
                    # Create INTEGRATIONS table
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS INTEGRATIONS (
                            id SERIAL PRIMARY KEY, -- integration_id
                            user_id TEXT REFERENCES USERS(id) ON DELETE CASCADE,
                            platform TEXT,
                            platform_user_id TEXT,
                            access_token TEXT,
                            refresh_token TEXT,
                            expires_at BIGINT, -- Use BIGINT for 64-bit timestamps
                            UNIQUE(user_id, platform)
                        )
                        """
                    )
                    # Index for fast lookups by Zoom ID
                    await conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_integrations_platform_id ON INTEGRATIONS(platform, platform_user_id);"
                    )
                    # Create MEETINGS table
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS MEETINGS (
                            id TEXT PRIMARY KEY,
                            integration_id INTEGER REFERENCES INTEGRATIONS(id) ON DELETE SET NULL,
                            passcode TEXT,
                            platform TEXT,
                            readable_id TEXT, -- e.g., Zoom meeting ID
                            meeting_time TIMESTAMPTZ, -- Use TIMESTAMP WITH TIME ZONE
                            join_url TEXT,
                            UNIQUE(platform, readable_id)
                        )
                        """
                    )
                    # Create TRANSCRIPTS table
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TRANSCRIPTS (
                            meeting_id TEXT PRIMARY KEY REFERENCES MEETINGS(id) ON DELETE CASCADE,
                            file_name TEXT,
                            creation_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                        )
                        """
                    )

            logger.info("Database pool initialized successfully and schema verified.")
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}", exc_info=True)
            DB_POOL = None
            raise


# =====================
# SQL QUERY DEFINITIONS
# =====================

# --- USERS ---
SQL_UPSERT_USER = """
INSERT INTO USERS (id, name, email)
VALUES ($1, $2, $3)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email;
"""
SQL_GET_USER_BY_ID = "SELECT * FROM USERS WHERE id = $1;"

# TENANTS
SQL_GET_TENANT_AUTH_BY_ID = """
SELECT tenant_id, client_id, client_secret_encrypted
FROM TENANTS
WHERE tenant_id = $1;
"""

SQL_INSERT_TENANT = """
INSERT INTO TENANTS (tenant_id, domain, client_id, client_secret_encrypted, organization_name)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT(tenant_id) DO UPDATE SET
    domain = excluded.domain,
    client_id = excluded.client_id,
    client_secret_encrypted = excluded.client_secret_encrypted,
    organization_name = excluded.organization_name;
"""

SQL_GET_TENANT_BY_DOMAIN = """
SELECT tenant_id, client_id, client_secret_encrypted
FROM TENANTS
WHERE domain = $1;
"""

SQL_GET_TENANT_BY_ID = """
SELECT 
    tenant_id, 
    domain, 
    client_id, 
    organization_name, 
    (client_secret_encrypted IS NOT NULL AND client_secret_encrypted != '') as has_secret
FROM TENANTS
WHERE tenant_id = $1;
"""

SQL_GET_ALL_TENANTS = """
SELECT 
    tenant_id, 
    domain, 
    client_id, 
    organization_name, 
    (client_secret_encrypted IS NOT NULL AND client_secret_encrypted != '') as has_secret
FROM TENANTS;
"""

SQL_DELETE_TENANT_BY_ID = """
DELETE FROM TENANTS WHERE tenant_id = $1;
"""

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

# Insert a new meeting. If it already exists (based on UUID), do nothing.
SQL_INSERT_MEETING = """
INSERT INTO MEETINGS (id, integration_id, passcode, platform, readable_id, meeting_time, join_url)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT(id) DO NOTHING;
"""

# Get a meeting by its UUID
SQL_GET_MEETING_BY_ID = "SELECT * FROM MEETINGS WHERE id = $1;"

# Find a meeting by its platform-specific readable ID
SQL_GET_MEETING_BY_READABLE_ID = """
SELECT id FROM MEETINGS WHERE platform = $1 AND readable_id = $2;
"""
# Get a meeting by Join URL
# NOTE: Use LIKE to match partial URLs
SQL_GET_MEETING_BY_JOIN_URL = """
SELECT m.id
FROM MEETINGS m
WHERE m.join_url LIKE '%' || $1;
"""

# Get meeting UUID and passcode by readable ID
SQL_GET_MEETING_AUTH_BY_READABLE_ID = """
SELECT m.id, m.passcode
FROM MEETINGS m
WHERE m.platform = $1 AND m.readable_id = $2;
"""

# Get all meetings for a specific user (by joining through integrations)
SQL_GET_MEETINGS_BY_USER_ID = """
SELECT m.*
FROM MEETINGS m
JOIN INTEGRATIONS i ON m.integration_id = i.id
WHERE i.user_id = $1;
"""


# --- TRANSCRIPTS ---
SQL_INSERT_TRANSCRIPT = """
INSERT INTO TRANSCRIPTS (meeting_id, file_name)
VALUES ($1, $2);
"""
SQL_GET_TRANSCRIPT_BY_MEETING_ID = """
SELECT file_name, creation_date FROM TRANSCRIPTS WHERE meeting_id = $1;
"""
