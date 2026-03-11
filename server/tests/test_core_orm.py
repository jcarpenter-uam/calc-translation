import pytest

from core import orm


def test_to_sqlalchemy_database_url_variants():
    assert (
        orm._to_sqlalchemy_database_url("postgresql://u:p@h/db")
        == "postgresql+asyncpg://u:p@h/db"
    )
    assert (
        orm._to_sqlalchemy_database_url("postgres://u:p@h/db")
        == "postgresql+asyncpg://u:p@h/db"
    )
    assert (
        orm._to_sqlalchemy_database_url("postgresql+asyncpg://u:p@h/db")
        == "postgresql+asyncpg://u:p@h/db"
    )
    assert orm._to_sqlalchemy_database_url("sqlite:///tmp.db") == "sqlite:///tmp.db"


@pytest.mark.asyncio
async def test_get_db_session_yields_session(monkeypatch):
    class FakeSession:
        pass

    class FakeCtx:
        async def __aenter__(self):
            return FakeSession()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(orm, "AsyncSessionLocal", lambda: FakeCtx())

    agen = orm.get_db_session()
    session = await agen.__anext__()
    assert isinstance(session, FakeSession)

    with pytest.raises(StopAsyncIteration):
        await agen.__anext__()


@pytest.mark.asyncio
async def test_init_orm_runs_create_all_and_post_statements(monkeypatch):
    calls = {"create_all": 0, "statements": []}

    class FakeConn:
        async def run_sync(self, fn):
            fn(None)
            calls["create_all"] += 1

        async def execute(self, stmt):
            calls["statements"].append(str(stmt))

    class FakeBeginCtx:
        async def __aenter__(self):
            return FakeConn()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeEngine:
        def begin(self):
            return FakeBeginCtx()

    monkeypatch.setattr(orm, "engine", FakeEngine())
    monkeypatch.setattr(orm.Base.metadata, "create_all", lambda _conn: None)
    import models

    monkeypatch.setattr(models, "POST_CREATE_STATEMENTS", ["SELECT 1", "SELECT 2"])

    await orm.init_orm()
    assert calls["create_all"] == 1
    assert len(calls["statements"]) == 2
