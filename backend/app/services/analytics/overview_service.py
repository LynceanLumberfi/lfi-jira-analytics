from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services import analytics_service


def get_overview(
    db: Session,
    *,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> dict[str, Any]:
    """Composite payload for the Analytics → Overview tab landing page."""
    story_trends = analytics_service.story_trends(
        db,
        last=12,
        team_ids=team_ids,
        sprint_id=sprint_id,
    )
    issue_type_trends = analytics_service.issue_type_trends(
        db,
        last=12,
        team_ids=team_ids,
        sprint_id=sprint_id,
    )
    return {
        "story_trends": story_trends,
        "issue_type_trends": issue_type_trends,
    }
