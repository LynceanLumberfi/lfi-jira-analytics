from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import SessionLocal, get_db
from app.models import SyncState
from app.models.issue import Issue
from app.models.staging_issue import StagingIssue
from app.models.team import Team
from app.schemas.sync import SyncGroupIssueItem, SyncGroupIssuesOut, SyncStateOut, SyncTriggerRequest
from app.services.reaper_service import DEFAULT_THRESHOLD_MINUTES, reap_stuck_runs
from app.services.sync_service import create_pending_sync_state, run_sync

router = APIRouter(prefix="/api/sync", tags=["sync"])


_KIND_TO_TRIGGERED_BY = {
    "promote": SyncState.TRIGGERED_BY_PROMOTE,
    "sanitize": SyncState.TRIGGERED_BY_SANITIZE,
    "score": SyncState.TRIGGERED_BY_SCORE,
}


def _apply_kind_filter(stmt, kind: str | None):
    """Filter a SyncState query by `kind`:
      - "sync"     → triggered_by IS NULL OR not in the non-sync set
      - "promote"  → triggered_by = 'api-promote'
      - "sanitize" → triggered_by = 'api-sanitize'
      - "score"    → triggered_by = 'api-score'
      - None       → no filter
    """
    if kind is None:
        return stmt
    if kind == "sync":
        return stmt.where(
            (SyncState.triggered_by.is_(None))
            | (SyncState.triggered_by.notin_(SyncState.NON_SYNC_TRIGGERED_BY))
        )
    target = _KIND_TO_TRIGGERED_BY.get(kind)
    if target is None:
        return stmt  # safety: unknown kind → no filter (validator should catch)
    return stmt.where(SyncState.triggered_by == target)


KindLiteral = Literal["sync", "promote", "sanitize", "score"]


def _ensure_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.post("", response_model=SyncStateOut, status_code=202)
def trigger_sync(
    payload: SyncTriggerRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SyncStateOut:
    """Kick off a sync run. Body: `{"since": "2026-05-01T00:00:00Z"}` or `{}`.

    If `since` is omitted, the run starts from `(last successful synced_until - 1 day)`,
    or performs a full sync if no prior successful run exists. Issues are upserted by
    `jira_key` so duplicates overwrite the existing row.
    """

    # Only block on *sync* runs; promote/sanitize each get their own sync_state
    # row but operate on disjoint data and shouldn't 409 a new sync.
    in_progress = db.execute(
        select(SyncState).where(
            SyncState.status == SyncState.STATUS_RUNNING,
            (SyncState.triggered_by.is_(None))
            | (SyncState.triggered_by.notin_(SyncState.NON_SYNC_TRIGGERED_BY)),
        )
    ).scalar_one_or_none()
    if in_progress is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Sync {in_progress.id} is already running",
        )

    since = _ensure_aware(payload.since)
    state = create_pending_sync_state(db, since=since, triggered_by="api")
    background_tasks.add_task(
        run_sync,
        SessionLocal,
        state.id,
        requested_since=since,
    )
    return SyncStateOut.model_validate(state)


@router.get("/state", response_model=SyncStateOut | None)
def latest_sync_state(
    kind: KindLiteral | None = Query(
        default=None,
        description="Filter by run kind. Omit for 'latest of any kind'.",
    ),
    db: Session = Depends(get_db),
) -> SyncStateOut | None:
    stmt = (
        select(SyncState)
        .options(selectinload(SyncState.phases))
        .order_by(SyncState.started_at.desc())
        .limit(1)
    )
    stmt = _apply_kind_filter(stmt, kind)
    state = db.execute(stmt).scalar_one_or_none()
    return SyncStateOut.model_validate(state) if state else None


@router.get("/state/{sync_state_id}", response_model=SyncStateOut)
def get_sync_state(
    sync_state_id: int,
    db: Session = Depends(get_db),
) -> SyncStateOut:
    """Fetch a specific sync_state (with phases) by id. Used by the UI to poll
    a specific promote / sanitize / score run after triggering it."""
    state = db.execute(
        select(SyncState)
        .options(selectinload(SyncState.phases))
        .where(SyncState.id == sync_state_id)
    ).scalar_one_or_none()
    if state is None:
        raise HTTPException(status_code=404, detail=f"sync_state {sync_state_id} not found")
    return SyncStateOut.model_validate(state)


@router.get("/history", response_model=list[SyncStateOut])
def sync_history(
    kind: KindLiteral | None = Query(
        default=None,
        description="Filter by run kind. Omit for 'all kinds'.",
    ),
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[SyncStateOut]:
    stmt = (
        select(SyncState)
        .options(selectinload(SyncState.phases))
        .order_by(SyncState.started_at.desc())
        .limit(limit)
    )
    stmt = _apply_kind_filter(stmt, kind)
    rows = db.execute(stmt).scalars().all()
    return [SyncStateOut.model_validate(r) for r in rows]


@router.get("/group/{sync_group_id}/issues", response_model=SyncGroupIssuesOut)
def get_sync_group_issues(
    sync_group_id: int,
    db: Session = Depends(get_db),
) -> SyncGroupIssuesOut:
    """Return issue-level outcome for a sync group (identified by sync_group_id).

    Queries staging_issues where sync_state_id = sync_group_id (the Sync step's id
    equals sync_group_id by construction), joins to issues + teams for display fields.
    """
    rows = db.execute(
        select(
            StagingIssue.jira_key,
            StagingIssue.change_type,
            StagingIssue.review_status,
            StagingIssue.promoted_at,
            Issue.summary,
            Issue.issue_type,
            Issue.status,
            Team.name.label("team_name"),
        )
        .outerjoin(Issue, StagingIssue.jira_key == Issue.jira_key)
        .outerjoin(Team, Issue.team_id == Team.id)
        .where(StagingIssue.sync_state_id == sync_group_id)
        .order_by(StagingIssue.promoted_at.desc().nullslast(), StagingIssue.jira_key)
    ).all()

    created = sum(1 for r in rows if r.change_type == StagingIssue.CHANGE_NEW)
    updated = sum(1 for r in rows if r.change_type == StagingIssue.CHANGE_UPDATED)
    skipped = sum(1 for r in rows if r.review_status == StagingIssue.STATUS_SKIPPED)
    pending = sum(
        1 for r in rows
        if r.review_status in (StagingIssue.STATUS_PENDING, StagingIssue.STATUS_APPROVED)
    )
    failed = sum(1 for r in rows if r.review_status == StagingIssue.STATUS_FAILED)

    items = [
        SyncGroupIssueItem(
            jira_key=r.jira_key,
            change_type=r.change_type,
            review_status=r.review_status,
            summary=r.summary,
            issue_type=r.issue_type,
            status=r.status,
            team_name=r.team_name,
            promoted_at=r.promoted_at,
        )
        for r in rows
        if r.review_status == StagingIssue.STATUS_PROMOTED
    ]

    return SyncGroupIssuesOut(
        created=created,
        updated=updated,
        skipped=skipped,
        pending=pending,
        failed=failed,
        items=items,
    )


@router.post("/reap")
def reap_runs(
    threshold_minutes: int = Query(
        default=DEFAULT_THRESHOLD_MINUTES, ge=1, le=1440
    ),
    db: Session = Depends(get_db),
) -> dict:
    """Mark any sync run stuck in 'running' beyond `threshold_minutes` as 'error'.

    A run is considered stuck when its latest phase heartbeat (or `started_at`
    if no phase has been opened yet) is older than the threshold. Closes any
    open phases and records a `failed_records` row for each reaped run.

    Use this when a process is alive but the sync is hung. Process restarts
    trigger the same logic automatically via the FastAPI lifespan startup hook.
    """
    return reap_stuck_runs(db, threshold_minutes=threshold_minutes)
