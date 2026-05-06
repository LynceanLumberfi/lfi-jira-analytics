"""Backfill the `changelogs` table from issues.raw_json.changelog.histories,
then recompute issue_metrics.cycle_time_hours / reopen_count via
_upsert_issue_metrics.

Why: the same _to_datetime bug that nulled timestamps also caused
_replace_changelog to skip every history (when=None -> continue). The fix
landed, but historical issues were already synced — their raw_json contains
changelog.histories[] but the changelogs table is empty.

For issues whose embedded history hit Jira's 40-event cap, this script
re-fetches the full changelog from Jira's /issue/{key}/changelog endpoint.

Usage (from project root):
    .jira-analytics/bin/python backend/cli/backfill_changelogs.py --dry-run --limit 20 -v
    .jira-analytics/bin/python backend/cli/backfill_changelogs.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

import click
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

_PROJECT_ROOT = _BACKEND_DIR.parent
load_dotenv(_PROJECT_ROOT / ".env")

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import get_jira_settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Changelog, Issue  # noqa: E402
from app.services.jira_client import JiraClient  # noqa: E402
from app.services.sync_service import (  # noqa: E402
    _to_datetime,
    _upsert_issue_metrics,
    _upsert_user,
)

log = logging.getLogger("backfill_changelogs")

INLINE_CAP = 40
BATCH_SIZE = 100


def _insert_histories(
    db: Session, issue: Issue, histories: list[dict[str, Any]]
) -> int:
    """Replace all changelogs for `issue` with rows derived from `histories`.
    Returns count of Changelog rows inserted."""
    db.execute(delete(Changelog).where(Changelog.issue_id == issue.id))
    inserted = 0
    for history in histories:
        when = _to_datetime(history.get("created"))
        if when is None:
            continue
        author = _upsert_user(db, history.get("author"))
        author_id = author.id if author else None
        for item in history.get("items") or []:
            db.add(
                Changelog(
                    issue_id=issue.id,
                    field=item.get("field"),
                    from_value=item.get("fromString") or item.get("from"),
                    to_value=item.get("toString") or item.get("to"),
                    changed_at=when,
                    changed_by=author_id,
                )
            )
            inserted += 1
    db.flush()
    return inserted


@click.command()
@click.option("--limit", default=None, type=int, help="Stop after N issues")
@click.option("--dry-run", is_flag=True, help="Compute but do not commit")
@click.option(
    "--no-refetch",
    is_flag=True,
    help="Skip re-fetching truncated changelogs from Jira (use embedded payload only)",
)
@click.option("-v", "--verbose", is_flag=True)
def main(limit: int | None, dry_run: bool, no_refetch: bool, verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    db = SessionLocal()
    settings = get_jira_settings(db)
    client = JiraClient(settings) if not no_refetch else None
    totals = {
        "issues_seen": 0,
        "changelogs_inserted": 0,
        "metrics_recomputed": 0,
        "refetched_from_jira": 0,
        "refetch_failed": 0,
        "issues_with_cycle_time": 0,
    }
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
                    histories = (
                        ((issue.raw_json or {}).get("changelog") or {}).get(
                            "histories"
                        )
                        or []
                    )
                    if (
                        client is not None
                        and len(histories) >= INLINE_CAP
                    ):
                        try:
                            histories = client.get_issue_changelog(issue.jira_key)
                            totals["refetched_from_jira"] += 1
                            log.debug(
                                "refetched %s — %d total histories",
                                issue.jira_key,
                                len(histories),
                            )
                        except Exception:
                            log.exception(
                                "refetch failed for %s — falling back to embedded",
                                issue.jira_key,
                            )
                            totals["refetch_failed"] += 1
                            # fall back to embedded histories already in scope
                    inserted = _insert_histories(db, issue, histories)
                    totals["changelogs_inserted"] += inserted
                    _upsert_issue_metrics(db, issue)
                    totals["metrics_recomputed"] += 1
                    # Best-effort check; reflect the metric we just wrote
                    db.refresh(issue)
                    from app.models import IssueMetrics  # local import to keep top tidy
                    m = db.execute(
                        select(IssueMetrics).where(IssueMetrics.issue_id == issue.id)
                    ).scalar_one_or_none()
                    if m is not None and m.cycle_time_hours is not None:
                        totals["issues_with_cycle_time"] += 1
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
        if client is not None:
            client.close()
        db.close()


if __name__ == "__main__":
    main()
