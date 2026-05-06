"""Backfill timestamp columns from issues.raw_json without re-running persist_issue.

Why: _to_datetime previously rejected Jira's `±HHMM` offsets, so all
created_at/updated_at/resolved_at/started_at landed NULL. The raw payload on
issues.raw_json is intact; this script rewrites only the timestamp columns
from that payload using the fixed parser, then recomputes
issue_metrics.lead_time_hours. It does NOT call persist_issue (would
clobber sanitized descriptions, ADF, etc.).

Usage (from project root):
    .jira-analytics/bin/python backend/cli/backfill_timestamps.py --dry-run --limit 20 -v
    .jira-analytics/bin/python backend/cli/backfill_timestamps.py
"""
from __future__ import annotations

import logging
import sys
from decimal import Decimal
from pathlib import Path

import click
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

_PROJECT_ROOT = _BACKEND_DIR.parent
load_dotenv(_PROJECT_ROOT / ".env")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Attachment, Comment, Issue, IssueMetrics, Worklog  # noqa: E402
from app.services.sync_service import _to_datetime  # noqa: E402

log = logging.getLogger("backfill_timestamps")

BATCH_SIZE = 100


def backfill_issue_row(issue: Issue) -> int:
    fields = (issue.raw_json or {}).get("fields") or {}
    changed = 0
    new_created = _to_datetime(fields.get("created"))
    new_updated = _to_datetime(fields.get("updated"))
    new_resolved = _to_datetime(fields.get("resolutiondate"))
    if new_created is not None and issue.created_at != new_created:
        issue.created_at = new_created
        changed += 1
    if new_updated is not None and issue.updated_at != new_updated:
        issue.updated_at = new_updated
        changed += 1
    if new_resolved is not None and issue.resolved_at != new_resolved:
        issue.resolved_at = new_resolved
        changed += 1
    return changed


def backfill_comments(db: Session, issue: Issue) -> int:
    payload = ((issue.raw_json or {}).get("fields") or {}).get("comment") or {}
    raws = payload.get("comments") or []
    if not raws:
        return 0
    by_id = {str(r.get("id")): r for r in raws if r.get("id")}
    if not by_id:
        return 0
    rows = (
        db.execute(select(Comment).where(Comment.issue_id == issue.id))
        .scalars()
        .all()
    )
    updated = 0
    for row in rows:
        raw = by_id.get(str(row.jira_comment_id))
        if raw is None:
            continue
        c = _to_datetime(raw.get("created"))
        u = _to_datetime(raw.get("updated"))
        if c is not None and row.created_at != c:
            row.created_at = c
            updated += 1
        if u is not None and row.updated_at != u:
            row.updated_at = u
    return updated


def backfill_attachments(db: Session, issue: Issue) -> int:
    raws = ((issue.raw_json or {}).get("fields") or {}).get("attachment") or []
    if not raws:
        return 0
    by_id = {str(r.get("id")): r for r in raws if r.get("id")}
    if not by_id:
        return 0
    rows = (
        db.execute(select(Attachment).where(Attachment.issue_id == issue.id))
        .scalars()
        .all()
    )
    updated = 0
    for row in rows:
        raw = by_id.get(str(row.jira_attachment_id))
        if raw is None:
            continue
        c = _to_datetime(raw.get("created"))
        if c is not None and row.created_at != c:
            row.created_at = c
            updated += 1
    return updated


def backfill_worklogs(db: Session, issue: Issue) -> int:
    payload = ((issue.raw_json or {}).get("fields") or {}).get("worklog") or {}
    raws = payload.get("worklogs") or []
    if not raws:
        return 0
    by_id = {str(r.get("id")): r for r in raws if r.get("id")}
    if not by_id:
        return 0
    rows = (
        db.execute(select(Worklog).where(Worklog.issue_id == issue.id))
        .scalars()
        .all()
    )
    updated = 0
    for row in rows:
        raw = by_id.get(str(row.jira_worklog_id))
        if raw is None:
            continue
        s = _to_datetime(raw.get("started"))
        c = _to_datetime(raw.get("created"))
        u = _to_datetime(raw.get("updated"))
        if s is not None and row.started_at != s:
            row.started_at = s
            updated += 1
        if c is not None and row.created_at != c:
            row.created_at = c
        if u is not None and row.updated_at != u:
            row.updated_at = u
    return updated


def recompute_lead_time(db: Session, issue: Issue) -> bool:
    if issue.created_at is None or issue.resolved_at is None:
        return False
    metrics = db.execute(
        select(IssueMetrics).where(IssueMetrics.issue_id == issue.id)
    ).scalar_one_or_none()
    if metrics is None:
        return False
    lead = Decimal((issue.resolved_at - issue.created_at).total_seconds()) / Decimal(3600)
    if metrics.lead_time_hours != lead:
        metrics.lead_time_hours = lead
        return True
    return False


@click.command()
@click.option("--limit", default=None, type=int, help="Stop after N issues")
@click.option("--dry-run", is_flag=True, help="Compute but do not commit")
@click.option("-v", "--verbose", is_flag=True)
def main(limit: int | None, dry_run: bool, verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    db = SessionLocal()
    totals = {
        "issues_seen": 0,
        "issues_with_changes": 0,
        "comments_updated": 0,
        "attachments_updated": 0,
        "worklogs_updated": 0,
        "lead_time_recomputed": 0,
    }
    # Paginate by id rather than using yield_per: server-side cursors become
    # invalid the moment we commit, which we want to do every batch.
    last_id = 0
    try:
        while True:
            if limit is not None and totals["issues_seen"] >= limit:
                break
            page_size = BATCH_SIZE
            if limit is not None:
                page_size = min(page_size, limit - totals["issues_seen"])
            batch = (
                db.execute(
                    select(Issue)
                    .where(Issue.raw_json.is_not(None), Issue.id > last_id)
                    .order_by(Issue.id)
                    .limit(page_size)
                )
                .scalars()
                .all()
            )
            if not batch:
                break

            for issue in batch:
                totals["issues_seen"] += 1
                try:
                    fields_changed = backfill_issue_row(issue)
                    c = backfill_comments(db, issue)
                    a = backfill_attachments(db, issue)
                    w = backfill_worklogs(db, issue)
                    if fields_changed or c or a or w:
                        totals["issues_with_changes"] += 1
                    totals["comments_updated"] += c
                    totals["attachments_updated"] += a
                    totals["worklogs_updated"] += w
                    if recompute_lead_time(db, issue):
                        totals["lead_time_recomputed"] += 1
                except Exception:
                    log.exception("backfill failed for %s — skipping", issue.jira_key)
                    db.rollback()
                    continue
                last_id = issue.id

            if dry_run:
                db.rollback()
            else:
                db.commit()
            log.info("processed %d so far: %s", totals["issues_seen"], totals)

        if dry_run:
            log.info("DRY RUN — no changes persisted")
        log.info("DONE: %s", totals)
    finally:
        db.close()


if __name__ == "__main__":
    main()
