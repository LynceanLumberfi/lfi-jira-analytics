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
    sprint_ids: tuple[int, ...] | None = None
    assignee_id: int | None = None
    project: str | None = None
    issue_type: str | None = None
    since: datetime | None = None
    until: datetime | None = None
    resolved_since: datetime | None = None
    resolved_until: datetime | None = None
    has_sprint: bool | None = None
    is_done: bool | None = None


# Analytics tabs exclude QA-prefixed work (summary starts with "[QA]") org-wide.
# These are testing tickets that distort velocity, skill adoption, and bug
# ratios. Applied case-insensitively to catch "[QA]", "[QA] ", "[QA]-", etc.
# ltrim() because some titles slipped through with a leading space before [QA].
# NULL summaries are preserved (LIKE on NULL yields NULL, so the OR keeps them).
def _exclude_qa_clause(alias: str = "f") -> str:
    return f"({alias}.summary IS NULL OR ltrim({alias}.summary) NOT ILIKE '[QA]%')"


def _where_clauses(filters: AnalyticsFilters, alias: str = "f") -> tuple[str, dict[str, Any]]:
    clauses: list[str] = [_exclude_qa_clause(alias)]
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
    if filters.sprint_ids:
        # "Latest sprint per issue must be in this set" — matches the bucketing
        # used by story_trends so KPI heroes and breakdowns stay consistent.
        clauses.append(
            f"{alias}.issue_id IN ("
            " SELECT lsp.issue_id FROM ("
            "   SELECT DISTINCT ON (iss.issue_id) iss.issue_id, iss.sprint_id"
            "   FROM issue_sprints iss"
            "   JOIN sprints s ON s.id = iss.sprint_id"
            "   WHERE s.end_date IS NOT NULL"
            "   ORDER BY iss.issue_id, s.end_date DESC"
            " ) lsp WHERE lsp.sprint_id = ANY(:sprint_ids)"
            ")"
        )
        params["sprint_ids"] = list(filters.sprint_ids)
    if filters.has_sprint is True:
        clauses.append(f"{alias}.issue_id IN (SELECT issue_id FROM issue_sprints)")
    elif filters.has_sprint is False:
        clauses.append(f"{alias}.issue_id NOT IN (SELECT issue_id FROM issue_sprints)")
    if filters.is_done is True:
        clauses.append(f"{alias}.is_done IS TRUE")
    elif filters.is_done is False:
        clauses.append(f"{alias}.is_done IS NOT TRUE")
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


def by_assignee(
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


def _build_universe_cte(sprint_id: int | None) -> str:
    if sprint_id is not None:
        return """
        in_universe AS (
            SELECT iss.issue_id,
                   date_trunc('week', s.end_date)::date AS week_start
            FROM issue_sprints iss
            JOIN sprints s ON s.id = iss.sprint_id
            WHERE s.end_date IS NOT NULL
              AND iss.sprint_id = :sprint_id
        )"""
    return """
        latest_sprint_per_issue AS (
            SELECT DISTINCT ON (iss.issue_id)
                iss.issue_id,
                s.end_date,
                date_trunc('week', s.end_date)::date AS week_start
            FROM issue_sprints iss
            JOIN sprints s ON s.id = iss.sprint_id
            WHERE s.end_date IS NOT NULL
            ORDER BY iss.issue_id, s.end_date DESC
        ),
        in_universe AS (
            SELECT issue_id, week_start
            FROM latest_sprint_per_issue
            WHERE EXTRACT(YEAR FROM end_date) = :year
        )"""


def story_trends(
    db: Session,
    *,
    last: int = 12,
    project: str | None = None,
    team_id: int | None = None,
    team_ids: list[int] | None = None,
    has_sprint: bool | None = None,
    sprint_id: int | None = None,
) -> list[dict[str, Any]]:
    # `last` and `has_sprint` are accepted for API compatibility but no longer
    # affect the query: bucketing is by sprint end_date (year 2026 by default,
    # or one specific sprint when sprint_id is set). Sprint linkage is implicit.
    extra_clauses = []
    params: dict[str, Any] = {}
    if sprint_id is not None:
        params["sprint_id"] = sprint_id
    else:
        params["year"] = 2026
    if project:
        extra_clauses.append("AND f.project = :project")
        params["project"] = project
    _apply_team_filter(extra_clauses, params, team_id, team_ids)
    extra = "\n            ".join(extra_clauses)
    universe_cte = _build_universe_cte(sprint_id)

    sql = text(
        f"""
        WITH {universe_cte},
        weeks AS (
            SELECT generate_series(
                COALESCE((SELECT MIN(week_start) FROM in_universe), date_trunc('week', NOW())::date),
                LEAST(
                    COALESCE((SELECT MAX(week_start) FROM in_universe), date_trunc('week', NOW())::date),
                    date_trunc('week', NOW())::date
                ),
                INTERVAL '1 week'
            )::date AS week_start
        ),
        done_stories AS (
            SELECT
                i2.week_start,
                f.assignee_id,
                f.story_points,
                f.spent_hours,
                f.skill_usage_detected,
                (f.quality_score IS NOT NULL) AS is_scored
            FROM v_issue_facts f
            JOIN in_universe i2 ON i2.issue_id = f.issue_id
            WHERE f.issue_type = 'Story'
              AND f.is_done IS TRUE
              AND (f.summary IS NULL OR ltrim(f.summary) NOT ILIKE '[QA]%')
              {extra}
        ),
        done_any_weekly AS (
            SELECT
                i2.week_start,
                COUNT(DISTINCT f.assignee_id) AS active_delivered_devs
            FROM v_issue_facts f
            JOIN in_universe i2 ON i2.issue_id = f.issue_id
            WHERE f.issue_type = 'Story'
              AND f.is_done IS TRUE
              AND f.assignee_id IS NOT NULL
              AND (f.summary IS NULL OR ltrim(f.summary) NOT ILIKE '[QA]%')
              {extra}
            GROUP BY i2.week_start
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


# ---------- story trends by cadence (Resource tab) ----------


def story_trends_by_cadence(
    db: Session,
    *,
    cadences: list[dict[str, Any]],
    team_ids: list[int] | None = None,
    project: str | None = None,
) -> list[dict[str, Any]]:
    """One row per cadence with the same shape as story_trends().

    Each cadence is `{start_date, end_date, sprint_ids}` — the aggregation
    filters issues whose latest sprint is in `sprint_ids`. Used by the Resource
    tab trends chart, where each x-tick is a synchronized cadence (landing) or
    a single team sprint (drill-down).
    """
    if not cadences:
        return []
    results: list[dict[str, Any]] = []
    for cadence in cadences:
        filters = AnalyticsFilters(
            issue_type="Story",
            is_done=True,
            sprint_ids=tuple(cadence["sprint_ids"]),
            has_sprint=True,
            project=project,
        )
        where, params = _where_clauses(filters)
        extra: list[str] = []
        _apply_team_filter(extra, params, None, team_ids)
        for clause in extra:
            term = clause.lstrip("AND ").strip()
            where = (where + " AND " + term) if where else ("WHERE " + term)
        sql = text(
            f"""
            SELECT
                COALESCE(SUM(f.story_points), 0)                                              AS story_points,
                CASE WHEN COUNT(*) FILTER (WHERE f.quality_score IS NOT NULL) > 0
                     THEN COUNT(*) FILTER (WHERE f.skill_usage_detected IS TRUE)::float
                          / COUNT(*) FILTER (WHERE f.quality_score IS NOT NULL)
                     ELSE NULL END                                                            AS skill_adoption_rate,
                CASE WHEN COUNT(DISTINCT f.assignee_id) > 0
                     THEN SUM(f.story_points) / NULLIF(COUNT(DISTINCT f.assignee_id), 0)
                     ELSE NULL END                                                            AS points_per_active_resource,
                CASE WHEN SUM(f.story_points) FILTER (WHERE f.spent_hours > 0 AND f.story_points > 0) > 0
                     THEN SUM(f.spent_hours) FILTER (WHERE f.spent_hours > 0 AND f.story_points > 0)
                          / SUM(f.story_points) FILTER (WHERE f.spent_hours > 0 AND f.story_points > 0)
                     ELSE NULL END                                                            AS hours_per_point,
                COUNT(*)                                                                      AS story_count,
                COUNT(*) FILTER (WHERE f.quality_score IS NOT NULL)                           AS scored_count,
                COUNT(DISTINCT f.assignee_id)                                                 AS active_resources,
                COUNT(*) FILTER (WHERE f.spent_hours > 0 AND f.story_points > 0)              AS hour_logged_count,
                COUNT(*) FILTER (WHERE f.skill_usage_detected IS TRUE)                        AS skill_count,
                COUNT(DISTINCT f.assignee_id) FILTER (WHERE f.skill_usage_detected IS TRUE)   AS skill_adopters,
                COUNT(DISTINCT f.assignee_id) FILTER (WHERE f.assignee_id IS NOT NULL)        AS active_delivered_devs
            FROM v_issue_facts f
            {where}
            """
        )
        row = db.execute(sql, params).one()._mapping
        results.append(
            {
                "cadence_start": cadence["start_date"],
                "cadence_end": cadence["end_date"],
                "sprint_ids": list(cadence["sprint_ids"]),
                "story_points": float(row["story_points"] or 0),
                "skill_adoption_rate": (
                    float(row["skill_adoption_rate"])
                    if row["skill_adoption_rate"] is not None
                    else None
                ),
                "points_per_active_resource": (
                    float(row["points_per_active_resource"])
                    if row["points_per_active_resource"] is not None
                    else None
                ),
                "hours_per_point": (
                    float(row["hours_per_point"])
                    if row["hours_per_point"] is not None
                    else None
                ),
                "story_count": int(row["story_count"] or 0),
                "scored_count": int(row["scored_count"] or 0),
                "active_resources": int(row["active_resources"] or 0),
                "hour_logged_count": int(row["hour_logged_count"] or 0),
                "skill_count": int(row["skill_count"] or 0),
                "skill_adopters": int(row["skill_adopters"] or 0),
                "active_delivered_devs": int(row["active_delivered_devs"] or 0),
            }
        )
    return results


# ---------- issue-type trends by cadence (Quality tab) ----------


def issue_type_trends_by_cadence(
    db: Session,
    *,
    cadences: list[dict[str, Any]],
    team_ids: list[int] | None = None,
    project: str | None = None,
) -> list[dict[str, Any]]:
    """One row per cadence with completed Story/Bug/Task counts.

    Mirrors the row shape of issue_type_trends() (`stories`, `bugs`,
    `customer_bugs`, `qa_bugs`, `tasks`, `total`) but keyed by cadence
    boundaries instead of ISO weeks.
    """
    if not cadences:
        return []
    results: list[dict[str, Any]] = []
    for cadence in cadences:
        filters = AnalyticsFilters(
            is_done=True,
            sprint_ids=tuple(cadence["sprint_ids"]),
            has_sprint=True,
            project=project,
        )
        where, params = _where_clauses(filters)
        extra: list[str] = []
        _apply_team_filter(extra, params, None, team_ids)
        for clause in extra:
            term = clause.lstrip("AND ").strip()
            where = (where + " AND " + term) if where else ("WHERE " + term)
        type_clause = "lower(f.issue_type) IN ('story', 'bug', 'task')"
        where = (where + " AND " + type_clause) if where else ("WHERE " + type_clause)
        sql = text(
            f"""
            SELECT
                COUNT(*) FILTER (WHERE lower(f.issue_type) = 'story')                                       AS stories,
                COUNT(*) FILTER (WHERE lower(f.issue_type) = 'bug' AND f.reported_by_customer IS TRUE)      AS customer_bugs,
                COUNT(*) FILTER (WHERE lower(f.issue_type) = 'bug' AND COALESCE(f.reported_by_customer, FALSE) IS FALSE) AS qa_bugs,
                COUNT(*) FILTER (WHERE lower(f.issue_type) = 'bug')                                         AS bugs,
                COUNT(*) FILTER (WHERE lower(f.issue_type) = 'task')                                        AS tasks,
                COUNT(*)                                                                                    AS total
            FROM v_issue_facts f
            {where}
            """
        )
        row = db.execute(sql, params).one()._mapping
        results.append(
            {
                "cadence_start": cadence["start_date"],
                "cadence_end": cadence["end_date"],
                "sprint_ids": list(cadence["sprint_ids"]),
                "stories": int(row["stories"] or 0),
                "customer_bugs": int(row["customer_bugs"] or 0),
                "qa_bugs": int(row["qa_bugs"] or 0),
                "bugs": int(row["bugs"] or 0),
                "tasks": int(row["tasks"] or 0),
                "total": int(row["total"] or 0),
            }
        )
    return results


# ---------- bug weekly trends by created_at (Quality tab) ----------


def bug_weekly_trends_by_created(
    db: Session,
    *,
    team_ids: list[int] | None,
    weeks: int = 12,
) -> list[dict[str, Any]]:
    """Last `weeks` ISO-Monday week buckets of bugs by created_at.

    Counts Customer Bugs (`reported_by_customer IS TRUE`) and Internal Bugs
    (`COALESCE(reported_by_customer, FALSE) IS FALSE`) per week. Restricted to
    bugs with `team_id IS NOT NULL`; applies the org-wide `[QA]` summary
    exclusion for parity with other Quality-tab queries.
    """
    params: dict[str, Any] = {"weeks": int(weeks)}
    extra_clauses: list[str] = []
    _apply_team_filter(extra_clauses, params, None, team_ids)
    extra = "\n              ".join(extra_clauses)

    sql = text(
        f"""
        WITH weeks AS (
            SELECT generate_series(
                date_trunc('week', NOW())::date - ((:weeks - 1) || ' weeks')::interval,
                date_trunc('week', NOW())::date,
                INTERVAL '1 week'
            )::date AS week_start
        ),
        bugs_agg AS (
            SELECT
                date_trunc('week', f.created_at)::date AS week_start,
                COUNT(*) FILTER (WHERE f.reported_by_customer IS TRUE)                   AS customer_bugs,
                COUNT(*) FILTER (WHERE COALESCE(f.reported_by_customer, FALSE) IS FALSE) AS internal_bugs,
                COUNT(*)                                                                 AS total
            FROM v_issue_facts f
            WHERE lower(f.issue_type) = 'bug'
              AND f.team_id IS NOT NULL
              AND (f.summary IS NULL OR ltrim(f.summary) NOT ILIKE '[QA]%')
              {extra}
            GROUP BY 1
        )
        SELECT
            w.week_start,
            COALESCE(b.customer_bugs, 0) AS customer_bugs,
            COALESCE(b.internal_bugs, 0) AS internal_bugs,
            COALESCE(b.total, 0)         AS total
        FROM weeks w
        LEFT JOIN bugs_agg b ON b.week_start = w.week_start
        ORDER BY w.week_start ASC
        """
    )
    return [dict(r._mapping) for r in db.execute(sql, params).all()]


# ---------- issue-type trends (weekly completed counts by type) ----------


def issue_type_trends(
    db: Session,
    *,
    last: int = 12,
    project: str | None = None,
    team_id: int | None = None,
    team_ids: list[int] | None = None,
    sprint_id: int | None = None,
) -> list[dict[str, Any]]:
    # `last` is accepted for API compatibility but no longer affects the query:
    # bucketing is by sprint end_date (year 2026 by default, or one specific
    # sprint when sprint_id is set). Sprint linkage is implicit.
    extra_clauses = []
    params: dict[str, Any] = {}
    if sprint_id is not None:
        params["sprint_id"] = sprint_id
    else:
        params["year"] = 2026
    if project:
        extra_clauses.append("AND f.project = :project")
        params["project"] = project
    _apply_team_filter(extra_clauses, params, team_id, team_ids)
    extra = "\n              ".join(extra_clauses)
    universe_cte = _build_universe_cte(sprint_id)

    sql = text(
        f"""
        WITH {universe_cte},
        weeks AS (
            SELECT generate_series(
                COALESCE((SELECT MIN(week_start) FROM in_universe), date_trunc('week', NOW())::date),
                LEAST(
                    COALESCE((SELECT MAX(week_start) FROM in_universe), date_trunc('week', NOW())::date),
                    date_trunc('week', NOW())::date
                ),
                INTERVAL '1 week'
            )::date AS week_start
        ),
        done_issues AS (
            SELECT
                i2.week_start,
                lower(f.issue_type) AS issue_type,
                f.reported_by_customer
            FROM v_issue_facts f
            JOIN in_universe i2 ON i2.issue_id = f.issue_id
            WHERE f.is_done IS TRUE
              AND lower(f.issue_type) IN ('story', 'bug', 'task')
              AND (f.summary IS NULL OR ltrim(f.summary) NOT ILIKE '[QA]%')
              {extra}
        )
        SELECT
            w.week_start,
            COUNT(*) FILTER (WHERE d.issue_type = 'story') AS stories,
            COUNT(*) FILTER (WHERE d.issue_type = 'bug' AND d.reported_by_customer IS TRUE) AS customer_bugs,
            COUNT(*) FILTER (WHERE d.issue_type = 'bug' AND COALESCE(d.reported_by_customer, FALSE) IS FALSE) AS qa_bugs,
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
