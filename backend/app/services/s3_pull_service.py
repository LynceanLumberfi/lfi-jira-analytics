"""Orchestrate the one-click "Pull from S3" flow.

Lists each of the known report buckets, filters to keys we have not already
ingested (compared against `test_run.source_path`), downloads only the new
ones into `data/s3/<bucket>/`, then runs the existing `ingest_dir()` to
parse + insert. Progress + final summary are stored on the `SyncState` row
so the existing polling endpoint (`GET /api/sync/state/{id}`) can be reused
from the UI without a new schema.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_s3_settings
from app.models.sync_state import SyncState
from app.models.test_run import TestRun
from app.services.s3_service import download_keys, list_objects
from app.services.test_report_ingest import ingest_dir

logger = logging.getLogger(__name__)

REPORT_BUCKETS: tuple[str, ...] = (
    "lumberfi-playwright-reports",
    "lumberfi-automation-reports",
)

# Ingest window must cover anything that could newly arrive in S3. The
# downloader already filters to "not in DB" so this just caps how far back
# the parser looks at on-disk files.
INGEST_WINDOW_DAYS = 90


def run_s3_pull(
    session_factory: Callable[[], Session],
    sync_state_id: int,
) -> None:
    """Download + ingest new reports from the known S3 buckets.

    Safe to invoke from a FastAPI BackgroundTasks worker.
    """
    db = session_factory()
    project_root = Path(__file__).resolve().parents[3]
    base_dir = project_root / "data" / "s3"

    files_downloaded = 0
    skipped_by_watermark = 0
    skipped_in_db = 0
    skipped_on_disk = 0

    try:
        state = db.get(SyncState, sync_state_id)
        if state is None:
            raise RuntimeError(f"SyncState {sync_state_id} not found")

        settings = get_s3_settings()
        existing = _existing_source_paths(db)
        watermark = _latest_watermark(db, current_id=state.id)

        for bucket in REPORT_BUCKETS:
            objects = list_objects(settings, bucket, prefix="")
            dest_dir = base_dir / bucket
            # Three-layer skip: LastModified watermark (S3-level incremental),
            # then DB membership (file already ingested), then on-disk presence
            # (file already downloaded but didn't ingest — e.g. out-of-window
            # date, unparseable filename). All three are guards against
            # re-downloading bytes; ingest_dir below still re-walks every
            # on-disk file so previously-failed parses get retried for free.
            new_keys: list[str] = []
            for obj in objects:
                if watermark is not None and obj["last_modified"] <= watermark:
                    skipped_by_watermark += 1
                    continue
                if f"{bucket}/{obj['key']}" in existing:
                    skipped_in_db += 1
                    continue
                if (dest_dir / obj["key"]).exists():
                    skipped_on_disk += 1
                    continue
                new_keys.append(obj["key"])

            if not new_keys:
                logger.info("s3-pull %s: no new keys in %s", state.id, bucket)
                continue

            logger.info(
                "s3-pull %s: downloading %d new keys from %s",
                state.id,
                len(new_keys),
                bucket,
            )
            written = download_keys(settings, bucket, new_keys, dest_dir)
            files_downloaded += len(written)

        result = ingest_dir(
            db,
            base_dir,
            days=INGEST_WINDOW_DAYS,
            dry_run=False,
            reingest=False,
        )

        state.status = SyncState.STATUS_SUCCESS
        state.finished_at = datetime.now(timezone.utc)
        state.synced_until = state.started_at
        state.issues_synced = result.runs_inserted
        state.error_message = json.dumps(
            {
                "watermark": watermark.isoformat() if watermark else None,
                "files_downloaded": files_downloaded,
                "skipped_by_watermark": skipped_by_watermark,
                "skipped_in_db": skipped_in_db,
                "skipped_on_disk": skipped_on_disk,
                "runs_inserted": result.runs_inserted,
                "cases_inserted": result.cases_inserted,
                "ingest_skipped_existing": result.skipped_existing,
                "ingest_skipped_out_of_window": result.skipped_out_of_window,
                "ingest_parse_errors": len(result.errors),
            }
        )
        db.commit()
        logger.info(
            "s3-pull %s ok — %d files downloaded, %d runs / %d cases inserted",
            state.id,
            files_downloaded,
            result.runs_inserted,
            result.cases_inserted,
        )

    except Exception as exc:
        logger.exception("s3-pull %s failed", sync_state_id)
        db.rollback()
        state = db.get(SyncState, sync_state_id)
        if state is not None:
            state.status = SyncState.STATUS_ERROR
            state.finished_at = datetime.now(timezone.utc)
            state.error_message = f"{type(exc).__name__}: {exc}"[:4000]
            db.commit()
    finally:
        db.close()


def _existing_source_paths(db: Session) -> set[str]:
    rows = db.execute(select(TestRun.source_path)).all()
    return {r[0] for r in rows}


def _latest_watermark(db: Session, *, current_id: int) -> datetime | None:
    """Return the `synced_until` from the most recent successful s3-pull
    (excluding the in-flight `current_id`). None on first-ever pull or when
    no prior run set a watermark."""
    return db.execute(
        select(SyncState.synced_until)
        .where(
            SyncState.triggered_by == SyncState.TRIGGERED_BY_S3_PULL,
            SyncState.status == SyncState.STATUS_SUCCESS,
            SyncState.synced_until.is_not(None),
            SyncState.id != current_id,
        )
        .order_by(SyncState.id.desc())
        .limit(1)
    ).scalar_one_or_none()


__all__ = ["run_s3_pull", "REPORT_BUCKETS"]
