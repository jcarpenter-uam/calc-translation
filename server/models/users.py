from sqlalchemy import Boolean, Column, Text

from core.orm import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Text, primary_key=True)
    name = Column(Text)
    email = Column(Text)
    language_code = Column(Text)
    is_admin = Column(Boolean, nullable=False, server_default="false")
