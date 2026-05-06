from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class FailedRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sync_state_id: int | None
    staging_id: int | None
    phase: str
    entity: str
    direction: str
    jira_ref: str | None
    title: str
    detail: str | None
    error_code: str
    fix_steps: list[str] | None
    raw_response: dict[str, Any] | None
    retry_count: int
    last_retried_at: datetime | None
    dismissed_at: datetime | None
    dismissed_by: str | None
    created_at: datetime


class FailedRecordListOut(BaseModel):
    items: list[FailedRecordOut]
    total: int
    open_count: int
    dismissed_count: int
    by_code: dict[str, int]


class DismissRequest(BaseModel):
    dismissed_by: str | None = None
    notes: str | None = None
