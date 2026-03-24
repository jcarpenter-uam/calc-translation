import logging
import os
from datetime import datetime
from pathlib import Path
from typing import List

from core.authentication import get_admin_user_payload, get_current_user_payload
from core.db import AsyncSessionLocal
from core.logging_setup import log_step
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from models.bug_reports import BugReport
from models.users import User
from pydantic import BaseModel
from sqlalchemy import select, update

logger = logging.getLogger(__name__)

BUG_REPORTS_DIR = Path("output") / "bug-reports"
MAX_LOG_UPLOAD_BYTES = 2 * 1024 * 1024


class BugReportCreateResponse(BaseModel):
    id: int
    created_at: datetime


class AdminBugReportResponse(BaseModel):
    id: int
    user_id: str
    user_name: str | None
    user_email: str | None
    title: str
    description: str
    steps_to_reproduce: str | None
    expected_behavior: str | None
    actual_behavior: str | None
    app_version: str | None
    platform: str | None
    has_log_file: bool
    is_resolved: bool
    created_at: datetime


class BugReportResolveRequest(BaseModel):
    is_resolved: bool


def _bug_report_log_path(report_id: int, file_name: str | None) -> Path | None:
    if not file_name:
        return None
    return BUG_REPORTS_DIR / str(report_id) / file_name


def create_bug_report_router() -> APIRouter:
    router = APIRouter(prefix="/api/bug-reports")
    log_step_name = "API-BUG-REPORTS"

    @router.post("/", response_model=BugReportCreateResponse)
    async def submit_bug_report(
        title: str = Form(...),
        description: str = Form(...),
        steps_to_reproduce: str = Form(""),
        expected_behavior: str = Form(""),
        actual_behavior: str = Form(""),
        app_version: str = Form(""),
        platform: str = Form(""),
        main_log: UploadFile | None = File(default=None),
        payload: dict = Depends(get_current_user_payload),
    ):
        with log_step(log_step_name):
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid auth token payload")

            clean_title = title.strip()
            clean_description = description.strip()
            if not clean_title:
                raise HTTPException(status_code=422, detail="Title is required.")
            if not clean_description:
                raise HTTPException(status_code=422, detail="Description is required.")

            async with AsyncSessionLocal() as session:
                user_result = await session.execute(select(User.id).where(User.id == user_id))
                if not user_result.scalar_one_or_none():
                    raise HTTPException(status_code=404, detail="User not found.")

                report = BugReport(
                    user_id=user_id,
                    title=clean_title,
                    description=clean_description,
                    steps_to_reproduce=steps_to_reproduce.strip() or None,
                    expected_behavior=expected_behavior.strip() or None,
                    actual_behavior=actual_behavior.strip() or None,
                    app_version=app_version.strip() or None,
                    platform=platform.strip() or None,
                )
                session.add(report)
                await session.flush()

                if main_log is not None:
                    raw_bytes = await main_log.read()
                    if len(raw_bytes) > MAX_LOG_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="Attached log file is too large.")

                    safe_name = os.path.basename(main_log.filename or "main.log")
                    report_dir = BUG_REPORTS_DIR / str(report.id)
                    report_dir.mkdir(parents=True, exist_ok=True)
                    log_path = report_dir / safe_name
                    log_path.write_bytes(raw_bytes)
                    report.log_file_name = safe_name

                await session.commit()

            return BugReportCreateResponse(id=report.id, created_at=report.created_at)

    @router.get(
        "/",
        response_model=List[AdminBugReportResponse],
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_all_bug_reports(status: str = Query("open", pattern="^(open|resolved|all)$")):
        with log_step(log_step_name):
            stmt = (
                select(BugReport, User.name, User.email)
                .join(User, User.id == BugReport.user_id, isouter=True)
                .order_by(BugReport.created_at.desc())
            )
            if status == "open":
                stmt = stmt.where(BugReport.is_resolved.is_(False))
            elif status == "resolved":
                stmt = stmt.where(BugReport.is_resolved.is_(True))

            async with AsyncSessionLocal() as session:
                result = await session.execute(stmt)
                rows = result.all()

            return [
                AdminBugReportResponse(
                    id=report.id,
                    user_id=report.user_id,
                    user_name=user_name,
                    user_email=user_email,
                    title=report.title,
                    description=report.description,
                    steps_to_reproduce=report.steps_to_reproduce,
                    expected_behavior=report.expected_behavior,
                    actual_behavior=report.actual_behavior,
                    app_version=report.app_version,
                    platform=report.platform,
                    has_log_file=bool(report.log_file_name),
                    is_resolved=bool(report.is_resolved),
                    created_at=report.created_at,
                )
                for report, user_name, user_email in rows
            ]

    @router.patch(
        "/{report_id}/resolve",
        response_model=AdminBugReportResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def set_bug_report_resolved(report_id: int, payload: BugReportResolveRequest):
        with log_step(log_step_name):
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(BugReport, User.name, User.email)
                    .join(User, User.id == BugReport.user_id, isouter=True)
                    .where(BugReport.id == report_id)
                )
                row = result.first()

                if not row:
                    raise HTTPException(status_code=404, detail="Bug report not found.")

                await session.execute(
                    update(BugReport)
                    .where(BugReport.id == report_id)
                    .values(is_resolved=payload.is_resolved)
                )
                await session.commit()

                updated_result = await session.execute(
                    select(BugReport, User.name, User.email)
                    .join(User, User.id == BugReport.user_id, isouter=True)
                    .where(BugReport.id == report_id)
                )
                updated_row = updated_result.first()

            if not updated_row:
                raise HTTPException(status_code=404, detail="Bug report not found.")

            report, user_name, user_email = updated_row
            return AdminBugReportResponse(
                id=report.id,
                user_id=report.user_id,
                user_name=user_name,
                user_email=user_email,
                title=report.title,
                description=report.description,
                steps_to_reproduce=report.steps_to_reproduce,
                expected_behavior=report.expected_behavior,
                actual_behavior=report.actual_behavior,
                app_version=report.app_version,
                platform=report.platform,
                has_log_file=bool(report.log_file_name),
                is_resolved=bool(report.is_resolved),
                created_at=report.created_at,
            )

    @router.get(
        "/{report_id}/log",
        response_class=PlainTextResponse,
        dependencies=[Depends(get_admin_user_payload)],
    )
    async def get_bug_report_log(report_id: int):
        with log_step(log_step_name):
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(BugReport).where(BugReport.id == report_id)
                )
                report = result.scalar_one_or_none()

            if not report:
                raise HTTPException(status_code=404, detail="Bug report not found.")

            log_path = _bug_report_log_path(report.id, report.log_file_name)
            if not log_path or not log_path.exists():
                raise HTTPException(status_code=404, detail="Bug report log not found.")

            try:
                return log_path.read_text(encoding="utf-8", errors="ignore")
            except Exception as exc:
                logger.error("Failed to read bug report log %s: %s", report_id, exc)
                raise HTTPException(status_code=500, detail="Could not read bug report log")

    return router
