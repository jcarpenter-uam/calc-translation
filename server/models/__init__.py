from .calendar_events import CalendarEvent
from .integrations import Integration
from .meetings import Meeting
from .reviews import Review
from .summaries import Summary
from .tenants import Tenant, TenantAuthConfig, TenantDomain
from .transcripts import Transcript
from .users import User

# Compatibility patch for databases created before translation columns were added.
POST_CREATE_STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_tour_completed BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS translation_type TEXT DEFAULT 'one_way'",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS translation_language_a TEXT",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS translation_language_b TEXT",
    """
    DO $$
    BEGIN
        IF to_regclass('reviews') IS NOT NULL THEN
            ALTER TABLE reviews DROP CONSTRAINT IF EXISTS ck_reviews_rating_range;
            ALTER TABLE reviews ADD CONSTRAINT ck_reviews_rating_range CHECK (rating >= 1 AND rating <= 5);
        END IF;
    END $$;
    """,
]

__all__ = [
    "CalendarEvent",
    "Integration",
    "Meeting",
    "Review",
    "Summary",
    "Tenant",
    "TenantAuthConfig",
    "TenantDomain",
    "Transcript",
    "User",
    "POST_CREATE_STATEMENTS",
]
