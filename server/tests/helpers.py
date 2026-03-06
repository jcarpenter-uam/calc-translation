from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class FakeResult:
    scalar: object = None
    first_row: object = None
    all_rows: list | None = None
    scalars_rows: list | None = None
    rowcount: int = 1

    def scalar_one_or_none(self):
        return self.scalar

    def scalar_one(self):
        return self.scalar

    def first(self):
        return self.first_row

    def all(self):
        return self.all_rows or []

    def scalars(self):
        return FakeScalars(self.scalars_rows or [])

    def __iter__(self):
        return iter(self.all_rows or [])


class FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeSession:
    def __init__(self, results: list[FakeResult]):
        self._results = list(results)
        self.added = []
        self.committed = False
        self.flushed = False

    async def execute(self, _stmt):
        if not self._results:
            raise AssertionError("Unexpected query: no fake results left")
        return self._results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        for idx, obj in enumerate(self.added, start=1):
            if getattr(obj, "id", None) is None:
                setattr(obj, "id", idx)
            if getattr(obj, "created_at", None) is None:
                setattr(obj, "created_at", datetime.now(timezone.utc))
        self.flushed = True

    async def commit(self):
        self.committed = True


class FakeSessionContext:
    def __init__(self, session: FakeSession):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def fake_session_local(*results: FakeResult):
    session = FakeSession(list(results))

    def _factory():
        return FakeSessionContext(session)

    _factory.session = session
    return _factory
