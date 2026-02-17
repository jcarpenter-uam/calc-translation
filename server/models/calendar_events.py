SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS CALENDAR_EVENTS (
        id TEXT PRIMARY KEY,
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
    """,
    "CREATE INDEX IF NOT EXISTS idx_calendar_user_time ON CALENDAR_EVENTS(user_id, start_time);",
]
