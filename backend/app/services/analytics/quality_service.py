from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services import analytics_service
from app.services.analytics._helpers import (
    latest_completed_week_start,
    week_bounds,
)
from app.services.analytics_service import AnalyticsFilters


def get_quality(
    db: Session,
    *,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> dict[str, Any]:
    """Composite payload for the Analytics → Quality tab landing page."""
    trends = analytics_service.issue_type_trends(
        db,
        last=12,
        team_ids=team_ids,
        sprint_id=sprint_id,
    )
    latest = latest_completed_week_start(trends, allow_in_progress=sprint_id is not None)
    if latest is None:
        return {
            "issue_type_trends": trends,
            "latest_week_start": None,
            "week_team_breakdown": {"story": [], "bug": [], "task": []},
        }

    if sprint_id is not None:
        common: dict[str, Any] = {"sprint_ids": (sprint_id,)}
    else:
        resolved_since, resolved_until = week_bounds(latest)
        common = {
            "resolved_since": resolved_since,
            "resolved_until": resolved_until,
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
    return {
        "issue_type_trends": trends,
        "latest_week_start": latest,
        "week_team_breakdown": by_type,
    }
