from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import IssueAIScore, SyncState
from app.schemas.scoring import ScoreTriggerOut, ScoreTriggerRequest, ScoringStateOut
from app.services import scoring_lock
from app.services.scoring_service import score_pending
from app.services.sync_service import _latest_sync_group_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/score", tags=["score"])


def _run_scoring_bg(
    *, sync_state_id: int, limit: int, model: str | None, dry_run: bool
) -> None:
    """Background worker: runs `score_pending` with phase tracking, then
    closes the sync_state. The in-process scoring_lock is released here so
    a follow-up trigger can claim the slot."""
    db = SessionLocal()
    try:
        score_pending(
            db,
            limit=limit,
            model=model,
            dry_run=dry_run,
            sync_state_id=sync_state_id,
        )
        state = db.get(SyncState, sync_state_id)
        if state is not None:
            state.status = SyncState.STATUS_SUCCESS
            state.finished_at = datetime.now(timezone.utc)
            db.commit()
    except Exception as exc:
        logger.exception("scoring background task failed")
        try:
            state = db.get(SyncState, sync_state_id)
            if state is not None:
                state.status = SyncState.STATUS_ERROR
                state.error_message = str(exc)[:4000]
                state.finished_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            logger.exception("failed to mark scoring sync_state as error")
    finally:
        db.close()
        scoring_lock.release()


@router.post("", response_model=ScoreTriggerOut, status_code=202)
def trigger_score(
    payload: ScoreTriggerRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> ScoreTriggerOut:
    """Kick off a scoring run. Returns 202 immediately. Use
    `GET /api/score/state` or `GET /api/sync/state/{sync_state_id}` to poll
    progress. Concurrent runs in the same process are rejected with
    `accepted=false`."""
    pending = db.execute(
        select(func.count(IssueAIScore.id)).where(IssueAIScore.scoring_status == "pending")
    ).scalar_one() or 0

    if not scoring_lock.acquire(triggered_by=payload.triggered_by or "api"):
        return ScoreTriggerOut(
            accepted=False,
            is_running=True,
            started_at=scoring_lock.started_at(),
            triggered_by=scoring_lock.triggered_by(),
            pending=pending,
            sync_state_id=None,
            detail="A scoring run is already in progress.",
        )

    state = SyncState(
        triggered_by=SyncState.TRIGGERED_BY_SCORE,
        status=SyncState.STATUS_RUNNING,
    )
    db.add(state)
    db.flush()
    state.sync_group_id = _latest_sync_group_id(db)
    db.commit()
    db.refresh(state)

    background_tasks.add_task(
        _run_scoring_bg,
        sync_state_id=state.id,
        limit=payload.limit,
        model=payload.model,
        dry_run=payload.dry_run,
    )
    return ScoreTriggerOut(
        accepted=True,
        is_running=True,
        started_at=scoring_lock.started_at(),
        triggered_by=scoring_lock.triggered_by(),
        pending=pending,
        sync_state_id=state.id,
    )


@router.get("/state", response_model=ScoringStateOut)
def scoring_state(db: Session = Depends(get_db)) -> ScoringStateOut:
    counts_by_status = dict(
        db.execute(
            select(IssueAIScore.scoring_status, func.count(IssueAIScore.id)).group_by(
                IssueAIScore.scoring_status
            )
        ).all()
    )
    total_scored = db.execute(
        select(func.count(IssueAIScore.id)).where(IssueAIScore.scored_at.is_not(None))
    ).scalar_one() or 0
    last_scored_at = db.execute(select(func.max(IssueAIScore.scored_at))).scalar_one()
    totals = db.execute(
        select(
            func.coalesce(func.sum(IssueAIScore.input_tokens), 0),
            func.coalesce(func.sum(IssueAIScore.output_tokens), 0),
            func.coalesce(func.sum(IssueAIScore.cache_read_tokens), 0),
            func.coalesce(func.sum(IssueAIScore.total_cost_usd), 0),
        )
    ).one()

    in_progress_count = int(counts_by_status.get("in_progress", 0))
    is_running = in_progress_count > 0 or scoring_lock.is_running()

    # Surface the latest scoring sync_state id so the UI can poll phase progress
    # via GET /api/sync/state/{id} on the same shape as promote/sanitize.
    latest_score_state_id = db.execute(
        select(SyncState.id)
        .where(SyncState.triggered_by == SyncState.TRIGGERED_BY_SCORE)
        .order_by(SyncState.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    return ScoringStateOut(
        is_running=is_running,
        started_at=scoring_lock.started_at(),
        triggered_by=scoring_lock.triggered_by(),
        latest_sync_state_id=latest_score_state_id,
        pending=int(counts_by_status.get("pending", 0)),
        in_progress=in_progress_count,
        completed=int(counts_by_status.get("completed", 0)),
        failed=int(counts_by_status.get("failed", 0)),
        total_scored=int(total_scored),
        last_scored_at=last_scored_at,
        total_input_tokens=int(totals[0]),
        total_output_tokens=int(totals[1]),
        total_cache_read_tokens=int(totals[2]),
        total_cost_usd_sum=Decimal(str(totals[3])) if totals[3] is not None else None,
    )
