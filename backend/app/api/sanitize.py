from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models.sync_state import SyncState
from app.schemas.sync import SyncStateOut
from app.services.sanitize_service import run_sanitize
from app.services.sync_service import _latest_sync_group_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sanitize", tags=["sanitize"])


def _run_sanitize_bg(sync_state_id: int) -> None:
    """Background worker for sanitize. Updates the sync_state on completion."""
    db = SessionLocal()
    try:
        run_sanitize(db, sync_state_id=sync_state_id)
        state = db.get(SyncState, sync_state_id)
        if state is not None:
            state.status = SyncState.STATUS_SUCCESS
            state.finished_at = datetime.now(timezone.utc)
            db.commit()
    except Exception as exc:
        logger.exception("sanitize background task failed")
        try:
            state = db.get(SyncState, sync_state_id)
            if state is not None:
                state.status = SyncState.STATUS_ERROR
                state.error_message = str(exc)[:4000]
                state.finished_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            logger.exception("failed to mark sanitize sync_state as error")
    finally:
        db.close()


@router.post("", response_model=SyncStateOut, status_code=202)
def trigger_sanitize(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SyncStateOut:
    """Run the sanitize step (Pass 1 plan-attachment extraction + Pass 2
    `issue_ai_scores` reconciliation) as a background task.

    Returns 202 with the fresh `sync_state` row tagged
    `triggered_by='api-sanitize'`. Poll `GET /api/sync/state/{id}` for the
    `extracting` and `reconciling` phase rows."""

    state = SyncState(
        triggered_by=SyncState.TRIGGERED_BY_SANITIZE,
        status=SyncState.STATUS_RUNNING,
    )
    db.add(state)
    db.flush()
    state.sync_group_id = _latest_sync_group_id(db)
    db.commit()
    db.refresh(state)
    background_tasks.add_task(_run_sanitize_bg, state.id)
    return SyncStateOut.model_validate(state)
