from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import analytics_service
from app.services.analytics._helpers import (
    latest_completed_week_start,
    sprint_ids_ending_in_week,
)
from app.services.analytics_service import AnalyticsFilters

WEEK_STORY_LIMIT = 200


def get_ai_adoption(
    db: Session,
    *,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> dict[str, Any]:
    """Composite payload for the Analytics → AI Adoption tab landing page."""
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
            "week_sprint_ids": [],
            "week_team_breakdown": [],
            "week_assignee_breakdown": [],
            "week_stories": empty_week_stories,
        }

    if sprint_id is not None:
        sprint_ids = [sprint_id]
    else:
        sprint_ids = sprint_ids_ending_in_week(db, latest)
    if not sprint_ids:
        return {
            "story_trends": trends,
            "latest_week_start": latest,
            "week_sprint_ids": [],
            "week_team_breakdown": [],
            "week_assignee_breakdown": [],
            "week_stories": empty_week_stories,
        }

    filters = AnalyticsFilters(
        issue_type="Story",
        is_done=True,
        sprint_ids=tuple(sprint_ids),
        has_sprint=True,
    )
    week_team_breakdown = analytics_service.by_team(db, filters, team_ids=team_ids)
    week_assignee_breakdown = analytics_service.by_assignee(db, filters, team_ids=team_ids)
    week_stories = _list_week_stories(
        db,
        team_ids=team_ids,
        sprint_ids=sprint_ids,
        limit=WEEK_STORY_LIMIT,
    )
    return {
        "story_trends": trends,
        "latest_week_start": latest,
        "week_sprint_ids": sprint_ids,
        "week_team_breakdown": week_team_breakdown,
        "week_assignee_breakdown": week_assignee_breakdown,
        "week_stories": week_stories,
    }


def _list_week_stories(
    db: Session,
    *,
    team_ids: list[int] | None,
    sprint_ids: list[int],
    limit: int,
) -> dict[str, Any]:
    """Mirrors the AiAdoption getIssues() call: Story+done, sprint-bucketed,
    sorted by jira_key asc. Latest-sprint-per-issue must be in `sprint_ids` to
    stay consistent with the KPI bucketing in story_trends.
    """
    clauses: list[str] = [
        "lower(f.issue_type) = 'story'",
        "f.is_done IS TRUE",
        "f.issue_id IN (SELECT issue_id FROM issue_sprints)",
        (
            "f.issue_id IN ("
            " SELECT lsp.issue_id FROM ("
            "   SELECT DISTINCT ON (iss.issue_id) iss.issue_id, iss.sprint_id"
            "   FROM issue_sprints iss"
            "   JOIN sprints s ON s.id = iss.sprint_id"
            "   WHERE s.end_date IS NOT NULL"
            "   ORDER BY iss.issue_id, s.end_date DESC"
            " ) lsp WHERE lsp.sprint_id = ANY(:sprint_ids)"
            ")"
        ),
    ]
    params: dict[str, Any] = {"sprint_ids": sprint_ids, "limit": limit}
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
