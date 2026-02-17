SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS SUMMARIES (
        id SERIAL PRIMARY KEY,
        meeting_id TEXT REFERENCES MEETINGS(id) ON DELETE CASCADE,
        language_code TEXT NOT NULL,
        file_name TEXT NOT NULL,
        creation_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (meeting_id, language_code)
    );
    """,
]
