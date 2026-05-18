import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.analytics import router as analytics_router
from app.api.test_coverage import router as test_coverage_router
from app.api.pipeline import router as pipeline_router
from app.api.dimensions import router as dimensions_router
from app.api.failed_records import router as failed_records_router
from app.api.integrations import router as integrations_router
from app.api.issues import router as issues_router
from app.api.sanitize import router as sanitize_router
from app.api.score import router as score_router
from app.api.staging import router as staging_router
from app.api.sync import router as sync_router
from app.db import SessionLocal
from app.services.reaper_service import reap_stuck_runs

logger = logging.getLogger(__name__)


def _reset_stuck_in_progress_scores(db) -> int:
    """Unconditionally flip any `in_progress` `issue_ai_scores` rows back to
    `pending`. A new uvicorn process means any previous worker is gone — its
    claims are orphaned. We accept the small risk that this clobbers a
    simultaneous CLI worker; running both in parallel against the same DB is
    an unsupported configuration."""
    result = db.execute(
        text(
            "UPDATE issue_ai_scores SET scoring_status = 'pending', "
            "error_message = NULL "
            "WHERE scoring_status = 'in_progress'"
        )
    )
    db.commit()
    return result.rowcount or 0


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup recovery: any sync_state row left `running` by a previous
    process is reaped (kill -9 / OOM / container restart), and any
    `issue_ai_scores` row claimed (`in_progress`) by a previous process is
    released back to `pending`. Without this, POST /api/sync would 409 forever
    and stuck claims would block re-scoring for up to 60 min (the synced_at
    proxy threshold)."""
    db = SessionLocal()
    try:
        result = reap_stuck_runs(db)
        if result["reaped_count"] > 0:
            logger.warning(
                "startup reaper: cleaned up %d stuck sync runs %s",
                result["reaped_count"],
                result["reaped_ids"],
            )
        released = _reset_stuck_in_progress_scores(db)
        if released > 0:
            logger.warning(
                "startup reaper: released %d in_progress issue_ai_scores rows", released
            )
    except Exception:
        logger.exception("startup reaper failed; continuing app boot")
    finally:
        db.close()
    yield


app = FastAPI(title="LFI Jira Analytics API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline_router)
app.include_router(sync_router)
app.include_router(sanitize_router)
app.include_router(staging_router)
app.include_router(score_router)
app.include_router(failed_records_router)
app.include_router(integrations_router)
app.include_router(dimensions_router)
app.include_router(analytics_router)
app.include_router(issues_router)
app.include_router(test_coverage_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
