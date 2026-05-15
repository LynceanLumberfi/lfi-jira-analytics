from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


# Default pricing for the cost panel — Claude Sonnet 4.6 list prices per MTok.
# Adjust here if scoring switches to a different model.
INPUT_PRICE_PER_MTOK = 3.0
OUTPUT_PRICE_PER_MTOK = 15.0
CACHE_READ_PRICE_PER_MTOK = 0.30


@dataclass(frozen=True)
class AnalyticsFilters:
    team_id: int | None = None
    sprint_id: int | None = None
    assignee_id: int | None = None
    project: str | None = None
    issue_type: str | None = None
    since: datetime | None = None
    until: datetime | None = None
    resolved_since: datetime | None = None
    resolved_until: datetime | None = None
    has_sprint: bool | None = None


def _where_clauses(filters: AnalyticsFilters, alias: str = "f") -> tuple[str, dict[str, Any]]:
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if filters.team_id is not None:
        clauses.append(f"{alias}.team_id = :team_id")
        params["team_id"] = filters.team_id
    if filters.assignee_id is not None:
        clauses.append(f"{alias}.assignee_id = :assignee_id")
        params["assignee_id"] = filters.assignee_id
    if filters.project:
        clauses.append(f"{alias}.project = :project")
        params["project"] = filters.project
    if filters.issue_type:
        clauses.append(f"lower({alias}.issue_type) = lower(:issue_type)")
        params["issue_type"] = filters.issue_type
    if filters.since is not None:
        clauses.append(f"{alias}.created_at >= :since")
        params["since"] = filters.since
    if filters.until is not None:
        clauses.append(f"{alias}.created_at <= :until")
        params["until"] = filters.until
    if filters.resolved_since is not None or filters.resolved_until is not None:
        clauses.append(f"{alias}.is_done IS TRUE")
    if filters.resolved_since is not None:
        clauses.append(f"{alias}.resolved_at >= :resolved_since")
        params["resolved_since"] = filters.resolved_since
    if filters.resolved_until is not None:
        clauses.append(f"{alias}.resolved_at < :resolved_until")
        params["resolved_until"] = filters.resolved_until
    if filters.sprint_id is not None:
        clauses.append(
            f"{alias}.issue_id IN (SELECT issue_id FROM issue_sprints WHERE sprint_id = :sprint_id)"
        )
        params["sprint_id"] = filters.sprint_id
    if filters.has_sprint is True:
        clauses.append(f"{alias}.issue_id IN (SELECT issue_id FROM issue_sprints)")
    elif filters.has_sprint is False:
        clauses.append(f"{alias}.issue_id NOT IN (SELECT issue_id FROM issue_sprints)")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


# ---------- by team ----------


def by_team(
    db: Session,
    filters: AnalyticsFilters,
    *,
    team_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    where, params = _where_clauses(filters)
    extra: list[str] = []
    _apply_team_filter(extra, params, None, team_ids)
    for clause in extra:
        term = clause.lstrip("AND ").strip()
        where = (where + " AND " + term) if where else ("WHERE " + term)
    sql = text(
        f"""
        SELECT
            f.team_id,
            f.team_name,
            f.jira_team_id,
            COUNT(*)                                                 AS issue_count,
            COUNT(*) FILTER (WHERE f.quality_score IS NOT NULL)      AS scored_count,
            AVG(f.quality_score)                                     AS avg_quality,
            SUM(f.story_points)                                      AS total_story_points,
            AVG(f.story_points)                                      AS avg_story_points,
            AVG(f.estimate_hours)                                    AS avg_estimate_hours,
            AVG(f.spent_hours)                                                             AS avg_spent_hours,
            COUNT(*) FILTER (WHERE f.skill_usage_detected IS TRUE)                         AS skill_count,
            COUNT(DISTINCT f.assignee_id) FILTER (WHERE f.skill_usage_detected IS TRUE)    AS skill_adopters,
            COUNT(DISTINCT f.assignee_id)                                                  AS active_devs,
            COUNT(*) FILTER (WHERE f.no_description)                                       AS no_description_count,
            COUNT(*) FILTER (WHERE f.over_budget)                                          AS over_budget_count,
            COUNT(*) FILTER (WHERE f.ai_plan_detected IS TRUE)                             AS ai_plan_count
        FROM v_issue_facts f
        {where}
        GROUP BY f.team_id, f.team_name, f.jira_team_id
        ORDER BY issue_count DESC
        """
    )
    return [dict(r._mapping) for r in db.execute(sql, params).all()]


# ---------- by assignee ----------


def by_assignee(db: Session, filters: AnalyticsFilters) -> list[dict[str, Any]]:
    where, params = _where_clauses(filters)
    sql = text(
        f"""
        SELECT
            f.assignee_id,
            f.assignee_name,
            f.assignee_email,
            f.team_id,
            f.team_name,
            COUNT(*)                                                 AS issue_count,
            COUNT(*) FILTER (WHERE f.quality_score IS NOT NULL)      AS scored_count,
            AVG(f.quality_score)                                     AS avg_quality,
            SUM(f.story_points)                                      AS total_story_points,
            AVG(f.story_points)                                      AS avg_story_points,
            AVG(f.estimate_hours)                                    AS avg_estimate_hours,
            AVG(f.spent_hours)                                       AS avg_spent_hours,
            COUNT(*) FILTER (WHERE f.skill_usage_detected IS TRUE)   AS skill_count,
            COUNT(*) FILTER (WHERE f.no_description)                 AS no_description_count,
            COUNT(*) FILTER (WHERE f.over_budget)                    AS over_budget_count,
            COUNT(*) FILTER (WHERE f.ai_plan_detected IS TRUE)       AS ai_plan_count
        FROM v_issue_facts f
        {("WHERE " if not where else where + " AND ") + "f.assignee_id IS NOT NULL"}
        GROUP BY f.assignee_id, f.assignee_name, f.assignee_email, f.team_id, f.team_name
        ORDER BY issue_count DESC
        """
    )
    return [dict(r._mapping) for r in db.execute(sql, params).all()]


# ---------- velocity ----------


def velocity(db: Session, filters: AnalyticsFilters, last: int = 7) -> list[dict[str, Any]]:
    sql = text(
        """
        SELECT *
        FROM v_sprint_velocity
        ORDER BY start_date DESC NULLS LAST
        LIMIT :last
        """
    )
    rows = db.execute(sql, {"last": last}).all()
    return [dict(r._mapping) for r in reversed(rows)]


# ---------- epics ----------


def epics(db: Session, project: str | None) -> list[dict[str, Any]]:
    sql = text(
        f"""
        SELECT *
        FROM v_epic_progress
        {"WHERE project = :project" if project else ""}
        ORDER BY total_count DESC
        """
    )
    params: dict[str, Any] = {"project": project} if project else {}
    return [dict(r._mapping) for r in db.execute(sql, params).all()]


# ---------- cost ----------


def cost_summary(
    db: Session, *, since: datetime | None, until: datetime | None
) -> dict[str, Any]:
    clauses = ["scored_at IS NOT NULL"]
    params: dict[str, Any] = {}
    if since is not None:
        clauses.append("scored_at >= :since")
        params["since"] = since
    if until is not None:
        clauses.append("scored_at <= :until")
        params["until"] = until
    where = "WHERE " + " AND ".join(clauses)

    sql = text(
        f"""
        SELECT
            COUNT(*)                                AS calls,
            COUNT(DISTINCT issue_id)                AS issues_scored,
            COALESCE(SUM(input_tokens), 0)          AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0)         AS total_output_tokens,
            COALESCE(SUM(cache_read_tokens), 0)     AS total_cache_read_tokens
        FROM issue_ai_scores
        {where}
        """
    )
    row = db.execute(sql, params).one()._mapping
    cost = (
        (row["total_input_tokens"] or 0) * INPUT_PRICE_PER_MTOK
        + (row["total_output_tokens"] or 0) * OUTPUT_PRICE_PER_MTOK
        + (row["total_cache_read_tokens"] or 0) * CACHE_READ_PRICE_PER_MTOK
    ) / 1_000_000.0
    return {
        "calls": row["calls"] or 0,
        "issues_scored": row["issues_scored"] or 0,
        "total_input_tokens": int(row["total_input_tokens"] or 0),
        "total_output_tokens": int(row["total_output_tokens"] or 0),
        "total_cache_read_tokens": int(row["total_cache_read_tokens"] or 0),
        "cost_usd": round(cost, 4),
    }


def _apply_team_filter(
    clauses: list[str],
    params: dict[str, Any],
    team_id: int | None,
    team_ids: list[int] | None,
) -> None:
    """Append a team filter clause. team_ids takes precedence over team_id."""
    effective = list(team_ids) if team_ids else ([team_id] if team_id is not None else [])
    if not effective:
        return
    if len(effective) == 1:
        clauses.append("AND f.team_id = :team_id_single")
        params["team_id_single"] = effective[0]
    else:
        placeholders = ", ".join(f":tid_{i}" for i in range(len(effective)))
        clauses.append(f"AND f.team_id IN ({placeholders})")
        for i, tid in enumerate(effective):
            params[f"tid_{i}"] = int(tid)


# ---------- story trends (weekly, Overview chart) ----------


def story_trends(
    db: Session,
    *,
    last: int = 12,
    project: str | None = None,
    team_id: int | None = None,
    team_ids: list[int] | None = None,
    has_sprint: bool | None = None,
) -> list[dict[str, Any]]:
    extra_clauses = []
    params: dict[str, Any] = {"last": last}
    if project:
        extra_clauses.append("AND f.project = :project")
        params["project"] = project
    _apply_team_filter(extra_clauses, params, team_id, team_ids)
    if has_sprint is True:
        extra_clauses.append("AND f.issue_id IN (SELECT issue_id FROM issue_sprints)")
    elif has_sprint is False:
        extra_clauses.append("AND f.issue_id NOT IN (SELECT issue_id FROM issue_sprints)")
    extra = "\n            ".join(extra_clauses)

    sql = text(
        f"""
        WITH bounds AS (
            SELECT (date_trunc('week', NOW()) - ((:last - 1) * INTERVAL '1 week'))::date AS week_from
        ),
        weeks AS (
            SELECT generate_series(
                (SELECT week_from FROM bounds),
                date_trunc('week', NOW())::date,
                INTERVAL '1 week'
            )::date AS week_start
        ),
        done_stories AS (
            SELECT
                date_trunc('week', f.resolved_at)::date AS week_start,
                f.assignee_id,
                f.story_points,
                f.spent_hours,
                f.skill_usage_detected,
                (f.quality_score IS NOT NULL) AS is_scored
            FROM v_issue_facts f
            WHERE f.issue_type = 'Story'
              AND f.is_done IS TRUE
              AND f.resolved_at >= (SELECT week_from FROM bounds)
              {extra}
        ),
        done_any_weekly AS (
            SELECT
                date_trunc('week', f.resolved_at)::date  AS week_start,
                COUNT(DISTINCT f.assignee_id)            AS active_delivered_devs
            FROM v_issue_facts f
            WHERE f.is_done IS TRUE
              AND f.resolved_at >= (SELECT week_from FROM bounds)
              AND f.assignee_id IS NOT NULL
              {extra}
            GROUP BY 1
        )
        SELECT
            w.week_start,
            COALESCE(SUM(d.story_points), 0)                                                AS story_points,
            CASE WHEN COUNT(*) FILTER (WHERE d.is_scored) > 0
                 THEN COUNT(*) FILTER (WHERE d.skill_usage_detected IS TRUE)::float
                      / COUNT(*) FILTER (WHERE d.is_scored)
                 ELSE NULL END                                                              AS skill_adoption_rate,
            CASE WHEN COUNT(DISTINCT d.assignee_id) > 0
                 THEN SUM(d.story_points) / NULLIF(COUNT(DISTINCT d.assignee_id), 0)
                 ELSE NULL END                                                              AS points_per_active_resource,
            CASE WHEN SUM(d.story_points) FILTER (WHERE d.spent_hours > 0 AND d.story_points > 0) > 0
                 THEN SUM(d.spent_hours) FILTER (WHERE d.spent_hours > 0 AND d.story_points > 0)
                      / SUM(d.story_points) FILTER (WHERE d.spent_hours > 0 AND d.story_points > 0)
                 ELSE NULL END                                                              AS hours_per_point,
            COUNT(d.assignee_id)                                                            AS story_count,
            COUNT(*) FILTER (WHERE d.is_scored)                                             AS scored_count,
            COUNT(DISTINCT d.assignee_id)                                                   AS active_resources,
            COUNT(*) FILTER (WHERE d.spent_hours > 0 AND d.story_points > 0)               AS hour_logged_count,
            COUNT(*) FILTER (WHERE d.skill_usage_detected IS TRUE)                          AS skill_count,
            COUNT(DISTINCT d.assignee_id) FILTER (WHERE d.skill_usage_detected IS TRUE)     AS skill_adopters,
            COALESCE(a.active_delivered_devs, 0)                                            AS active_delivered_devs
        FROM weeks w
        LEFT JOIN done_stories d USING (week_start)
        LEFT JOIN done_any_weekly a USING (week_start)
        GROUP BY w.week_start, a.active_delivered_devs
        ORDER BY w.week_start ASC
        """
    )
    rows = db.execute(sql, params).all()
    return [dict(r._mapping) for r in rows]


# ---------- issue-type trends (weekly completed counts by type) ----------


def issue_type_trends(
    db: Session,
    *,
    last: int = 12,
    project: str | None = None,
    team_id: int | None = None,
    team_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    extra_clauses = []
    params: dict[str, Any] = {"last": last}
    if project:
        extra_clauses.append("AND f.project = :project")
        params["project"] = project
    _apply_team_filter(extra_clauses, params, team_id, team_ids)
    extra = "\n              ".join(extra_clauses)

    sql = text(
        f"""
        WITH bounds AS (
            SELECT (date_trunc('week', NOW()) - ((:last - 1) * INTERVAL '1 week'))::date AS week_from
        ),
        weeks AS (
            SELECT generate_series(
                (SELECT week_from FROM bounds),
                date_trunc('week', NOW())::date,
                INTERVAL '1 week'
            )::date AS week_start
        ),
        done_issues AS (
            SELECT
                date_trunc('week', f.resolved_at)::date AS week_start,
                lower(f.issue_type)                     AS issue_type
            FROM v_issue_facts f
            WHERE f.is_done IS TRUE
              AND f.resolved_at >= (SELECT week_from FROM bounds)
              AND lower(f.issue_type) IN ('story', 'bug', 'task')
              {extra}
        )
        SELECT
            w.week_start,
            COUNT(*) FILTER (WHERE d.issue_type = 'story') AS stories,
            COUNT(*) FILTER (WHERE d.issue_type = 'bug')   AS bugs,
            COUNT(*) FILTER (WHERE d.issue_type = 'task')  AS tasks,
            COUNT(d.issue_type)                            AS total
        FROM weeks w
        LEFT JOIN done_issues d USING (week_start)
        GROUP BY w.week_start
        ORDER BY w.week_start ASC
        """
    )
    return [dict(r._mapping) for r in db.execute(sql, params).all()]


# ---------- summary (overview hub KPI tiles) ----------


def overview_summary(db: Session, filters: AnalyticsFilters) -> dict[str, Any]:
    where, params = _where_clauses(filters)
    sql = text(
        f"""
        SELECT
            COUNT(*)                                                                AS total_issues,
            COUNT(*) FILTER (WHERE f.quality_score IS NOT NULL)                     AS scored_issues,
            AVG(f.quality_score)                                                    AS avg_quality,
            AVG(CASE WHEN f.ai_plan_detected IS TRUE THEN 1.0 ELSE 0.0 END)         AS avg_ai_plan_pct,
            AVG(CASE WHEN f.skill_usage_detected IS TRUE THEN 1.0 ELSE 0.0 END)     AS avg_skill_pct,
            COUNT(*) FILTER (WHERE f.no_description)                                AS no_description_count,
            COUNT(*) FILTER (WHERE f.over_budget)                                   AS over_budget_count
        FROM v_issue_facts f
        {where}
        """
    )
    row = db.execute(sql, params).one()._mapping

    open_failed = db.execute(
        text("SELECT COUNT(*) FROM failed_records WHERE dismissed_at IS NULL")
    ).scalar_one()

    return {
        "total_issues": row["total_issues"] or 0,
        "scored_issues": row["scored_issues"] or 0,
        "avg_quality": float(row["avg_quality"]) if row["avg_quality"] is not None else None,
        "avg_ai_plan_pct": (
            float(row["avg_ai_plan_pct"]) if row["avg_ai_plan_pct"] is not None else None
        ),
        "avg_skill_pct": (
            float(row["avg_skill_pct"]) if row["avg_skill_pct"] is not None else None
        ),
        "no_description_count": row["no_description_count"] or 0,
        "over_budget_count": row["over_budget_count"] or 0,
        "open_failed_records": open_failed or 0,
    }
