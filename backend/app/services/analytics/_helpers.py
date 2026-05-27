from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def current_iso_week_monday() -> date:
    today = date.today()
    return today - timedelta(days=today.weekday())


def latest_completed_week_start(
    trends: list[dict[str, Any]], *, allow_in_progress: bool = False
) -> date | None:
    """Pick the most recent week_start in `trends`.

    Default mode skips any week_start ≥ current ISO Monday (avoids surfacing the
    in-progress week as "last completed"). When `allow_in_progress=True` (used
    when a specific sprint is selected), return the latest week regardless —
    the caller has explicitly opted into that sprint's week even if it's still
    active.
    """
    if not trends:
        return None
    if allow_in_progress:
        for row in reversed(trends):
            ws = row.get("week_start")
            if ws is not None:
                return ws
        return None
    cutoff = current_iso_week_monday()
    for row in reversed(trends):
        ws = row.get("week_start")
        if ws is not None and ws < cutoff:
            return ws
    return None


def week_bounds(week_start: date) -> tuple[datetime, datetime]:
    """Inclusive Monday midnight, exclusive next Monday midnight."""
    start_dt = datetime.combine(week_start, time.min)
    end_dt = datetime.combine(week_start + timedelta(days=7), time.min)
    return start_dt, end_dt


EXCLUDED_TEAM_NAMES: frozenset[str] = frozenset({"Integration"})


def excluded_team_ids(db: Session) -> set[int]:
    """Team IDs that the analytics tab endpoints must never include."""
    if not EXCLUDED_TEAM_NAMES:
        return set()
    rows = db.execute(
        text("SELECT id FROM teams WHERE name = ANY(:names)"),
        {"names": list(EXCLUDED_TEAM_NAMES)},
    ).all()
    return {int(r[0]) for r in rows}


def previous_sprint_id(
    db: Session,
    sprint_id: int,
    team_ids: list[int] | None = None,
) -> int | None:
    """The closed sprint that ended immediately before `sprint_id`.

    Restricted to `state = 'closed'` because Jira keeps `future` sprints around
    with placeholder end_dates — without the filter we'd point at an upcoming
    sprint that just happens to share a date. When `team_ids` is provided,
    further restrict to sprints that contain ≥1 issue from one of those teams.
    Returns None if no earlier closed sprint exists.
    """
    if team_ids:
        sql = text(
            """
            SELECT s.id
            FROM sprints s
            WHERE s.state = 'closed'
              AND s.end_date IS NOT NULL
              AND s.end_date < (SELECT end_date FROM sprints WHERE id = :sprint_id)
              AND EXISTS (
                  SELECT 1
                  FROM issue_sprints iss
                  JOIN issues i ON i.id = iss.issue_id
                  WHERE iss.sprint_id = s.id
                    AND i.team_id = ANY(:team_ids)
              )
            ORDER BY s.end_date DESC
            LIMIT 1
            """
        )
        row = db.execute(sql, {"sprint_id": sprint_id, "team_ids": team_ids}).first()
    else:
        sql = text(
            """
            SELECT id
            FROM sprints
            WHERE state = 'closed'
              AND end_date IS NOT NULL
              AND end_date < (SELECT end_date FROM sprints WHERE id = :sprint_id)
            ORDER BY end_date DESC
            LIMIT 1
            """
        )
        row = db.execute(sql, {"sprint_id": sprint_id}).first()
    return int(row[0]) if row else None


def sprint_ids_ending_in_week(db: Session, week_start: date) -> list[int]:
    """Sprint IDs whose end_date falls inside the Mon–Sun span of week_start."""
    sql = text(
        """
        SELECT id
        FROM sprints
        WHERE end_date >= :start_dt
          AND end_date <  :end_dt
        ORDER BY id
        """
    )
    start_dt, end_dt = week_bounds(week_start)
    rows = db.execute(sql, {"start_dt": start_dt, "end_dt": end_dt}).all()
    return [int(r[0]) for r in rows]


# ---- Sprint cadence helpers (Resource tab) --------------------------------
#
# The three featured teams (FS/BFX/HR) run on a synchronized cadence — for a
# given period each team has one closed sprint that shares the same start_date
# and end_date. Sprint names are hyphen-prefixed (e.g. "FS-503"); we identify
# the cadence by grouping closed sprints on end_date and requiring all three
# prefixes to be present.

TEAM_SPRINT_PREFIXES: tuple[str, ...] = ("FS", "BFX", "HR")

# Featured-team name → sprint-name prefix. Source of truth for the team→sprint
# relationship on drill-down pages (see previous_sprint_id_by_prefix). Kept as a
# constant rather than a teams.sprint_prefix column to avoid re-squashing the
# initial migration for a 3-row mapping.
TEAM_NAME_TO_SPRINT_PREFIX: dict[str, str] = {
    "Field Productivity": "FS",
    "Builderfax": "BFX",
    "HR & People Ops": "HR",
}


def _team_sprint_prefix(db: Session, team_id: int) -> str | None:
    name = db.execute(
        text("SELECT name FROM teams WHERE id = :id"), {"id": team_id}
    ).scalar()
    if name is None:
        return None
    return TEAM_NAME_TO_SPRINT_PREFIX.get(name)


def _cadence_row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "start_date": row.start_date,
        "end_date": row.end_date,
        "sprint_ids": [int(x) for x in row.sprint_ids],
    }


def latest_closed_cadence(db: Session) -> dict[str, Any] | None:
    """Latest end_date where all 3 prefix-teams have a closed sprint that day."""
    sql = text(
        """
        SELECT end_date::date                   AS end_date,
               MIN(start_date)::date            AS start_date,
               array_agg(id ORDER BY id)        AS sprint_ids
        FROM sprints
        WHERE state = 'closed'
          AND end_date IS NOT NULL
          AND split_part(name, '-', 1) = ANY(:prefixes)
        GROUP BY end_date::date
        HAVING COUNT(DISTINCT split_part(name, '-', 1)) = :prefix_count
        ORDER BY end_date::date DESC
        LIMIT 1
        """
    )
    row = db.execute(
        sql,
        {
            "prefixes": list(TEAM_SPRINT_PREFIXES),
            "prefix_count": len(TEAM_SPRINT_PREFIXES),
        },
    ).first()
    return _cadence_row_to_dict(row) if row else None


def previous_cadence(db: Session, end_date: date) -> dict[str, Any] | None:
    """Cadence immediately preceding the one ending on `end_date`."""
    sql = text(
        """
        SELECT end_date::date                   AS end_date,
               MIN(start_date)::date            AS start_date,
               array_agg(id ORDER BY id)        AS sprint_ids
        FROM sprints
        WHERE state = 'closed'
          AND end_date IS NOT NULL
          AND end_date::date < :end_date
          AND split_part(name, '-', 1) = ANY(:prefixes)
        GROUP BY end_date::date
        HAVING COUNT(DISTINCT split_part(name, '-', 1)) = :prefix_count
        ORDER BY end_date::date DESC
        LIMIT 1
        """
    )
    row = db.execute(
        sql,
        {
            "end_date": end_date,
            "prefixes": list(TEAM_SPRINT_PREFIXES),
            "prefix_count": len(TEAM_SPRINT_PREFIXES),
        },
    ).first()
    return _cadence_row_to_dict(row) if row else None


def recent_cadences(db: Session, limit: int = 12) -> list[dict[str, Any]]:
    """Last N synchronized cadences, oldest first (chart x-axis order)."""
    sql = text(
        """
        SELECT end_date::date                   AS end_date,
               MIN(start_date)::date            AS start_date,
               array_agg(id ORDER BY id)        AS sprint_ids
        FROM sprints
        WHERE state = 'closed'
          AND end_date IS NOT NULL
          AND split_part(name, '-', 1) = ANY(:prefixes)
        GROUP BY end_date::date
        HAVING COUNT(DISTINCT split_part(name, '-', 1)) = :prefix_count
        ORDER BY end_date::date DESC
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql,
        {
            "prefixes": list(TEAM_SPRINT_PREFIXES),
            "prefix_count": len(TEAM_SPRINT_PREFIXES),
            "limit": limit,
        },
    ).all()
    return [_cadence_row_to_dict(r) for r in reversed(rows)]


# Team-drilldown variants — operate on a single team's sprint chain, modeling
# each sprint as a one-element cadence so the rest of the pipeline is uniform.


def latest_closed_sprint_cadence_for_team(
    db: Session, team_id: int
) -> dict[str, Any] | None:
    prefix = _team_sprint_prefix(db, team_id)
    if prefix is None:
        return None
    sql = text(
        """
        SELECT s.id,
               s.start_date::date AS start_date,
               s.end_date::date   AS end_date
        FROM sprints s
        WHERE s.state = 'closed'
          AND s.end_date IS NOT NULL
          AND split_part(s.name, '-', 1) = :prefix
        ORDER BY s.end_date DESC
        LIMIT 1
        """
    )
    row = db.execute(sql, {"prefix": prefix}).first()
    if row is None:
        return None
    return {
        "start_date": row.start_date,
        "end_date": row.end_date,
        "sprint_ids": [int(row.id)],
    }


def recent_sprint_cadences_for_team(
    db: Session, team_id: int, limit: int = 12
) -> list[dict[str, Any]]:
    prefix = _team_sprint_prefix(db, team_id)
    if prefix is None:
        return []
    sql = text(
        """
        SELECT s.id,
               s.start_date::date AS start_date,
               s.end_date::date   AS end_date
        FROM sprints s
        WHERE s.state = 'closed'
          AND s.end_date IS NOT NULL
          AND split_part(s.name, '-', 1) = :prefix
        ORDER BY s.end_date DESC
        LIMIT :limit
        """
    )
    rows = db.execute(sql, {"prefix": prefix, "limit": limit}).all()
    return [
        {
            "start_date": r.start_date,
            "end_date": r.end_date,
            "sprint_ids": [int(r.id)],
        }
        for r in reversed(rows)
    ]


def previous_sprint_id_by_prefix(db: Session, sprint_id: int) -> int | None:
    """The closed sprint sharing this sprint's name prefix that ended just before it.

    Identifies a team's sprint chain by name prefix (e.g. "FS", "BFX", "HR")
    rather than by team_id membership of issues. This matters because cross-team
    work occasionally places one team's issue inside another team's sprint —
    `previous_sprint_id` would then jump chains. Sprint names are hyphen-prefixed
    (FS-503, BFX-503, HR-503), so split_part on '-' isolates the team identity.
    """
    sql = text(
        """
        WITH cur AS (
            SELECT split_part(name, '-', 1) AS prefix, end_date
            FROM sprints
            WHERE id = :sprint_id
        )
        SELECT s.id
        FROM sprints s, cur
        WHERE s.state = 'closed'
          AND s.end_date IS NOT NULL
          AND s.id <> :sprint_id
          AND split_part(s.name, '-', 1) = cur.prefix
          AND s.end_date < cur.end_date
        ORDER BY s.end_date DESC
        LIMIT 1
        """
    )
    row = db.execute(sql, {"sprint_id": sprint_id}).first()
    return int(row[0]) if row else None


def cadence_for_sprint(db: Session, sprint_id: int) -> dict[str, Any] | None:
    """One-element cadence shape for an explicit sprint_id (dropdown selection)."""
    sql = text(
        """
        SELECT start_date::date AS start_date,
               end_date::date   AS end_date
        FROM sprints
        WHERE id = :sprint_id
        """
    )
    row = db.execute(sql, {"sprint_id": sprint_id}).first()
    if row is None:
        return None
    return {
        "start_date": row.start_date,
        "end_date": row.end_date,
        "sprint_ids": [int(sprint_id)],
    }
