from .calendar_events import CalendarEvent
from .integrations import Integration
from .meetings import Meeting
from .summaries import Summary
from .tenants import Tenant, TenantAuthConfig, TenantDomain
from .transcripts import Transcript
from .users import User

# Compatibility patch for databases created before translation columns were added.
POST_CREATE_STATEMENTS = [
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS translation_type TEXT DEFAULT 'one_way'",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS translation_language_a TEXT",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS translation_language_b TEXT",
]

__all__ = [
    "CalendarEvent",
    "Integration",
    "Meeting",
    "Summary",
    "Tenant",
    "TenantAuthConfig",
    "TenantDomain",
    "Transcript",
    "User",
    "POST_CREATE_STATEMENTS",
]
