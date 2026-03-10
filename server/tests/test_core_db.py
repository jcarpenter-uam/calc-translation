import pytest

from core import db


@pytest.mark.asyncio
async def test_init_db_success(monkeypatch):
    called = {"n": 0}

    async def fake_init_orm():
        called["n"] += 1

    monkeypatch.setattr(db, "init_orm", fake_init_orm)

    await db.init_db()
    assert called["n"] == 1


@pytest.mark.asyncio
async def test_init_db_failure_reraises(monkeypatch):
    async def fake_init_orm():
        raise RuntimeError("db boom")

    monkeypatch.setattr(db, "init_orm", fake_init_orm)

    with pytest.raises(RuntimeError):
        await db.init_db()
