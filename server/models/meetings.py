from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import ARRAY

from core.orm import Base


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        Index("idx_meetings_readable", "platform", "readable_id"),
        Index("idx_meetings_started_at", "started_at"),
    )

    id = Column(Text, primary_key=True)
    integration_id = Column(Integer, ForeignKey("integrations.id", ondelete="SET NULL"))
    passcode = Column(Text)
    platform = Column(Text)
    readable_id = Column(Text)
    meeting_time = Column(DateTime(timezone=True))
    join_url = Column(Text)
    topic = Column(Text)
    started_at = Column(DateTime(timezone=True))
    ended_at = Column(DateTime(timezone=True))
    attendees = Column(ARRAY(Text), nullable=False, server_default="{}")
    language_hints = Column(ARRAY(Text), nullable=False, server_default="{}")
    translation_type = Column(Text, nullable=False, server_default="one_way")
    translation_language_a = Column(Text)
    translation_language_b = Column(Text)
