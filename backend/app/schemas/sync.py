from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SyncTriggerRequest(BaseModel):
    since: datetime | None = None


class SyncPhaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    phase: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    heartbeat_at: datetime
    items_total: int | None
    items_processed: int
    metrics: dict[str, Any] | None
    error_message: str | None


class SyncGroupIssueItem(BaseModel):
    jira_key: str
    change_type: str
    review_status: str
    summary: str | None
    issue_type: str | None
    status: str | None
    team_name: str | None
    promoted_at: datetime | None


class SyncGroupIssuesOut(BaseModel):
    created: int
    updated: int
    skipped: int
    pending: int
    failed: int
    items: list[SyncGroupIssueItem]


class SyncStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    started_at: datetime
    finished_at: datetime | None
    since: datetime | None
    synced_until: datetime | None
    issues_synced: int
    error_message: str | None
    triggered_by: str | None
    sync_group_id: int | None = None
    phases: list[SyncPhaseOut] = []
