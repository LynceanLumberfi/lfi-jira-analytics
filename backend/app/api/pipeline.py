from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.failed_record import FailedRecord
from app.models.issue import Issue
from app.models.issue_ai_score import IssueAIScore
from app.models.staging_issue import StagingIssue

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


class PipelineStatusOut(BaseModel):
    staging_pending: int
    staging_approved: int
    in_lumber: int
    score_pending: int
    score_completed: int
    score_failed: int
    failed_open: int


@router.get("/status", response_model=PipelineStatusOut)
def pipeline_status(db: Session = Depends(get_db)) -> PipelineStatusOut:
    staging_counts = dict(
        db.execute(
            select(StagingIssue.review_status, func.count(StagingIssue.id))
            .where(StagingIssue.review_status.in_(["pending", "approved"]))
            .group_by(StagingIssue.review_status)
        ).all()
    )

    in_lumber = db.execute(select(func.count(Issue.id))).scalar_one() or 0

    score_counts = dict(
        db.execute(
            select(IssueAIScore.scoring_status, func.count(IssueAIScore.id))
            .group_by(IssueAIScore.scoring_status)
        ).all()
    )

    failed_open = (
        db.execute(
            select(func.count(FailedRecord.id)).where(FailedRecord.dismissed_at.is_(None))
        ).scalar_one()
        or 0
    )

    return PipelineStatusOut(
        staging_pending=staging_counts.get("pending", 0),
        staging_approved=staging_counts.get("approved", 0),
        in_lumber=in_lumber,
        score_pending=score_counts.get("pending", 0),
        score_completed=score_counts.get("completed", 0),
        score_failed=score_counts.get("failed", 0),
        failed_open=failed_open,
    )
