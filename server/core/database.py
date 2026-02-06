import asyncio
import logging

import asyncpg
from core.config import settings
from core.logging_setup import log_step

logger = logging.getLogger(__name__)

LOG_STEP = "DATABASE"

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
            with log_step(LOG_STEP):
                logger.info("Database pool already initialized.")
                return

        try:
            DB_POOL = await asyncpg.create_pool(dsn=POSTGRES_DSN)
            async with DB_POOL.acquire() as conn:
                async with conn.transaction():

                    # Users
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS USERS (
                            id TEXT PRIMARY KEY,
                            name TEXT,
                            email TEXT,
                            language_code TEXT,
                            is_admin BOOLEAN DEFAULT FALSE
                        )
                        """
                    )

                    # Tenant Domains
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TENANT_DOMAINS (
                            domain TEXT PRIMARY KEY,
                            tenant_id TEXT REFERENCES TENANTS(tenant_id) ON DELETE CASCADE,
                            provider_type TEXT
                        )
                        """
                    )

                    # Tenant Auth Configs
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS TENANT_AUTH_CONFIGS (
                            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                            tenant_id TEXT REFERENCES TENANTS(tenant_id) ON DELETE CASCADE,
                            provider_type TEXT NOT NULL, -- 'microsoft' or 'google'
                            client_id TEXT NOT NULL,
                            client_secret_encrypted TEXT NOT NULL,
                            tenant_hint TEXT, -- Stores Entra Tenant ID or Google Customer ID
                            UNIQUE(tenant_id, provider_type)
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
                            topic TEXT,
                            started_at TIMESTAMPTZ,
                            ended_at TIMESTAMPTZ,
                            attendees TEXT[] DEFAULT '{}',
                            language_hints TEXT[] DEFAULT '{}'
                        )
                        """
                    )
                    await conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_meetings_readable ON MEETINGS(platform, readable_id);"
                    )
                    await conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON MEETINGS(started_at);"
                    )

                    # Calendar Events
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS CALENDAR_EVENTS (
                            id TEXT PRIMARY KEY, -- Microsoft Event ID
                            user_id TEXT REFERENCES USERS(id) ON DELETE CASCADE,
                            subject TEXT,
                            body_content TEXT,
                            start_time TIMESTAMPTZ,
                            end_time TIMESTAMPTZ,
                            location TEXT,
                            join_url TEXT,
                            web_link TEXT,
                            organizer TEXT,
                            is_cancelled BOOLEAN DEFAULT FALSE,
                            full_event_data JSONB
                        )
                        """
                    )
                    await conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_calendar_user_time ON CALENDAR_EVENTS(user_id, start_time);"
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

                    # Summaries
                    await conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS SUMMARIES (
                            id SERIAL PRIMARY KEY,
                            meeting_id TEXT REFERENCES MEETINGS(id) ON DELETE CASCADE,
                            language_code TEXT NOT NULL,
                            file_name TEXT NOT NULL,
                            creation_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE (meeting_id, language_code)
                        );
                        """
                    )

            with log_step(LOG_STEP):
                logger.info(
                    "Database pool initialized successfully and schema verified."
                )
        except Exception as e:
            with log_step(LOG_STEP):
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
SQL_GET_USER_ID_BY_EMAIL = "SELECT id FROM USERS WHERE email = $1"

# --- TENANTS ---

SQL_INSERT_TENANT_BASE = """
INSERT INTO TENANTS (tenant_id, organization_name)
VALUES ($1, $2)
ON CONFLICT (tenant_id) DO UPDATE SET organization_name = EXCLUDED.organization_name;
"""

SQL_INSERT_TENANT_AUTH = """
INSERT INTO TENANT_AUTH_CONFIGS (tenant_id, provider_type, client_id, client_secret_encrypted, tenant_hint)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (tenant_id, provider_type) DO UPDATE SET
    client_id = EXCLUDED.client_id,
    client_secret_encrypted = EXCLUDED.client_secret_encrypted,
    tenant_hint = EXCLUDED.tenant_hint;
"""

SQL_INSERT_DOMAIN = """
INSERT INTO TENANT_DOMAINS (domain, tenant_id, provider_type)
VALUES ($1, $2, $3)
ON CONFLICT(domain) DO UPDATE SET 
    tenant_id = excluded.tenant_id,
    provider_type = excluded.provider_type;
"""

SQL_GET_TENANT_BY_DOMAIN = """
SELECT 
    t.tenant_id, 
    ac.provider_type, 
    ac.client_id, 
    ac.client_secret_encrypted,
    ac.tenant_hint,
    td.provider_type as pinned_provider
FROM TENANT_DOMAINS td
JOIN TENANTS t ON td.tenant_id = t.tenant_id
JOIN TENANT_AUTH_CONFIGS ac ON t.tenant_id = ac.tenant_id
WHERE td.domain = $1;
"""

SQL_GET_TENANT_BY_ID = """
WITH 
domains_agg AS (
    SELECT tenant_id, 
           jsonb_agg(
               jsonb_build_object('domain', domain, 'provider', provider_type)
               ORDER BY domain
           ) AS domains
    FROM TENANT_DOMAINS 
    GROUP BY tenant_id
),
auth_agg AS (
    SELECT tenant_id, 
           jsonb_object_agg(provider_type, jsonb_build_object(
               'client_id', client_id,
               'has_secret', (client_secret_encrypted IS NOT NULL),
               'tenant_hint', tenant_hint
           )) AS auth_methods
    FROM TENANT_AUTH_CONFIGS 
    GROUP BY tenant_id
)
SELECT 
    t.tenant_id, 
    t.organization_name,
    COALESCE(d.domains, '[]'::jsonb) AS domains,
    a.auth_methods
FROM TENANTS t
LEFT JOIN domains_agg d ON t.tenant_id = d.tenant_id
LEFT JOIN auth_agg a ON t.tenant_id = a.tenant_id
WHERE t.tenant_id = $1;
"""

SQL_GET_ALL_TENANTS = """
WITH 
domains_agg AS (
    SELECT tenant_id, 
           jsonb_agg(
               jsonb_build_object('domain', domain, 'provider', provider_type)
               ORDER BY domain
           ) AS domains
    FROM TENANT_DOMAINS 
    GROUP BY tenant_id
),
auth_agg AS (
    SELECT tenant_id, 
           jsonb_object_agg(provider_type, jsonb_build_object(
               'client_id', client_id,
               'has_secret', (client_secret_encrypted IS NOT NULL),
               'tenant_hint', tenant_hint
           )) AS auth_methods
    FROM TENANT_AUTH_CONFIGS 
    GROUP BY tenant_id
)
SELECT 
    t.tenant_id, 
    t.organization_name,
    COALESCE(d.domains, '[]'::jsonb) AS domains,
    a.auth_methods
FROM TENANTS t
LEFT JOIN domains_agg d ON t.tenant_id = d.tenant_id
LEFT JOIN auth_agg a ON t.tenant_id = a.tenant_id;
"""

SQL_DELETE_TENANT_BY_ID = "DELETE FROM TENANTS WHERE tenant_id = $1;"
SQL_DELETE_DOMAINS_BY_TENANT_ID = "DELETE FROM TENANT_DOMAINS WHERE tenant_id = $1;"

SQL_DELETE_TENANT_AUTH_CONFIG = """
DELETE FROM TENANT_AUTH_CONFIGS 
WHERE tenant_id = $1 AND provider_type = $2
"""

SQL_COUNT_TENANT_AUTH_CONFIGS = """
SELECT COUNT(*) FROM TENANT_AUTH_CONFIGS 
WHERE tenant_id = $1
"""

SQL_UNPIN_DOMAINS_BY_PROVIDER = """
UPDATE TENANT_DOMAINS
SET provider_type = NULL
WHERE tenant_id = $1 AND provider_type = $2;
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

SQL_INSERT_MEETING = """
INSERT INTO MEETINGS (id, integration_id, passcode, platform, readable_id, meeting_time, join_url, topic, language_hints)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT(id) DO NOTHING;
"""

SQL_GET_MEETING_BY_ID = "SELECT * FROM MEETINGS WHERE id = $1;"

SQL_GET_MEETING_BY_READABLE_ID = """
SELECT id FROM MEETINGS 
WHERE platform = $1 AND readable_id = $2
ORDER BY started_at DESC
LIMIT 1;
"""

SQL_GET_MEETING_BY_JOIN_URL = """
SELECT m.id
FROM MEETINGS m
WHERE m.join_url LIKE '%' || $1
ORDER BY started_at DESC
LIMIT 1;
"""

SQL_GET_MEETING_AUTH_BY_READABLE_ID = """
SELECT m.id, m.passcode
FROM MEETINGS m
WHERE m.platform = $1 AND m.readable_id = $2
ORDER BY started_at DESC
LIMIT 1;
"""

SQL_GET_MEETINGS_BY_USER_ID = """
SELECT m.*
FROM MEETINGS m
JOIN INTEGRATIONS i ON m.integration_id = i.id
WHERE i.user_id = $1;
"""

SQL_UPDATE_MEETING_START = "UPDATE MEETINGS SET started_at = $1 WHERE id = $2;"
SQL_UPDATE_MEETING_END = "UPDATE MEETINGS SET ended_at = $1 WHERE id = $2;"

SQL_GET_LATEST_ACTIVE_SIBLING = """
SELECT id 
FROM MEETINGS 
WHERE readable_id = $1 
  AND platform = $2 
  AND id != $3 
  AND started_at IS NOT NULL 
ORDER BY started_at DESC 
LIMIT 1;
"""

SQL_ADD_MEETING_ATTENDEE = """
UPDATE MEETINGS
SET attendees = array_append(COALESCE(attendees, '{}'), $1)
WHERE id = $2
  AND ($1 <> ALL(COALESCE(attendees, '{}'))); 
"""

SQL_GET_MEETING_ATTENDEES_DETAILS = """
SELECT u.email, u.language_code
FROM USERS u
JOIN MEETINGS m ON u.id = ANY(m.attendees)
WHERE m.id = $1;
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

# --- CALENDAR EVENTS ---

SQL_UPSERT_CALENDAR_EVENT = """
INSERT INTO CALENDAR_EVENTS (
    id, user_id, subject, body_content, start_time, end_time, location, 
    join_url, web_link, organizer, is_cancelled, full_event_data
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
ON CONFLICT (id) DO UPDATE SET
    subject = excluded.subject,
    body_content = excluded.body_content,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    location = excluded.location,
    join_url = excluded.join_url,
    web_link = excluded.web_link,
    organizer = excluded.organizer,
    is_cancelled = excluded.is_cancelled,
    full_event_data = excluded.full_event_data;
"""

SQL_GET_CALENDAR_EVENTS_BY_USER_ID = """
SELECT * FROM CALENDAR_EVENTS 
WHERE user_id = $1
AND start_time >= CURRENT_DATE - INTERVAL '1 day'
ORDER BY start_time ASC;
"""

SQL_GET_CALENDAR_EVENTS_FILTERED = """
SELECT * FROM CALENDAR_EVENTS 
WHERE user_id = $1
AND ($2::timestamptz IS NULL OR start_time >= $2)
AND ($3::timestamptz IS NULL OR start_time <= $3)
ORDER BY start_time ASC;
"""

# --- SUMMARIES ---

SQL_INSERT_SUMMARY = """
INSERT INTO SUMMARIES (meeting_id, language_code, file_name)
VALUES ($1, $2, $3)
ON CONFLICT (meeting_id, language_code) 
DO UPDATE SET 
    file_name = excluded.file_name,
    creation_date = CURRENT_TIMESTAMP;
"""

SQL_GET_SUMMARY_BY_MEETING_ID = """
SELECT file_name, creation_date 
FROM SUMMARIES 
WHERE meeting_id = $1 AND language_code = $2;
"""
