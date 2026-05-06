from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.sync_phase import SyncPhase

logger = logging.getLogger(__name__)


def open_phase(db: Session, sync_state_id: int, phase: str) -> SyncPhase:
    now = datetime.now(timezone.utc)
    row = SyncPhase(
        sync_state_id=sync_state_id,
        phase=phase,
        status=SyncPhase.STATUS_RUNNING,
        started_at=now,
        heartbeat_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("phase %s/%s started", sync_state_id, phase)
    return row


def close_phase(
    db: Session,
    phase: SyncPhase,
    *,
    metrics: dict[str, Any] | None = None,
    error: BaseException | str | None = None,
) -> None:
    phase.finished_at = datetime.now(timezone.utc)
    phase.status = SyncPhase.STATUS_ERROR if error else SyncPhase.STATUS_SUCCESS
    if metrics is not None:
        phase.metrics = metrics
    if error:
        phase.error_message = str(error)[:4000]
    db.commit()
    elapsed = (phase.finished_at - phase.started_at).total_seconds()
    logger.info(
        "phase %s/%s %s in %.1fs",
        phase.sync_state_id,
        phase.phase,
        phase.status,
        elapsed,
    )


def tick(db: Session, phase: SyncPhase, *, processed: int) -> None:
    """Commit a heartbeat + items_processed update for live progress visibility."""
    now = datetime.now(timezone.utc)
    db.execute(
        text(
            "UPDATE sync_phases SET heartbeat_at = :now, items_processed = :processed"
            " WHERE id = :id"
        ),
        {"now": now, "id": phase.id, "processed": processed},
    )
    db.commit()
    phase.items_processed = processed
    phase.heartbeat_at = now


def close_running_phases(
    db: Session, sync_state_id: int, *, error: BaseException | str | None = None
) -> None:
    """Close any still-running phases for a sync run (called in error handlers)."""
    from sqlalchemy import select

    running = (
        db.execute(
            select(SyncPhase).where(
                SyncPhase.sync_state_id == sync_state_id,
                SyncPhase.status == SyncPhase.STATUS_RUNNING,
            )
        )
        .scalars()
        .all()
    )
    for p in running:
        try:
            close_phase(db, p, error=error)
        except Exception:
            logger.exception("failed closing phase %s on error", p.id)
