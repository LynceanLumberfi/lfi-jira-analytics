from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.analytics import (
    AssigneeAggregateOut,
    CostSummaryOut,
    EpicProgressOut,
    IssueTypeTrendOut,
    OverviewSummaryOut,
    SprintVelocityOut,
    StoryTrendOut,
    TeamAggregateOut,
)
from app.services import analytics_service
from app.services.analytics_service import AnalyticsFilters

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def get_filters(
    team_id: int | None = Query(None),
    sprint_id: int | None = Query(None),
    sprint_ids: list[int] | None = Query(None),
    assignee_id: int | None = Query(None),
    project: str | None = Query(None),
    issue_type: str | None = Query(None),
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    resolved_since: datetime | None = Query(None),
    resolved_until: datetime | None = Query(None),
    has_sprint: bool | None = Query(None),
    is_done: bool | None = Query(None),
) -> AnalyticsFilters:
    return AnalyticsFilters(
        team_id=team_id,
        sprint_id=sprint_id,
        sprint_ids=tuple(sprint_ids) if sprint_ids else None,
        assignee_id=assignee_id,
        project=project,
        issue_type=issue_type,
        since=since,
        until=until,
        resolved_since=resolved_since,
        resolved_until=resolved_until,
        has_sprint=has_sprint,
        is_done=is_done,
    )


@router.get("/by-team", response_model=list[TeamAggregateOut])
def by_team(
    filters: AnalyticsFilters = Depends(get_filters),
    team_ids: list[int] = Query(default=[]),
    db: Session = Depends(get_db),
) -> list[TeamAggregateOut]:
    rows = analytics_service.by_team(db, filters, team_ids=team_ids or None)
    return [TeamAggregateOut(**_coerce(r)) for r in rows]


@router.get("/by-assignee", response_model=list[AssigneeAggregateOut])
def by_assignee(
    filters: AnalyticsFilters = Depends(get_filters),
    team_ids: list[int] = Query(default=[]),
    db: Session = Depends(get_db),
) -> list[AssigneeAggregateOut]:
    rows = analytics_service.by_assignee(db, filters, team_ids=team_ids or None)
    return [AssigneeAggregateOut(**_coerce(r)) for r in rows]


@router.get("/velocity", response_model=list[SprintVelocityOut])
def velocity(
    last: int = Query(7, ge=1, le=52),
    filters: AnalyticsFilters = Depends(get_filters),
    db: Session = Depends(get_db),
) -> list[SprintVelocityOut]:
    rows = analytics_service.velocity(db, filters, last=last)
    return [SprintVelocityOut(**_coerce(r)) for r in rows]


@router.get("/epics", response_model=list[EpicProgressOut])
def epics(
    project: str | None = Query(None),
    db: Session = Depends(get_db),
) -> list[EpicProgressOut]:
    rows = analytics_service.epics(db, project=project)
    return [EpicProgressOut(**_coerce(r)) for r in rows]


@router.get("/story-trends", response_model=list[StoryTrendOut])
def story_trends(
    last: int = Query(12, ge=1, le=52),
    project: str | None = Query(None),
    team_id: int | None = Query(None),
    team_ids: list[int] = Query(default=[]),
    has_sprint: bool | None = Query(None),
    sprint_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> list[StoryTrendOut]:
    rows = analytics_service.story_trends(
        db, last=last, project=project, team_id=team_id,
        team_ids=team_ids or None, has_sprint=has_sprint,
        sprint_id=sprint_id,
    )
    return [StoryTrendOut(**_coerce(r)) for r in rows]


@router.get("/issue-type-trends", response_model=list[IssueTypeTrendOut])
def issue_type_trends(
    last: int = Query(12, ge=1, le=52),
    project: str | None = Query(None),
    team_id: int | None = Query(None),
    team_ids: list[int] = Query(default=[]),
    sprint_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> list[IssueTypeTrendOut]:
    rows = analytics_service.issue_type_trends(
        db, last=last, project=project, team_id=team_id,
        team_ids=team_ids or None, sprint_id=sprint_id,
    )
    return [IssueTypeTrendOut(**_coerce(r)) for r in rows]


@router.get("/cost", response_model=CostSummaryOut)
def cost(
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    db: Session = Depends(get_db),
) -> CostSummaryOut:
    return CostSummaryOut(**analytics_service.cost_summary(db, since=since, until=until))


@router.get("/summary", response_model=OverviewSummaryOut)
def summary(
    filters: AnalyticsFilters = Depends(get_filters),
    db: Session = Depends(get_db),
) -> OverviewSummaryOut:
    return OverviewSummaryOut(**analytics_service.overview_summary(db, filters))


def _coerce(row: dict) -> dict:
    """Coerce numeric Postgres types (Decimal) to float for Pydantic."""
    out: dict = {}
    for key, value in row.items():
        if value is None:
            out[key] = None
        elif hasattr(value, "is_finite") and not isinstance(value, (int, float)):
            out[key] = float(value)
        else:
            out[key] = value
    return out
