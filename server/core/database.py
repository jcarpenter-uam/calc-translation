import asyncio
import logging

import aiosqlite

logger = logging.getLogger(__name__)

DB_PATH = "data.db"

db_lock = asyncio.Lock()


async def init_db():
    """
    Initializes the database and creates tables if they don't exist.
    """
    async with db_lock:
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute("PRAGMA foreign_keys = ON")

                # Create USERS table
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS USERS (
                        id TEXT PRIMARY KEY, -- EntraID User ID
                        name TEXT,
                        email TEXT
                    )
                    """
                )

                # Create INTEGRATIONS table
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS INTEGRATIONS (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, -- integration_id
                        user_id TEXT,
                        platform TEXT,
                        access_token TEXT,
                        refresh_token TEXT,
                        expires_at INTEGER,
                        FOREIGN KEY (user_id) REFERENCES USERS(id) ON DELETE CASCADE,
                        UNIQUE(user_id, platform)
                    )
                    """
                )

                # Create MEETINGS table
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS MEETINGS (
                        id TEXT PRIMARY KEY,
                        integration_id INTEGER,
                        platform TEXT,
                        readable_id TEXT, -- e.g., Zoom meeting ID
                        meeting_time TIMESTAMP,
                        join_url TEXT,
                        FOREIGN KEY (integration_id) REFERENCES INTEGRATIONS(id) ON DELETE SET NULL,
                        UNIQUE(platform, readable_id)
                    )
                    """
                )

                # Create TRANSCRIPTS table
                await db.execute(
                    """
                    CREATE TABLE IF NOT EXISTS TRANSCRIPTS (
                        meeting_id TEXT PRIMARY KEY, -- FK to MEETINGS.id
                        file_name TEXT,
                        creation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (meeting_id) REFERENCES MEETINGS(id) ON DELETE CASCADE
                    )
                    """
                )

                await db.commit()
            logger.info(
                f"Database initialized successfully with new schema at {DB_PATH}"
            )
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}", exc_info=True)
            raise


# =====================
# SQL QUERY DEFINITIONS
# =====================

# --- USERS ---
SQL_UPSERT_USER = """
INSERT INTO USERS (id, name, email)
VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    email = excluded.email;
"""
SQL_GET_USER_BY_ID = "SELECT * FROM USERS WHERE id = ?;"


# --- INTEGRATIONS ---
SQL_UPSERT_INTEGRATION = """
INSERT INTO INTEGRATIONS (user_id, platform, access_token, refresh_token, expires_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id, platform) DO UPDATE SET
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at;
"""
SQL_GET_INTEGRATION = """
SELECT id, access_token, refresh_token, expires_at
FROM INTEGRATIONS
WHERE user_id = ? AND platform = ?;
"""
SQL_GET_INTEGRATIONS_BY_USER = "SELECT * FROM INTEGRATIONS WHERE user_id = ?;"
SQL_DELETE_INTEGRATION = "DELETE FROM INTEGRATIONS WHERE user_id = ? AND platform = ?;"


# --- MEETINGS ---

# Insert a new meeting. If it already exists (based on UUID), do nothing.
SQL_INSERT_MEETING = """
INSERT INTO MEETINGS (id, integration_id, platform, readable_id, meeting_time, join_url)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING;
"""

# Get a meeting by its UUID
SQL_GET_MEETING_BY_ID = "SELECT * FROM MEETINGS WHERE id = ?;"

# Find a meeting by its platform-specific readable ID
SQL_GET_MEETING_BY_READABLE_ID = """
SELECT id FROM MEETINGS WHERE platform = ? AND readable_id = ?;
"""

# Get all meetings for a specific user (by joining through integrations)
SQL_GET_MEETINGS_BY_USER_ID = """
SELECT m.*
FROM MEETINGS m
JOIN INTEGRATIONS i ON m.integration_id = i.id
WHERE i.user_id = ?;
"""


# --- TRANSCRIPTS ---
SQL_INSERT_TRANSCRIPT = """
INSERT INTO TRANSCRIPTS (meeting_id, file_name)
VALUES (?, ?);
"""
SQL_GET_TRANSCRIPT_BY_MEETING_ID = """
SELECT file_name, creation_date FROM TRANSCRIPTS WHERE meeting_id = ?;
"""
