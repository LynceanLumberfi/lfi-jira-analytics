from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services import analytics_service
from app.services.analytics._helpers import (
    cadence_for_sprint,
    latest_closed_cadence,
    latest_closed_sprint_cadence_for_team,
    recent_cadences,
    recent_sprint_cadences_for_team,
)
from app.services.analytics_service import AnalyticsFilters


def _resolve_cadences(
    db: Session,
    *,
    team_ids: list[int] | None,
    sprint_id: int | None,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    single_team = team_ids[0] if team_ids and len(team_ids) == 1 else None

    if sprint_id is not None:
        cadence = cadence_for_sprint(db, sprint_id)
        if single_team is not None:
            trends = recent_sprint_cadences_for_team(db, single_team, limit=12)
        else:
            trends = recent_cadences(db, limit=12)
        return cadence, trends

    if single_team is not None:
        cadence = latest_closed_sprint_cadence_for_team(db, single_team)
        trends = recent_sprint_cadences_for_team(db, single_team, limit=12)
        return cadence, trends

    cadence = latest_closed_cadence(db)
    trends = recent_cadences(db, limit=12)
    return cadence, trends


def get_quality(
    db: Session,
    *,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> dict[str, Any]:
    """Composite payload for the Analytics → Quality tab.

    Sprint-only — no ISO-week branch. The trends chart is one bar per cadence;
    the team breakdown uses the same sprint_ids as the heroes so counts align.
    """
    cadence, trends_cadences = _resolve_cadences(
        db, team_ids=team_ids, sprint_id=sprint_id
    )
    issue_type_trends = analytics_service.issue_type_trends_by_cadence(
        db, cadences=trends_cadences, team_ids=team_ids
    )

    if cadence is None:
        return {
            "issue_type_trends": issue_type_trends,
            "cadence_start": None,
            "cadence_end": None,
            "cadence_sprint_ids": [],
            "cadence_team_breakdown": {"story": [], "bug": [], "task": []},
            "cadence_assignee_breakdown": {"story": [], "bug": [], "task": []},
        }

    common = {
        "sprint_ids": tuple(cadence["sprint_ids"]),
        "has_sprint": True,
        "is_done": True,
    }
    by_type = {
        "story": analytics_service.by_team(
            db, AnalyticsFilters(issue_type="Story", **common), team_ids=team_ids
        ),
        "bug": analytics_service.by_team(
            db, AnalyticsFilters(issue_type="Bug", **common), team_ids=team_ids
        ),
        "task": analytics_service.by_team(
            db, AnalyticsFilters(issue_type="Task", **common), team_ids=team_ids
        ),
    }
    by_assignee_type = {
        "story": analytics_service.by_assignee(
            db, AnalyticsFilters(issue_type="Story", **common), team_ids=team_ids
        ),
        "bug": analytics_service.by_assignee(
            db, AnalyticsFilters(issue_type="Bug", **common), team_ids=team_ids
        ),
        "task": analytics_service.by_assignee(
            db, AnalyticsFilters(issue_type="Task", **common), team_ids=team_ids
        ),
    }
    return {
        "issue_type_trends": issue_type_trends,
        "cadence_start": cadence["start_date"],
        "cadence_end": cadence["end_date"],
        "cadence_sprint_ids": list(cadence["sprint_ids"]),
        "cadence_team_breakdown": by_type,
        "cadence_assignee_breakdown": by_assignee_type,
    }
