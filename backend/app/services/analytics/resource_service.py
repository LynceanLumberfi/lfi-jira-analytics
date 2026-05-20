from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import analytics_service
from app.services.analytics._helpers import (
    latest_completed_week_start,
    week_bounds,
)
from app.services.analytics_service import AnalyticsFilters

WEEK_STORY_LIMIT = 200


def get_resource(
    db: Session,
    *,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> dict[str, Any]:
    """Composite payload for the Analytics → Resource tab landing page."""
    trends = analytics_service.story_trends(
        db,
        last=12,
        team_ids=team_ids,
        has_sprint=True,
        sprint_id=sprint_id,
    )
    latest = latest_completed_week_start(trends, allow_in_progress=sprint_id is not None)
    empty_week_stories = {"items": [], "total": 0, "limit": WEEK_STORY_LIMIT, "offset": 0}
    if latest is None:
        return {
            "story_trends": trends,
            "latest_week_start": None,
            "week_team_breakdown": [],
            "week_assignee_breakdown": [],
            "week_stories": empty_week_stories,
        }

    if sprint_id is not None:
        # Single-sprint scope: filter by sprint_ids instead of resolved-in-week.
        filters = AnalyticsFilters(
            issue_type="Story",
            sprint_ids=(sprint_id,),
            has_sprint=True,
        )
    else:
        resolved_since, resolved_until = week_bounds(latest)
        filters = AnalyticsFilters(
            issue_type="Story",
            resolved_since=resolved_since,
            resolved_until=resolved_until,
            has_sprint=True,
        )
    week_team_breakdown = analytics_service.by_team(db, filters, team_ids=team_ids)
    week_assignee_breakdown = analytics_service.by_assignee(db, filters, team_ids=team_ids)
    week_stories = _list_week_stories(
        db,
        team_ids=team_ids,
        sprint_id=sprint_id,
        week_start=latest,
        limit=WEEK_STORY_LIMIT,
    )
    return {
        "story_trends": trends,
        "latest_week_start": latest,
        "week_team_breakdown": week_team_breakdown,
        "week_assignee_breakdown": week_assignee_breakdown,
        "week_stories": week_stories,
    }


def _list_week_stories(
    db: Session,
    *,
    team_ids: list[int] | None,
    sprint_id: int | None,
    week_start: date,
    limit: int,
) -> dict[str, Any]:
    """Sprint-linked Stories matching the Resource breakdown filter:

    - sprint_id set → stories whose latest sprint == sprint_id
    - otherwise → stories resolved during week_start's Mon–Sun span
    """
    clauses: list[str] = [
        "lower(f.issue_type) = 'story'",
        "f.issue_id IN (SELECT issue_id FROM issue_sprints)",
    ]
    params: dict[str, Any] = {"limit": limit}
    if sprint_id is not None:
        clauses.append(
            "f.issue_id IN ("
            " SELECT lsp.issue_id FROM ("
            "   SELECT DISTINCT ON (iss.issue_id) iss.issue_id, iss.sprint_id"
            "   FROM issue_sprints iss"
            "   JOIN sprints s ON s.id = iss.sprint_id"
            "   WHERE s.end_date IS NOT NULL"
            "   ORDER BY iss.issue_id, s.end_date DESC"
            " ) lsp WHERE lsp.sprint_id = :sprint_id"
            ")"
        )
        params["sprint_id"] = sprint_id
    else:
        start_dt, end_dt = week_bounds(week_start)
        clauses.append("f.resolved_at >= :start_dt")
        clauses.append("f.resolved_at <  :end_dt")
        params["start_dt"] = start_dt
        params["end_dt"] = end_dt
    if team_ids:
        clauses.append("f.team_id = ANY(:team_ids)")
        params["team_ids"] = team_ids
    where = "WHERE " + " AND ".join(clauses)

    total = db.execute(
        text(f"SELECT COUNT(*) FROM v_issue_facts f {where}"),
        params,
    ).scalar_one() or 0

    sql = text(
        f"""
        SELECT
            f.issue_id,
            f.jira_key,
            f.project,
            f.summary,
            f.issue_type,
            f.status,
            f.priority,
            f.epic_key,
            f.story_points,
            f.estimate_hours,
            f.spent_hours,
            f.no_description,
            f.over_budget,
            f.is_done,
            f.assignee_id,
            f.assignee_name,
            f.team_id,
            f.team_name,
            f.quality_score,
            f.ai_plan_detected,
            f.skill_usage_detected,
            f.skill_name,
            f.ai_scoring_status,
            f.scored_at,
            f.created_at,
            f.updated_at,
            f.resolved_at,
            ls.id    AS sprint_id,
            ls.name  AS sprint_name,
            ls.state AS sprint_state
        FROM v_issue_facts f
        LEFT JOIN LATERAL (
            SELECT s.id, s.name, s.state
            FROM issue_sprints iss
            JOIN sprints s ON s.id = iss.sprint_id
            WHERE iss.issue_id = f.issue_id AND s.end_date IS NOT NULL
            ORDER BY s.end_date DESC
            LIMIT 1
        ) ls ON TRUE
        {where}
        ORDER BY f.jira_key ASC, f.issue_id DESC
        LIMIT :limit
        """
    )
    rows = db.execute(sql, params).all()
    items = [dict(r._mapping) for r in rows]
    return {"items": items, "total": int(total), "limit": limit, "offset": 0}
