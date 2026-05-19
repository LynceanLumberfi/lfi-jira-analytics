"""One-off: snap sprint start_date to nearest Monday, end_date to start + 6 days.

Scope: sprints whose name starts with FS, IN, BFX, or HR.
Leaves complete_date untouched.
"""
import sys
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

load_dotenv(_BACKEND_DIR.parent / ".env")

from sqlalchemy import or_  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models.sprint import Sprint  # noqa: E402

PREFIXES = ("FS", "IN", "BFX", "HR")


def nearest_monday(d):
    wd = d.weekday()  # Mon=0..Sun=6
    delta = -wd if wd <= 3 else (7 - wd)
    return d + timedelta(days=delta)


def main():
    db = SessionLocal()
    try:
        sprints = (
            db.query(Sprint)
            .filter(Sprint.start_date.isnot(None))
            .filter(or_(*[Sprint.name.like(f"{p}%") for p in PREFIXES]))
            .all()
        )

        updated = 0
        for s in sprints:
            new_start_date = nearest_monday(s.start_date.date())
            new_start = s.start_date.replace(
                year=new_start_date.year,
                month=new_start_date.month,
                day=new_start_date.day,
            )
            new_end_date = new_start_date + timedelta(days=6)
            end_template = s.end_date if s.end_date is not None else s.start_date
            new_end = end_template.replace(
                year=new_end_date.year,
                month=new_end_date.month,
                day=new_end_date.day,
            )
            if s.start_date != new_start or s.end_date != new_end:
                s.start_date = new_start
                s.end_date = new_end
                updated += 1

        db.commit()
        print(f"Updated {updated} of {len(sprints)} sprints")
    finally:
        db.close()


if __name__ == "__main__":
    main()
