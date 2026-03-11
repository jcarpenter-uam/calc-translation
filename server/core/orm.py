from typing import AsyncGenerator

from core.config import settings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _to_sqlalchemy_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+asyncpg://", 1)
    return database_url


SQLALCHEMY_DATABASE_URL = _to_sqlalchemy_database_url(settings.DATABASE_URL)

engine: AsyncEngine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_orm() -> None:
    import models

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for statement in models.POST_CREATE_STATEMENTS:
            await conn.execute(text(statement))


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
