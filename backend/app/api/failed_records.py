from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.failed_record import FailedRecord
from app.schemas.failed_records import (
    DismissRequest,
    FailedRecordListOut,
    FailedRecordOut,
)

router = APIRouter(prefix="/api/failed-records", tags=["failed-records"])


@router.get("", response_model=FailedRecordListOut)
def list_failed_records(
    status: str = Query("open", description="open | dismissed | all"),
    error_code: str | None = Query(None),
    phase: str | None = Query(None),
    entity: str | None = Query(None),
    sync_state_id: int | None = Query(None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> FailedRecordListOut:
    q = select(FailedRecord)
    if status == "open":
        q = q.where(FailedRecord.dismissed_at.is_(None))
    elif status == "dismissed":
        q = q.where(FailedRecord.dismissed_at.is_not(None))
    elif status != "all":
        raise HTTPException(status_code=400, detail="status must be open|dismissed|all")
    if error_code:
        q = q.where(FailedRecord.error_code == error_code)
    if phase:
        q = q.where(FailedRecord.phase == phase)
    if entity:
        q = q.where(FailedRecord.entity == entity)
    if sync_state_id is not None:
        q = q.where(FailedRecord.sync_state_id == sync_state_id)

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    items = (
        db.execute(q.order_by(FailedRecord.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )

    open_count = db.execute(
        select(func.count(FailedRecord.id)).where(FailedRecord.dismissed_at.is_(None))
    ).scalar_one()
    dismissed_count = db.execute(
        select(func.count(FailedRecord.id)).where(FailedRecord.dismissed_at.is_not(None))
    ).scalar_one()

    by_code_rows = db.execute(
        select(FailedRecord.error_code, func.count(FailedRecord.id))
        .where(FailedRecord.dismissed_at.is_(None))
        .group_by(FailedRecord.error_code)
    ).all()

    return FailedRecordListOut(
        items=[FailedRecordOut.model_validate(r) for r in items],
        total=total,
        open_count=open_count or 0,
        dismissed_count=dismissed_count or 0,
        by_code={code: count for code, count in by_code_rows},
    )


@router.post("/{record_id}/dismiss", response_model=FailedRecordOut)
def dismiss_failed_record(
    record_id: int,
    payload: DismissRequest,
    db: Session = Depends(get_db),
) -> FailedRecordOut:
    row = db.get(FailedRecord, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail="failed_record not found")
    if row.dismissed_at is not None:
        return FailedRecordOut.model_validate(row)
    row.dismissed_at = datetime.now(timezone.utc)
    row.dismissed_by = payload.dismissed_by
    db.commit()
    db.refresh(row)
    return FailedRecordOut.model_validate(row)


@router.post("/{record_id}/retry", response_model=FailedRecordOut)
def retry_failed_record(
    record_id: int,
    db: Session = Depends(get_db),
) -> FailedRecordOut:
    """Stub: increments the retry counter so the UI reflects the action.
    Full retry execution lands when the AI scoring CLI is wired up.
    """
    row = db.get(FailedRecord, record_id)
    if row is None:
        raise HTTPException(status_code=404, detail="failed_record not found")
    row.retry_count = (row.retry_count or 0) + 1
    row.last_retried_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return FailedRecordOut.model_validate(row)
