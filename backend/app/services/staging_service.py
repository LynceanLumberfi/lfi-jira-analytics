from __future__ import annotations

import hashlib
import json
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import JiraSettings, get_jira_settings
from app.models.staging_issue import StagingIssue

logger = logging.getLogger(__name__)


# ---------- hash ----------


def compute_payload_hash(jira_issue: dict[str, Any], settings: JiraSettings) -> str:
    """SHA-256 of the semantically meaningful fields — ignores noisy metadata
    like comment counts or Jira-internal bookkeeping that shouldn't trigger
    a re-review."""
    fields = jira_issue.get("fields") or {}
    snapshot = {
        "summary":      fields.get("summary"),
        "status":       (fields.get("status") or {}).get("name"),
        "issue_type":   (fields.get("issuetype") or {}).get("name"),
        "assignee":     (fields.get("assignee") or {}).get("accountId"),
        "priority":     (fields.get("priority") or {}).get("name"),
        "story_points": fields.get(settings.field_story_points),
        "time_estimate_secs": fields.get("aggregatetimeoriginalestimate"),
        "time_spent_secs":    fields.get("aggregatetimespent"),
        "description":  fields.get("description"),
        "labels":       sorted(fields.get("labels") or []),
        "attachments":  sorted(
            a.get("filename", "") for a in (fields.get("attachment") or [])
        ),
        "sprints":      _sprint_ids_for_hash(fields.get(settings.field_sprint)),
        "customers":    _customers_for_hash(fields.get(settings.field_customer)),
        "reported_by_customer": _yes_no_for_hash(
            fields.get(settings.field_reported_by_customer)
        ),
    }
    canonical = json.dumps(snapshot, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _sprint_ids_for_hash(payload: Any) -> list[str]:
    """Sprint IDs only, sorted. Drops sprint state/dates so churn in those
    fields (a sprint closing, board reassignment) doesn't trigger re-review —
    only changes to which sprints the issue is *in* matter."""
    if not payload:
        return []
    items = payload if isinstance(payload, list) else [payload]
    ids: list[str] = []
    for item in items:
        if isinstance(item, dict):
            sid = item.get("id")
            if sid is not None:
                ids.append(str(sid))
    return sorted(ids)


def _customers_for_hash(payload: Any) -> list[str]:
    """Mirror the extraction `_customer_names` does in sync_service, but
    sorted for hash stability."""
    if not payload:
        return []
    items = payload if isinstance(payload, list) else [payload]
    names: list[str] = []
    for item in items:
        if isinstance(item, dict):
            v = item.get("value") or item.get("name")
            if v:
                names.append(str(v))
        elif isinstance(item, str):
            names.append(item)
    return sorted(names)


def _yes_no_for_hash(payload: Any) -> bool | None:
    """Normalize the radio-button field to True/False/None so the hash isn't
    sensitive to whether Jira returns `{"value": "Yes"}` vs `"Yes"` vs `True`."""
    if payload is None:
        return None
    if isinstance(payload, bool):
        return payload
    v = payload.get("value") if isinstance(payload, dict) else payload
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("yes", "true", "1"):
        return True
    if s in ("no", "false", "0"):
        return False
    return None


# ---------- staging ----------


def fetch_latest_hashes(db: Session) -> dict[str, str]:
    """Return the most recent payload_hash per jira_key across all prior syncs."""
    rows = db.execute(
        text(
            """
            SELECT DISTINCT ON (jira_key) jira_key, payload_hash
            FROM staging_issues
            ORDER BY jira_key, id DESC
            """
        )
    ).all()
    return {r.jira_key: r.payload_hash for r in rows}


def stage_issue(
    db: Session,
    jira_issue: dict[str, Any],
    settings: JiraSettings,
    sync_state_id: int,
    latest_hashes: dict[str, str],
) -> str:
    """Classify and stage one Jira issue. Returns 'new', 'updated', or 'unchanged'.

    When the new hash differs and a prior pending/approved row exists for
    this jira_key, that row is moved to 'superseded' in the same
    transaction — preserving the invariant that at most one row per
    jira_key is active. The partial unique index
    `uq_staging_active_jira_key` enforces this at the DB level.
    """
    jira_key = jira_issue.get("key")
    if not jira_key:
        return "unchanged"

    new_hash = compute_payload_hash(jira_issue, settings)
    existing_hash = latest_hashes.get(jira_key)

    if existing_hash == new_hash:
        return "unchanged"

    change_type = (
        StagingIssue.CHANGE_NEW if existing_hash is None else StagingIssue.CHANGE_UPDATED
    )

    db.execute(
        text(
            """
            UPDATE staging_issues
               SET review_status = 'superseded',
                   superseded_at = now()
             WHERE jira_key = :jira_key
               AND review_status IN ('pending', 'approved')
            """
        ),
        {"jira_key": jira_key},
    )

    fields = jira_issue.get("fields") or {}
    jira_updated_raw = fields.get("updated")
    jira_updated_at = _to_datetime(jira_updated_raw)

    row = StagingIssue(
        jira_key=jira_key,
        sync_state_id=sync_state_id,
        jira_updated_at=jira_updated_at,
        payload_hash=new_hash,
        change_type=change_type,
        raw_payload=jira_issue,
        review_status=StagingIssue.STATUS_PENDING,
    )
    db.add(row)
    db.flush()

    latest_hashes[jira_key] = new_hash
    return change_type


# ---------- promote ----------


def promote_approved(
    db: Session,
    *,
    sync_state_id: int | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Promote approved staging rows into the `issues` table.

    Sanitize is a separate phase; call `POST /api/sanitize` (or
    `run_sanitize(db)` directly) afterwards.

    `sync_state_id` — when provided, opens a `promoting` phase row, ticks
    progress per row, and closes it at the end. The API endpoint creates a
    sync_state and passes its id so the UI can poll for progress.

    `limit` — when provided, processes at most `limit` approved rows
    (`ORDER BY created_at LIMIT n`). Lets the caller chunk a huge backlog
    across multiple HTTP requests.
    """
    from app.models.sync_phase import SyncPhase
    from app.services.phase_service import close_phase, open_phase, tick
    from app.services.sync_service import persist_issue

    settings = get_jira_settings()

    stmt = (
        select(StagingIssue)
        .where(StagingIssue.review_status == StagingIssue.STATUS_APPROVED)
        .order_by(StagingIssue.created_at)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    approved = db.execute(stmt).scalars().all()
    total_approved = len(approved)

    phase = None
    extraction_phases: dict[str, SyncPhase] = {}
    extraction_counts: dict[str, int] = {
        SyncPhase.PHASE_EXTRACTING_CHANGELOGS: 0,
        SyncPhase.PHASE_EXTRACTING_COMMENTS: 0,
        SyncPhase.PHASE_EXTRACTING_WORKLOGS: 0,
        SyncPhase.PHASE_EXTRACTING_ATTACHMENTS: 0,
    }
    if sync_state_id is not None:
        phase = open_phase(db, sync_state_id, SyncPhase.PHASE_PROMOTING)
        phase.items_total = total_approved
        db.commit()
        # Open 4 sibling extraction phase rows so the UI can render
        # per-entity progress bars alongside the overall promote bar.
        # Each row ticks once per promoted issue (issues without that child
        # type still count toward 'processed' so the bars stay aligned).
        for phase_name in extraction_counts:
            extraction_phases[phase_name] = open_phase(db, sync_state_id, phase_name)
            extraction_phases[phase_name].items_total = total_approved
        db.commit()

    promoted = 0
    failed = 0
    processed = 0

    try:
        for row in approved:
            staging_id = row.id
            jira_key = row.jira_key
            row_sync_state_id = row.sync_state_id
            entity_metrics: dict[str, int] = {}
            try:
                entity_metrics = persist_issue(db, row.raw_payload, settings)
                db.commit()
                row.review_status = StagingIssue.STATUS_PROMOTED
                row.promoted_at = datetime.now(timezone.utc)
                db.commit()
                promoted += 1
            except Exception as exc:
                logger.exception(
                    "promote failed staging_id=%s jira_key=%s", staging_id, jira_key
                )
                db.rollback()
                row = db.get(StagingIssue, staging_id)
                if row:
                    row.review_status = StagingIssue.STATUS_FAILED
                    err_snippet = traceback.format_exc()[-400:]
                    row.review_notes = (
                        (row.review_notes or "") + f"\n[promote error: {err_snippet}]"
                    ).strip()
                    db.commit()
                from app.services.failure_service import record_failure
                record_failure(
                    db,
                    phase="promote",
                    entity="issue",
                    title=f"Promote failed: {jira_key}",
                    exc=exc,
                    sync_state_id=row_sync_state_id,
                    staging_id=staging_id,
                    jira_ref=jira_key,
                )
                failed += 1

            processed += 1
            if phase is not None:
                tick(db, phase, processed=processed)
                for phase_name, sibling in extraction_phases.items():
                    extraction_counts[phase_name] += entity_metrics.get(phase_name, 0)
                    tick(db, sibling, processed=processed)
    finally:
        if phase is not None:
            close_phase(
                db, phase, metrics={"promoted": promoted, "failed": failed}
            )
        for phase_name, sibling in extraction_phases.items():
            close_phase(
                db,
                sibling,
                metrics={"items": extraction_counts[phase_name]},
            )

    logger.info("promote: %d promoted, %d failed", promoted, failed)
    return {"promoted": promoted, "failed": failed}


# ---------- bulk review ----------


def approve_all_pending(db: Session) -> int:
    result = db.execute(
        text(
            "UPDATE staging_issues SET review_status = 'approved' "
            "WHERE review_status = 'pending'"
        )
    )
    db.commit()
    return result.rowcount or 0


def skip_all_pending(db: Session, *, reviewed_by: str | None = None) -> int:
    """Flip every `pending` staging row to `skipped`. Optional `reviewed_by`
    is attributed on each row plus a `reviewed_at` timestamp.

    Skipped rows are terminal — `promote_approved` ignores them. To revive a
    skipped row, `PATCH /api/staging/{id}` with `review_status='approved'`.
    """
    result = db.execute(
        text(
            """
            UPDATE staging_issues
               SET review_status = 'skipped',
                   reviewed_by = COALESCE(:by, reviewed_by),
                   reviewed_at = now()
             WHERE review_status = 'pending'
            """
        ),
        {"by": reviewed_by},
    )
    db.commit()
    return result.rowcount or 0


# ---------- helpers ----------


def _to_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    s = str(value)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None
