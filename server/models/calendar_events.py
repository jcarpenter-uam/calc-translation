from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import JSONB

from core.orm import Base


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (Index("idx_calendar_user_time", "user_id", "start_time"),)

    id = Column(Text, primary_key=True)
    user_id = Column(Text, ForeignKey("users.id", ondelete="CASCADE"))
    subject = Column(Text)
    body_content = Column(Text)
    start_time = Column(DateTime(timezone=True))
    end_time = Column(DateTime(timezone=True))
    location = Column(Text)
    join_url = Column(Text)
    web_link = Column(Text)
    organizer = Column(Text)
    is_cancelled = Column(Boolean, nullable=False, server_default="false")
    full_event_data = Column(JSONB)
