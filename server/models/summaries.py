from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text, UniqueConstraint, text

from core.orm import Base


class Summary(Base):
    __tablename__ = "summaries"
    __table_args__ = (
        UniqueConstraint("meeting_id", "language_code", name="uq_summaries_meeting_language"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    meeting_id = Column(Text, ForeignKey("meetings.id", ondelete="CASCADE"))
    language_code = Column(Text, nullable=False)
    file_name = Column(Text, nullable=False)
    creation_date = Column(DateTime(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP"))
