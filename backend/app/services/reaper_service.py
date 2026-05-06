"""Stuck-run reaper.

Marks `sync_state` rows that are stuck in 'running' beyond a threshold as
'error', closes their open phases, and records a `failed_records` row. A run
is considered stuck when:

- it has at least one phase, and the latest `heartbeat_at` is older than
  the threshold (the worker died mid-loop), OR
- it has no phases yet, and `started_at` is older than the threshold (the
  worker died before opening the first phase).

Called automatically on app startup (handles process-crash recovery for
kill -9 / OOM / container restart) and exposed via `POST /api/sync/reap`
for manual invocation when a process is alive but the sync is hung.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.failed_record import FailedRecord
from app.models.sync_phase import SyncPhase
from app.models.sync_state import SyncState
from app.services.failure_service import record_failure
from app.services.phase_service import close_running_phases

logger = logging.getLogger(__name__)

DEFAULT_THRESHOLD_MINUTES = 10


_TRIGGERED_BY_TO_PHASE = {
    SyncState.TRIGGERED_BY_PROMOTE: FailedRecord.PHASE_PROMOTE,
    SyncState.TRIGGERED_BY_SANITIZE: FailedRecord.PHASE_SANITIZE,
    SyncState.TRIGGERED_BY_SCORE: FailedRecord.PHASE_SCORE,
}


def _phase_for(state: SyncState) -> str:
    """Map a reaped sync_state row to the failed_records phase that should
    own its failure entry. Defaults to `sync` for the actual sync runs."""
    return _TRIGGERED_BY_TO_PHASE.get(state.triggered_by or "", FailedRecord.PHASE_SYNC)


def reap_stuck_runs(
    db: Session, threshold_minutes: int = DEFAULT_THRESHOLD_MINUTES
) -> dict[str, Any]:
    """Find and clean up stuck `running` sync runs. Idempotent."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)

    candidates = (
        db.execute(select(SyncState).where(SyncState.status == SyncState.STATUS_RUNNING))
        .scalars()
        .all()
    )

    reaped_ids: list[int] = []

    for state in candidates:
        latest_heartbeat = db.execute(
            select(func.max(SyncPhase.heartbeat_at)).where(
                SyncPhase.sync_state_id == state.id
            )
        ).scalar()

        if latest_heartbeat is not None:
            is_stuck = latest_heartbeat < cutoff
            reason_detail = (
                f"latest phase heartbeat at {latest_heartbeat.isoformat()} "
                f"is older than {threshold_minutes}m cutoff"
            )
        else:
            is_stuck = state.started_at < cutoff
            reason_detail = (
                f"no phases opened; started_at {state.started_at.isoformat()} "
                f"is older than {threshold_minutes}m cutoff"
            )

        if not is_stuck:
            continue

        state.status = SyncState.STATUS_ERROR
        state.finished_at = datetime.now(timezone.utc)
        state.error_message = (
            f"reaped — no heartbeat for >{threshold_minutes}m "
            f"(likely process crash or hung worker)"
        )
        db.commit()

        close_running_phases(
            db, state.id, error=f"reaped: stale run (>{threshold_minutes}m)"
        )

        phase = _phase_for(state)
        kind_label = phase  # "sync" | "promote" | "sanitize"
        record_failure(
            db,
            phase=phase,
            entity=FailedRecord.ENTITY_ISSUE,
            title=f"{kind_label.capitalize()} run {state.id} reaped",
            sync_state_id=state.id,
            error_code=FailedRecord.CODE_UNKNOWN,
            detail=(
                f"Auto-reaped to unblock new {kind_label} runs. {reason_detail}.\n\n"
                f"This usually means the worker process crashed (kill -9, OOM, "
                f"container restart) without running its except branch. The "
                f"run is now safe to retry."
            ),
        )

        reaped_ids.append(state.id)
        logger.warning(
            "reaped stuck %s run id=%s — %s",
            kind_label,
            state.id,
            reason_detail,
        )

    return {
        "reaped_count": len(reaped_ids),
        "reaped_ids": reaped_ids,
        "threshold_minutes": threshold_minutes,
    }
