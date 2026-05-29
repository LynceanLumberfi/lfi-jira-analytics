from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import SyncState
from app.schemas.sync import SyncStateOut
from app.services.s3_pull_service import run_s3_pull
from app.services.sync_service import create_pending_sync_state

router = APIRouter(prefix="/api/s3-pull", tags=["s3-pull"])


@router.post("", response_model=SyncStateOut, status_code=202)
def trigger_s3_pull(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> SyncStateOut:
    """Kick off an S3 pull. Lists both report buckets, downloads any keys not
    already in `test_run.source_path`, and ingests them. Returns the
    `sync_state` row so the UI can poll `/api/sync/state/{id}` for status."""

    in_progress = db.execute(
        select(SyncState).where(
            SyncState.status == SyncState.STATUS_RUNNING,
            SyncState.triggered_by == SyncState.TRIGGERED_BY_S3_PULL,
        )
    ).scalar_one_or_none()
    if in_progress is not None:
        raise HTTPException(
            status_code=409,
            detail=f"S3 pull {in_progress.id} is already running",
        )

    state = create_pending_sync_state(
        db, since=None, triggered_by=SyncState.TRIGGERED_BY_S3_PULL
    )
    background_tasks.add_task(run_s3_pull, SessionLocal, state.id)
    return SyncStateOut.model_validate(state)
