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
