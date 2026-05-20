from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import analytics_service
from app.services.analytics._helpers import (
    cadence_for_sprint,
    latest_closed_cadence,
    latest_closed_sprint_cadence_for_team,
    previous_cadence,
    previous_sprint_id_by_prefix,
    recent_cadences,
    recent_sprint_cadences_for_team,
)
from app.services.analytics_service import AnalyticsFilters

STORY_LIMIT = 200


def _resolve_cadences(
    db: Session,
    *,
    team_ids: list[int] | None,
    sprint_id: int | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, list[dict[str, Any]]]:
    """Resolve (current cadence, previous cadence, trends cadences).

    Three modes:
    - explicit sprint_id (drill-down with picker) → that sprint is the cadence,
      previous = previous_sprint_id() chain.
    - single team_id, no sprint → latest closed sprint for that team; trends =
      last 12 sprints of that team.
    - multiple team_ids (landing) → synchronized FS/BFX/HR cadence; trends =
      last 12 synchronized cadences.
    """
    single_team = team_ids[0] if team_ids and len(team_ids) == 1 else None

    if sprint_id is not None:
        cadence = cadence_for_sprint(db, sprint_id)
        if single_team is not None:
            trends = recent_sprint_cadences_for_team(db, single_team, limit=12)
            prev_sid = previous_sprint_id_by_prefix(db, sprint_id)
            prev = cadence_for_sprint(db, prev_sid) if prev_sid is not None else None
        else:
            trends = recent_cadences(db, limit=12)
            prev = (
                previous_cadence(db, cadence["end_date"]) if cadence else None
            )
        return cadence, prev, trends

    if single_team is not None:
        cadence = latest_closed_sprint_cadence_for_team(db, single_team)
        trends = recent_sprint_cadences_for_team(db, single_team, limit=12)
        prev = None
        if cadence is not None:
            prev_sid = previous_sprint_id_by_prefix(db, cadence["sprint_ids"][0])
            prev = (
                cadence_for_sprint(db, prev_sid) if prev_sid is not None else None
            )
        return cadence, prev, trends

    cadence = latest_closed_cadence(db)
    trends = recent_cadences(db, limit=12)
    prev = previous_cadence(db, cadence["end_date"]) if cadence else None
    return cadence, prev, trends


def get_resource(
    db: Session,
    *,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> dict[str, Any]:
    """Composite payload for the Analytics → Resource tab.

    Sprint-only — no ISO-week branch. Landing pages use the synchronized
    FS/BFX/HR cadence; team drill-downs use a single sprint cadence.
    """
    cadence, prev_cadence, trends_cadences = _resolve_cadences(
        db, team_ids=team_ids, sprint_id=sprint_id
    )
    trends = analytics_service.story_trends_by_cadence(
        db, cadences=trends_cadences, team_ids=team_ids
    )
    empty_stories = {"items": [], "total": 0, "limit": STORY_LIMIT, "offset": 0}

    if cadence is None:
        return {
            "story_trends": trends,
            "cadence_start": None,
            "cadence_end": None,
            "cadence_sprint_ids": [],
            "cadence_team_breakdown": [],
            "cadence_assignee_breakdown": [],
            "prev_only_assignees": [],
            "prev_cadence_assignee_ids": [],
            "cadence_stories": empty_stories,
        }

    filters = AnalyticsFilters(
        issue_type="Story",
        sprint_ids=tuple(cadence["sprint_ids"]),
        has_sprint=True,
    )
    cadence_team_breakdown = analytics_service.by_team(db, filters, team_ids=team_ids)
    cadence_assignee_breakdown = analytics_service.by_assignee(
        db, filters, team_ids=team_ids
    )

    prev_only_assignees: list[dict[str, Any]] = []
    prev_cadence_assignee_ids: list[int] = []
    if prev_cadence is not None:
        prev_filters = AnalyticsFilters(
            issue_type="Story",
            sprint_ids=tuple(prev_cadence["sprint_ids"]),
            has_sprint=True,
        )
        prev_assignees = analytics_service.by_assignee(
            db, prev_filters, team_ids=team_ids
        )
        curr_ids = {
            r["assignee_id"]
            for r in cadence_assignee_breakdown
            if r.get("assignee_id") is not None
        }
        prev_only_assignees = [
            r for r in prev_assignees if r.get("assignee_id") not in curr_ids
        ]
        prev_cadence_assignee_ids = [
            int(r["assignee_id"])
            for r in prev_assignees
            if r.get("assignee_id") is not None
        ]

    cadence_stories = _list_cadence_stories(
        db,
        team_ids=team_ids,
        sprint_ids=cadence["sprint_ids"],
        limit=STORY_LIMIT,
    )
    return {
        "story_trends": trends,
        "cadence_start": cadence["start_date"],
        "cadence_end": cadence["end_date"],
        "cadence_sprint_ids": list(cadence["sprint_ids"]),
        "cadence_team_breakdown": cadence_team_breakdown,
        "cadence_assignee_breakdown": cadence_assignee_breakdown,
        "prev_only_assignees": prev_only_assignees,
        "prev_cadence_assignee_ids": prev_cadence_assignee_ids,
        "cadence_stories": cadence_stories,
    }


def _list_cadence_stories(
    db: Session,
    *,
    team_ids: list[int] | None,
    sprint_ids: list[int],
    limit: int,
) -> dict[str, Any]:
    """Stories whose latest sprint is one of `sprint_ids`."""
    clauses: list[str] = [
        "lower(f.issue_type) = 'story'",
        "(f.summary IS NULL OR ltrim(f.summary) NOT ILIKE '[QA]%')",
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
    params: dict[str, Any] = {"limit": limit, "sprint_ids": list(sprint_ids)}
    if team_ids:
        clauses.append("f.team_id = ANY(:team_ids)")
        params["team_ids"] = team_ids
    where = "WHERE " + " AND ".join(clauses)

    total = (
        db.execute(text(f"SELECT COUNT(*) FROM v_issue_facts f {where}"), params).scalar_one()
        or 0
    )

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
