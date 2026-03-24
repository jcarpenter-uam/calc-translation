from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from api import bug_reports
from tests.helpers import FakeResult, fake_session_local


class CapturingSession:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    async def execute(self, stmt):
        self.statements.append(str(stmt))
        sql = self.statements[-1].lower()
        filtered_rows = self.rows
        if "bug_reports.is_resolved" in sql and "false" in sql:
            filtered_rows = [row for row in self.rows if row[0].is_resolved is False]
        elif "bug_reports.is_resolved" in sql and "true" in sql:
            filtered_rows = [row for row in self.rows if row[0].is_resolved is True]
        return FakeResult(all_rows=filtered_rows)


class CapturingSessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class SessionFactory:
    def __init__(self, session):
        self.session = session

    def __call__(self):
        return CapturingSessionContext(self.session)


def capturing_session_local(rows):
    session = CapturingSession(rows)
    return SessionFactory(session)


def _endpoint(path: str, method: str):
    router = bug_reports.create_bug_report_router()
    method = method.upper()
    return next(
        r.endpoint
        for r in router.routes
        if r.path == path and method in getattr(r, "methods", set())
    )


@pytest.mark.asyncio
async def test_submit_bug_report_requires_sub():
    endpoint = _endpoint("/api/bug-reports/", "POST")

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(title="Bug", description="Desc", payload={})

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_submit_bug_report_requires_existing_user(monkeypatch):
    monkeypatch.setattr(
        bug_reports,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=None)),
    )

    endpoint = _endpoint("/api/bug-reports/", "POST")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(title="Bug", description="Desc", payload={"sub": "u1"})

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_submit_bug_report_persists_and_writes_log(monkeypatch, tmp_path):
    fake_local = fake_session_local(FakeResult(scalar="u1"))
    monkeypatch.setattr(bug_reports, "AsyncSessionLocal", fake_local)
    monkeypatch.setattr(bug_reports, "BUG_REPORTS_DIR", tmp_path)

    endpoint = _endpoint("/api/bug-reports/", "POST")
    upload = UploadFile(filename="desktop-main.log", file=BytesIO(b"hello log\n"))
    result = await endpoint(
        title="  Title ",
        description="  Description ",
        steps_to_reproduce="step 1",
        expected_behavior="expected",
        actual_behavior="actual",
        app_version="2.0.4",
        platform="win32",
        main_log=upload,
        payload={"sub": "u1"},
    )

    report = getattr(fake_local, "session").added[0]
    assert result.id == 1
    assert report.title == "Title"
    assert report.description == "Description"
    assert report.log_file_name == "desktop-main.log"
    assert (tmp_path / "1" / "desktop-main.log").read_text(encoding="utf-8") == "hello log\n"


@pytest.mark.asyncio
async def test_get_all_bug_reports_maps_join_rows(monkeypatch):
    now = datetime.now(timezone.utc)
    rows = [
        (
            SimpleNamespace(
                id=1,
                user_id="u1",
                title="Crash",
                description="It broke",
                steps_to_reproduce="1. click",
                expected_behavior="open",
                actual_behavior="closed",
                app_version="2.0.4",
                platform="linux",
                log_file_name="main.log",
                is_resolved=False,
                created_at=now,
            ),
            "Alice",
            "a@example.com",
        )
    ]
    monkeypatch.setattr(
        bug_reports,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(all_rows=rows)),
    )

    endpoint = _endpoint("/api/bug-reports/", "GET")
    result = await endpoint()

    assert len(result) == 1
    assert result[0].user_name == "Alice"
    assert result[0].has_log_file is True
    assert result[0].is_resolved is False


@pytest.mark.asyncio
async def test_get_all_bug_reports_filters_open(monkeypatch):
    now = datetime.now(timezone.utc)
    rows = [
        (
            SimpleNamespace(id=1, user_id="u1", title="Open", description="x", steps_to_reproduce=None, expected_behavior=None, actual_behavior=None, app_version=None, platform=None, log_file_name=None, is_resolved=False, created_at=now),
            "Alice",
            "a@example.com",
        ),
        (
            SimpleNamespace(id=2, user_id="u2", title="Resolved", description="y", steps_to_reproduce=None, expected_behavior=None, actual_behavior=None, app_version=None, platform=None, log_file_name=None, is_resolved=True, created_at=now),
            "Bob",
            "b@example.com",
        ),
    ]
    fake_local = capturing_session_local(rows)
    monkeypatch.setattr(bug_reports, "AsyncSessionLocal", fake_local)

    endpoint = _endpoint("/api/bug-reports/", "GET")
    result = await endpoint(status="open")

    assert [report.id for report in result] == [1]


@pytest.mark.asyncio
async def test_get_all_bug_reports_filters_resolved(monkeypatch):
    now = datetime.now(timezone.utc)
    rows = [
        (
            SimpleNamespace(id=1, user_id="u1", title="Open", description="x", steps_to_reproduce=None, expected_behavior=None, actual_behavior=None, app_version=None, platform=None, log_file_name=None, is_resolved=False, created_at=now),
            "Alice",
            "a@example.com",
        ),
        (
            SimpleNamespace(id=2, user_id="u2", title="Resolved", description="y", steps_to_reproduce=None, expected_behavior=None, actual_behavior=None, app_version=None, platform=None, log_file_name=None, is_resolved=True, created_at=now),
            "Bob",
            "b@example.com",
        ),
    ]
    fake_local = capturing_session_local(rows)
    monkeypatch.setattr(bug_reports, "AsyncSessionLocal", fake_local)

    endpoint = _endpoint("/api/bug-reports/", "GET")
    result = await endpoint(status="resolved")

    assert [report.id for report in result] == [2]


@pytest.mark.asyncio
async def test_set_bug_report_resolved_updates_report(monkeypatch):
    now = datetime.now(timezone.utc)
    initial_row = (
        SimpleNamespace(
            id=3,
            user_id="u1",
            title="Crash",
            description="It broke",
            steps_to_reproduce=None,
            expected_behavior=None,
            actual_behavior=None,
            app_version="2.0.4",
            platform="linux",
            log_file_name="main.log",
            is_resolved=False,
            created_at=now,
        ),
        "Alice",
        "a@example.com",
    )
    updated_row = (
        SimpleNamespace(
            id=3,
            user_id="u1",
            title="Crash",
            description="It broke",
            steps_to_reproduce=None,
            expected_behavior=None,
            actual_behavior=None,
            app_version="2.0.4",
            platform="linux",
            log_file_name="main.log",
            is_resolved=True,
            created_at=now,
        ),
        "Alice",
        "a@example.com",
    )
    fake_local = fake_session_local(
        FakeResult(first_row=initial_row),
        FakeResult(),
        FakeResult(first_row=updated_row),
    )
    monkeypatch.setattr(bug_reports, "AsyncSessionLocal", fake_local)

    endpoint = _endpoint("/api/bug-reports/{report_id}/resolve", "PATCH")
    result = await endpoint(
        report_id=3,
        payload=bug_reports.BugReportResolveRequest(is_resolved=True),
    )

    assert result.is_resolved is True


@pytest.mark.asyncio
async def test_get_bug_report_log_reads_saved_file(monkeypatch, tmp_path):
    row = SimpleNamespace(id=7, log_file_name="main.log")
    monkeypatch.setattr(
        bug_reports,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=row)),
    )
    monkeypatch.setattr(bug_reports, "BUG_REPORTS_DIR", tmp_path)
    report_dir = tmp_path / "7"
    report_dir.mkdir(parents=True)
    (report_dir / "main.log").write_text("line 1\nline 2\n", encoding="utf-8")

    endpoint = _endpoint("/api/bug-reports/{report_id}/log", "GET")
    result = await endpoint(report_id=7)

    assert "line 1" in result


@pytest.mark.asyncio
async def test_get_bug_report_log_404_when_missing(monkeypatch):
    row = SimpleNamespace(id=7, log_file_name="main.log")
    monkeypatch.setattr(
        bug_reports,
        "AsyncSessionLocal",
        fake_session_local(FakeResult(scalar=row)),
    )

    endpoint = _endpoint("/api/bug-reports/{report_id}/log", "GET")
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(report_id=7)

    assert exc_info.value.status_code == 404
