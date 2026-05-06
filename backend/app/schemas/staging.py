from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class StagingIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    jira_key: str
    sync_state_id: int
    jira_updated_at: datetime | None
    payload_hash: str
    change_type: str
    review_status: str
    reviewed_by: str | None
    reviewed_at: datetime | None
    review_notes: str | None
    promoted_at: datetime | None
    created_at: datetime
    summary: str | None = None
    issue_type: str | None = None


class StagingListOut(BaseModel):
    items: list[StagingIssueOut]
    total: int
    # breakdown by change_type
    new: int
    updated: int
    # breakdown by review_status
    pending: int
    approved: int
    skipped: int
    promoted: int
    failed: int


class StagingReviewRequest(BaseModel):
    review_status: Literal["approved", "skipped"]
    reviewed_by: str
    review_notes: str | None = None


class ApproveAllResult(BaseModel):
    approved: int


class SkipAllResult(BaseModel):
    skipped: int
