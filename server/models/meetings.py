SCHEMA_STATEMENTS = [
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
        language_hints TEXT[] DEFAULT '{}',
        translation_type TEXT DEFAULT 'one_way',
        translation_language_a TEXT,
        translation_language_b TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_meetings_readable ON MEETINGS(platform, readable_id);",
    "CREATE INDEX IF NOT EXISTS idx_meetings_started_at ON MEETINGS(started_at);",
]
