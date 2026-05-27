from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.analytics import (
    AiAdoptionResponseOut,
    AssigneeAggregateOut,
    BugWeeklyTrendOut,
    CadenceIssueTypeTrendOut,
    CadenceTrendOut,
    CostSummaryOut,
    EpicProgressOut,
    IssueTypeTrendOut,
    OverviewResponseOut,
    OverviewSummaryOut,
    QualityResponseOut,
    ResourceResponseOut,
    SprintVelocityOut,
    StoryTrendOut,
    TeamAggregateOut,
)
from app.services import analytics_service
from app.services.analytics import (
    ai_adoption_service,
    overview_service,
    quality_service,
    resource_service,
)
from app.services.analytics._helpers import excluded_team_ids
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


# ---- Per-tab landing-page endpoints ----


_NO_MATCH_SENTINEL: list[int] = [-1]


def _resolve_team_ids(
    team_id: int | None, team_ids: list[int], db: Session
) -> list[int]:
    """Merge ?team_id=N and ?team_ids=A&team_ids=B into a single list, then
    strip teams that are globally excluded from analytics tab endpoints
    (`EXCLUDED_TEAM_NAMES` in `_helpers.py`).

    When the caller passed nothing, resolve to every non-excluded team ID so
    downstream queries get an explicit whitelist (and Integration etc. can
    never leak in via a None / "no filter" code path). When the caller's
    whitelist becomes empty after exclusion, return a sentinel that matches no
    real team (so the IN-clause returns zero rows instead of silently widening
    to all teams).
    """
    effective = list(team_ids or [])
    if team_id is not None and team_id not in effective:
        effective.append(team_id)
    excluded = excluded_team_ids(db)
    if effective:
        filtered = [t for t in effective if t not in excluded]
        return filtered or _NO_MATCH_SENTINEL
    rows = db.execute(
        text("SELECT id FROM teams WHERE NOT (id = ANY(:excluded))"),
        {"excluded": list(excluded) if excluded else [-1]},
    ).all()
    all_ids = [int(r[0]) for r in rows]
    return all_ids or _NO_MATCH_SENTINEL


@router.get("/overview", response_model=OverviewResponseOut)
def overview(
    team_id: int | None = Query(None),
    team_ids: list[int] = Query(default=[]),
    sprint_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> OverviewResponseOut:
    payload = overview_service.get_overview(
        db,
        team_ids=_resolve_team_ids(team_id, team_ids, db),
        sprint_id=sprint_id,
    )
    return OverviewResponseOut(
        story_trends=[StoryTrendOut(**_coerce(r)) for r in payload["story_trends"]],
        issue_type_trends=[
            IssueTypeTrendOut(**_coerce(r)) for r in payload["issue_type_trends"]
        ],
    )


@router.get("/ai-adoption", response_model=AiAdoptionResponseOut)
def ai_adoption(
    team_id: int | None = Query(None),
    team_ids: list[int] = Query(default=[]),
    sprint_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> AiAdoptionResponseOut:
    payload = ai_adoption_service.get_ai_adoption(
        db,
        team_ids=_resolve_team_ids(team_id, team_ids, db),
        sprint_id=sprint_id,
    )
    return AiAdoptionResponseOut(
        story_trends=[CadenceTrendOut(**_coerce(r)) for r in payload["story_trends"]],
        cadence_start=payload["cadence_start"],
        cadence_end=payload["cadence_end"],
        cadence_sprint_ids=payload["cadence_sprint_ids"],
        cadence_team_breakdown=[
            TeamAggregateOut(**_coerce(r)) for r in payload["cadence_team_breakdown"]
        ],
        cadence_assignee_breakdown=[
            AssigneeAggregateOut(**_coerce(r)) for r in payload["cadence_assignee_breakdown"]
        ],
        cadence_stories=payload["cadence_stories"],
    )


@router.get("/resource", response_model=ResourceResponseOut)
def resource(
    team_id: int | None = Query(None),
    team_ids: list[int] = Query(default=[]),
    sprint_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> ResourceResponseOut:
    payload = resource_service.get_resource(
        db,
        team_ids=_resolve_team_ids(team_id, team_ids, db),
        sprint_id=sprint_id,
    )
    return ResourceResponseOut(
        story_trends=[CadenceTrendOut(**_coerce(r)) for r in payload["story_trends"]],
        cadence_start=payload["cadence_start"],
        cadence_end=payload["cadence_end"],
        cadence_sprint_ids=payload["cadence_sprint_ids"],
        cadence_team_breakdown=[
            TeamAggregateOut(**_coerce(r)) for r in payload["cadence_team_breakdown"]
        ],
        cadence_assignee_breakdown=[
            AssigneeAggregateOut(**_coerce(r)) for r in payload["cadence_assignee_breakdown"]
        ],
        prev_only_assignees=[
            AssigneeAggregateOut(**_coerce(r)) for r in payload["prev_only_assignees"]
        ],
        prev_cadence_assignee_ids=payload["prev_cadence_assignee_ids"],
        cadence_stories=payload["cadence_stories"],
    )


@router.get("/quality", response_model=QualityResponseOut)
def quality(
    team_id: int | None = Query(None),
    team_ids: list[int] = Query(default=[]),
    sprint_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> QualityResponseOut:
    payload = quality_service.get_quality(
        db,
        team_ids=_resolve_team_ids(team_id, team_ids, db),
        sprint_id=sprint_id,
    )
    team_b = payload["cadence_team_breakdown"]
    assignee_b = payload["cadence_assignee_breakdown"]
    return QualityResponseOut(
        issue_type_trends=[
            CadenceIssueTypeTrendOut(**_coerce(r)) for r in payload["issue_type_trends"]
        ],
        bug_weekly_trends=[
            BugWeeklyTrendOut(**_coerce(r)) for r in payload["bug_weekly_trends"]
        ],
        cadence_start=payload["cadence_start"],
        cadence_end=payload["cadence_end"],
        cadence_sprint_ids=payload["cadence_sprint_ids"],
        cadence_team_breakdown={
            "story": [TeamAggregateOut(**_coerce(r)) for r in team_b["story"]],
            "bug": [TeamAggregateOut(**_coerce(r)) for r in team_b["bug"]],
            "task": [TeamAggregateOut(**_coerce(r)) for r in team_b["task"]],
        },
        cadence_assignee_breakdown={
            "story": [AssigneeAggregateOut(**_coerce(r)) for r in assignee_b["story"]],
            "bug": [AssigneeAggregateOut(**_coerce(r)) for r in assignee_b["bug"]],
            "task": [AssigneeAggregateOut(**_coerce(r)) for r in assignee_b["task"]],
        },
    )


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
