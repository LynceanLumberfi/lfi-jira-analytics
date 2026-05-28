"""Ingest Playwright + Surefire HTML reports into Postgres.

Walks `data/s3/` (or a configured base dir), filters to files within the
last N days using the date embedded in the filename, dedupes by
`test_run.source_path`, parses each new file, and inserts one `test_run`
row plus its `test_case_result` children. Failures on a single file are
isolated — the run continues so one bad HTML doesn't kill the batch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.test_case_result import TestCaseResult
from app.models.test_run import TestRun
from app.services.test_report_parser import (
    FilenameInfo,
    parse_filename,
    parse_playwright,
    parse_surefire,
)


@dataclass
class IngestResult:
    runs_inserted: int = 0
    cases_inserted: int = 0
    skipped_existing: int = 0
    skipped_out_of_window: int = 0
    errors: list[tuple[str, str]] = field(default_factory=list)


ProgressFn = Callable[[str, str], None] | None  # (event, source_path)


def iter_report_files(base_dir: Path) -> Iterable[Path]:
    """Yield every report HTML under `data/s3/<bucket>/reports/...`."""
    for bucket in ("lumberfi-playwright-reports", "lumberfi-automation-reports"):
        bucket_dir = base_dir / bucket
        if not bucket_dir.exists():
            continue
        yield from bucket_dir.rglob("build-*.html")


def ingest_dir(
    session: Session,
    base_dir: Path,
    *,
    days: int = 10,
    dry_run: bool = False,
    reingest: bool = False,
    progress: ProgressFn = None,
) -> IngestResult:
    """Ingest all reports in `base_dir` whose filename date is within `days`.

    `base_dir` is the local `data/s3/` directory. `dry_run` skips writes
    but still parses and counts. `reingest` deletes the matching `test_run`
    (cascades to cases) before re-inserting.
    """
    result = IngestResult()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    existing_paths = _existing_source_paths(session)

    for absolute_path in sorted(iter_report_files(base_dir)):
        relative_path = absolute_path.relative_to(base_dir).as_posix()
        try:
            info = parse_filename(relative_path)
        except ValueError as exc:
            result.errors.append((relative_path, f"filename: {exc}"))
            continue

        if info.started_at < cutoff:
            result.skipped_out_of_window += 1
            if progress is not None:
                progress("out_of_window", relative_path)
            continue

        if relative_path in existing_paths:
            if reingest:
                _delete_run(session, relative_path)
            else:
                result.skipped_existing += 1
                if progress is not None:
                    progress("skipped_existing", relative_path)
                continue

        try:
            run_dict, cases = _parse_report(absolute_path, info)
        except Exception as exc:  # parser failures are isolated
            result.errors.append((relative_path, f"parse: {exc}"))
            if progress is not None:
                progress("parse_error", relative_path)
            continue

        if dry_run:
            result.runs_inserted += 1
            result.cases_inserted += len(cases)
            if progress is not None:
                progress("would_insert", relative_path)
            continue

        try:
            _persist(session, run_dict, cases)
            session.commit()
        except Exception as exc:
            session.rollback()
            result.errors.append((relative_path, f"persist: {exc}"))
            if progress is not None:
                progress("persist_error", relative_path)
            continue

        existing_paths.add(relative_path)
        result.runs_inserted += 1
        result.cases_inserted += len(cases)
        if progress is not None:
            progress("inserted", relative_path)

    return result


def _existing_source_paths(session: Session) -> set[str]:
    rows = session.execute(select(TestRun.source_path)).all()
    return {r[0] for r in rows}


def _delete_run(session: Session, source_path: str) -> None:
    existing = session.execute(
        select(TestRun).where(TestRun.source_path == source_path)
    ).scalar_one_or_none()
    if existing is not None:
        session.delete(existing)
        session.commit()


def _parse_report(absolute_path: Path, info: FilenameInfo):
    if info.kind == TestRun.KIND_PLAYWRIGHT:
        return parse_playwright(absolute_path, info)
    if info.kind == TestRun.KIND_SUREFIRE:
        return parse_surefire(absolute_path, info)
    raise ValueError(f"Unknown kind: {info.kind}")


def _persist(session: Session, run_dict: dict, cases: list[dict]) -> None:
    run = TestRun(**run_dict)
    session.add(run)
    session.flush()  # populate run.id

    for case in cases:
        session.add(TestCaseResult(run_id=run.id, **case))


__all__ = ["IngestResult", "ingest_dir", "iter_report_files"]
