"""Process-local lock that prevents two scoring runs from executing in parallel.

Lives in its own module so the API endpoint and the background task share the
same instance. Lost on backend restart — that's acceptable; the next POST will
simply pick up whatever issues are still `scoring_status='pending'`.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Final

_lock: Final[threading.Lock] = threading.Lock()
_started_at: datetime | None = None
_triggered_by: str | None = None


def acquire(triggered_by: str | None) -> bool:
    """Try to claim the scoring lock. Returns True on success."""
    global _started_at, _triggered_by
    if not _lock.acquire(blocking=False):
        return False
    _started_at = datetime.now(timezone.utc)
    _triggered_by = triggered_by
    return True


def release() -> None:
    global _started_at, _triggered_by
    _started_at = None
    _triggered_by = None
    if _lock.locked():
        _lock.release()


def is_running() -> bool:
    return _lock.locked()


def started_at() -> datetime | None:
    return _started_at


def triggered_by() -> str | None:
    return _triggered_by
