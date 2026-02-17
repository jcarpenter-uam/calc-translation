SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS USERS (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        language_code TEXT,
        is_admin BOOLEAN DEFAULT FALSE
    )
    """,
]
