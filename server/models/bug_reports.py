from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, Text, text

from core.orm import Base


class BugReport(Base):
    __tablename__ = "bug_reports"
    __table_args__ = (
        Index("idx_bug_reports_user_id", "user_id"),
        Index("idx_bug_reports_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    steps_to_reproduce = Column(Text, nullable=True)
    expected_behavior = Column(Text, nullable=True)
    actual_behavior = Column(Text, nullable=True)
    app_version = Column(Text, nullable=True)
    platform = Column(Text, nullable=True)
    log_file_name = Column(Text, nullable=True)
    is_resolved = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
