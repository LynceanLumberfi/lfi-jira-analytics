from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel


KindFilter = Literal["all", "playwright", "surefire"]


class WindowOut(BaseModel):
    days: int
    date_from: date
    date_to: date


class ExecutionSummary(BaseModel):
    runs: int
    pass_rate: float | None
    pass_rate_prev: float | None
    failing_tests: int
    flaky_tests: int
    failing_streak: int
    stale_tests: int
    window: WindowOut


class HeatmapCell(BaseModel):
    date: date
    runs: int
    total: int
    passed: int
    failed: int
    errors: int
    skipped: int
    pass_rate: float | None
    build_failed: bool


class HeatmapRow(BaseModel):
    row_key: str
    row_label: str
    kind: str
    cells: list[HeatmapCell]


class HeatmapOut(BaseModel):
    window: WindowOut
    rows: list[HeatmapRow]


class TrendPoint(BaseModel):
    date: date
    pass_rate: float | None
    runs: int


class TrendSeries(BaseModel):
    key: str
    label: str
    kind: str
    points: list[TrendPoint]


class TrendsOut(BaseModel):
    window: WindowOut
    series: list[TrendSeries]


class TestOfInterest(BaseModel):
    test_uid: str
    kind: str
    test_name: str
    class_or_file: str | None
    package_or_suite: str | None
    last_status: str
    last_seen: date
    last_passed: date | None
    last_failed: date | None
    fail_streak_days: int
    pass_days: int
    fail_days: int
    pass_attempts: int
    fail_attempts: int
    total_attempts: int
    flakiness_pct: float | None
    error_message: str | None


class StaleTest(BaseModel):
    test_uid: str
    kind: str
    test_name: str
    class_or_file: str | None
    package_or_suite: str | None
    last_seen: date
    last_status_seen: str
    days_absent: int
