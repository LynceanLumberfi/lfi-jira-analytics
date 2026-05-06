from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class ScoreTriggerRequest(BaseModel):
    limit: int = 200
    model: str | None = None
    triggered_by: str | None = None
    dry_run: bool = False


class ScoreTriggerOut(BaseModel):
    accepted: bool
    is_running: bool
    started_at: datetime | None
    triggered_by: str | None
    pending: int
    sync_state_id: int | None = None  # null when accepted=false (already running)
    detail: str | None = None


class ScoringStateOut(BaseModel):
    is_running: bool
    started_at: datetime | None
    triggered_by: str | None
    latest_sync_state_id: int | None  # poll /api/sync/state/{id} for phase progress
    pending: int
    in_progress: int
    completed: int
    failed: int
    total_scored: int  # rows with scored_at not null
    last_scored_at: datetime | None
    total_input_tokens: int
    total_output_tokens: int
    total_cache_read_tokens: int
    total_cost_usd_sum: Decimal | None
