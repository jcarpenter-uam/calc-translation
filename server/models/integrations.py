from sqlalchemy import BigInteger, Column, ForeignKey, Index, Integer, Text, UniqueConstraint

from core.orm import Base


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = (
        UniqueConstraint("user_id", "platform", name="uq_integration_user_platform"),
        Index("idx_integrations_platform_id", "platform", "platform_user_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Text, ForeignKey("users.id", ondelete="CASCADE"))
    platform = Column(Text)
    platform_user_id = Column(Text)
    access_token = Column(Text)
    refresh_token = Column(Text)
    expires_at = Column(BigInteger)
