from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models.staging_issue import StagingIssue
from app.models.sync_state import SyncState
from app.schemas.staging import (
    ApproveAllResult,
    SkipAllResult,
    StagingIssueOut,
    StagingListOut,
    StagingReviewRequest,
)
from app.schemas.sync import SyncStateOut
from app.services.sync_service import _latest_sync_group_id
from app.services.staging_service import (
    approve_all_pending,
    promote_approved,
    skip_all_pending,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/staging", tags=["staging"])


@router.get("", response_model=StagingListOut)
def list_staging(
    status: str | None = Query(None, description="Filter by review_status"),
    change_type: str | None = Query(None, description="Filter by change_type: new | updated"),
    sync_state_id: int | None = Query(None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> StagingListOut:
    q = select(StagingIssue)
    if status:
        q = q.where(StagingIssue.review_status == status)
    if change_type:
        q = q.where(StagingIssue.change_type == change_type)
    if sync_state_id is not None:
        q = q.where(StagingIssue.sync_state_id == sync_state_id)

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    items = db.execute(
        q.order_by(StagingIssue.created_at.desc()).limit(limit).offset(offset)
    ).scalars().all()

    # aggregate breakdown (always over the filtered scope)
    def _count(col_val: str, col: str = "review_status") -> int:
        base = select(func.count(StagingIssue.id))
        if col == "review_status":
            base = base.where(StagingIssue.review_status == col_val)
        else:
            base = base.where(StagingIssue.change_type == col_val)
        if sync_state_id is not None:
            base = base.where(StagingIssue.sync_state_id == sync_state_id)
        return db.execute(base).scalar_one() or 0

    return StagingListOut(
        items=[StagingIssueOut.model_validate(r) for r in items],
        total=total,
        new=_count("new", col="change_type"),
        updated=_count("updated", col="change_type"),
        pending=_count("pending"),
        approved=_count("approved"),
        skipped=_count("skipped"),
        promoted=_count("promoted"),
        failed=_count("failed"),
    )


@router.patch("/{staging_id}", response_model=StagingIssueOut)
def review_staging(
    staging_id: int,
    payload: StagingReviewRequest,
    db: Session = Depends(get_db),
) -> StagingIssueOut:
    row = db.get(StagingIssue, staging_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Staging row not found")
    if row.review_status in (StagingIssue.STATUS_PROMOTED, StagingIssue.STATUS_FAILED):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot review a row in status '{row.review_status}'",
        )
    row.review_status = payload.review_status
    row.reviewed_by = payload.reviewed_by
    row.reviewed_at = datetime.now(timezone.utc)
    if payload.review_notes is not None:
        row.review_notes = payload.review_notes
    db.commit()
    db.refresh(row)
    return StagingIssueOut.model_validate(row)


def _run_promote_bg(sync_state_id: int, limit: int | None) -> None:
    """Background worker: run promote_approved against its own DB session and
    update sync_state on completion. Failures land the state in `error`."""
    db = SessionLocal()
    try:
        result = promote_approved(db, sync_state_id=sync_state_id, limit=limit)
        state = db.get(SyncState, sync_state_id)
        if state is not None:
            state.status = SyncState.STATUS_SUCCESS
            state.finished_at = datetime.now(timezone.utc)
            state.issues_synced = result["promoted"]
            db.commit()
    except Exception as exc:
        logger.exception("promote background task failed")
        try:
            state = db.get(SyncState, sync_state_id)
            if state is not None:
                state.status = SyncState.STATUS_ERROR
                state.error_message = str(exc)[:4000]
                state.finished_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            logger.exception("failed to mark promote sync_state as error")
    finally:
        db.close()


@router.post("/promote", response_model=SyncStateOut, status_code=202)
def promote_staging(
    background_tasks: BackgroundTasks,
    limit: int | None = Query(
        default=None,
        ge=1,
        le=10000,
        description="Process at most this many approved rows in one call (default: all).",
    ),
    db: Session = Depends(get_db),
) -> SyncStateOut:
    """Promote approved staging rows into the `issues` table.

    Returns 202 immediately with the fresh `sync_state` row. The worker runs
    in the background; poll `GET /api/sync/state/{id}` for progress. The
    `promoting` phase row contains items_processed / items_total and the
    final metrics dict `{promoted, failed}`.
    """
    state = SyncState(
        triggered_by=SyncState.TRIGGERED_BY_PROMOTE,
        status=SyncState.STATUS_RUNNING,
    )
    db.add(state)
    db.flush()
    state.sync_group_id = _latest_sync_group_id(db)
    db.commit()
    db.refresh(state)
    background_tasks.add_task(_run_promote_bg, state.id, limit)
    return SyncStateOut.model_validate(state)


@router.post("/approve-all", response_model=ApproveAllResult)
def approve_all(db: Session = Depends(get_db)) -> ApproveAllResult:
    """Bulk-approve every pending staging row."""
    count = approve_all_pending(db)
    return ApproveAllResult(approved=count)


@router.post("/skip-all", response_model=SkipAllResult)
def skip_all(
    reviewed_by: str | None = Query(
        default=None,
        description="Attribution recorded on `reviewed_by` for the skipped rows.",
    ),
    db: Session = Depends(get_db),
) -> SkipAllResult:
    """Bulk-skip every pending staging row. Skipped rows are terminal and will
    not be promoted. To bring one back, PATCH it with `review_status='approved'`."""
    count = skip_all_pending(db, reviewed_by=reviewed_by)
    return SkipAllResult(skipped=count)
