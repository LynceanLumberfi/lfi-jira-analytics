"""Test execution analytics endpoints.

Backs the frontend Test Automation > Execution page. All endpoints share a
common CTE block (`_BASE_CTES`) that resolves the window and computes a
per-(test_uid, run_date) "latest result of the day" projection. The endpoints
plug into that projection to answer different questions:

- /summary           — 6 KPIs + previous-window comparison.
- /heatmap           — daily pass-rate cells per suite for the calendar view.
- /trends            — daily pass-rate line series.
- /tests/failing     — tests whose latest result of their latest run-day is failed/error.
- /tests/flaky       — tests with both pass and fail/error attempts in the window.
- /tests/failing-streak — tests with N+ consecutive fail run-days.
- /tests/stale       — tests last seen before the window but with no result in window.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.test_execution import (
    ExecutionSummary,
    HeatmapCell,
    HeatmapOut,
    HeatmapRow,
    KindFilter,
    StaleTest,
    TestOfInterest,
    TrendPoint,
    TrendSeries,
    TrendsOut,
    WindowOut,
)


router = APIRouter(prefix="/api/test-execution", tags=["test-execution"])


KIND_VALUES = ("all", "playwright", "surefire")


def _resolve_window(days: int) -> tuple[date, date]:
    """Return (date_from, date_to) inclusive, anchored to the latest run_date
    we have data for. Falls back to today when no data exists.

    Anchoring to MAX(run_date) keeps the dashboard meaningful when the data is
    stale (e.g. weekend with no nightly runs).
    """
    return None, None  # filled at call time with DB session


def _latest_run_date(db: Session) -> date | None:
    row = db.execute(text("SELECT MAX(run_date) AS d FROM test_run")).one()
    return row.d


def _window(db: Session, days: int) -> WindowOut:
    latest = _latest_run_date(db)
    date_to = latest or date.today()
    date_from = date_to - timedelta(days=days - 1)
    return WindowOut(days=days, date_from=date_from, date_to=date_to)


# ---------------------------------------------------------------------------
# Shared CTE block.
#
# Parameters expected by every endpoint that uses this block:
#   :date_from, :date_to   inclusive window bounds (date)
#   :kind                  'all' | 'playwright' | 'surefire'
#
# Provides:
#   window_runs   - test_run rows in window matching :kind
#   cases         - test_case_result joined to window_runs, with run_date/run_suite
#   labelled      - cases + computed test_uid, class_or_file, package_or_suite
#   per_day       - latest attempt per (uid, run_date), via DISTINCT ON started_at DESC
# ---------------------------------------------------------------------------

_BASE_CTES = """
window_runs AS (
    SELECT id, run_date, kind, bucket, suite, source_path, build_number,
           top_level_error, total, passed, failed, skipped, flaky, errors,
           success_rate, started_at
    FROM test_run
    WHERE run_date BETWEEN :date_from AND :date_to
      AND (:kind = 'all' OR kind = :kind)
),
cases AS (
    SELECT
        tcr.id,
        tcr.run_id,
        tcr.kind,
        tcr.test_name,
        tcr.test_file,
        tcr.class_fqn,
        tcr.package_name,
        tcr.suite_path,
        tcr.status,
        tcr.started_at,
        tcr.error_message,
        wr.run_date,
        wr.suite AS run_suite
    FROM test_case_result tcr
    JOIN window_runs wr ON wr.id = tcr.run_id
),
labelled AS (
    SELECT
        CASE
            WHEN kind = 'surefire' THEN 'surefire:' || COALESCE(class_fqn, '?') || ':' || test_name
            ELSE                          'playwright:' || COALESCE(test_file, '?') || ':' || test_name
        END AS uid,
        kind,
        test_name,
        COALESCE(class_fqn, test_file) AS class_or_file,
        COALESCE(package_name, run_suite, suite_path) AS package_or_suite,
        status,
        started_at,
        error_message,
        run_date
    FROM cases
),
per_day AS (
    SELECT DISTINCT ON (uid, run_date)
        uid, kind, test_name, class_or_file, package_or_suite,
        run_date, status, error_message
    FROM labelled
    ORDER BY uid, run_date, started_at DESC NULLS LAST, status DESC
)
"""


def _validate_kind(kind: str) -> str:
    if kind not in KIND_VALUES:
        return "all"
    return kind


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=ExecutionSummary)
def get_summary(
    days: int = Query(10, ge=1, le=120),
    kind: KindFilter = Query("all"),
    history_days: int = Query(30, ge=1, le=365),
    streak_days: int = Query(7, ge=2, le=60),
    db: Session = Depends(get_db),
):
    window = _window(db, days)
    prev_to = window.date_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)
    history_from = window.date_from - timedelta(days=history_days)

    sql = text(f"""
        WITH {_BASE_CTES},
        per_test AS (
            SELECT
                uid,
                MAX(run_date) AS last_seen,
                COUNT(*) FILTER (WHERE status = 'passed')                AS pass_days,
                COUNT(*) FILTER (WHERE status IN ('failed','error'))    AS fail_days
            FROM per_day
            GROUP BY uid
        ),
        latest_day AS (
            SELECT DISTINCT ON (uid) uid, run_date, status
            FROM per_day
            ORDER BY uid, run_date DESC
        ),
        streak_calc AS (
            SELECT
                uid, run_date, status,
                ROW_NUMBER()       OVER (PARTITION BY uid ORDER BY run_date DESC) AS rn,
                SUM(CASE WHEN status IN ('failed','error') THEN 0 ELSE 1 END)
                    OVER (PARTITION BY uid ORDER BY run_date DESC
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS non_fail_running
            FROM per_day
        ),
        streak_per_test AS (
            SELECT uid, COUNT(*) AS streak_len
            FROM streak_calc
            WHERE non_fail_running = 0
            GROUP BY uid
        ),
        history_uids AS (
            SELECT DISTINCT
                CASE
                    WHEN tcr.kind = 'surefire' THEN 'surefire:' || COALESCE(tcr.class_fqn, '?') || ':' || tcr.test_name
                    ELSE                            'playwright:' || COALESCE(tcr.test_file, '?') || ':' || tcr.test_name
                END AS uid
            FROM test_case_result tcr
            JOIN test_run tr ON tr.id = tcr.run_id
            WHERE tr.run_date BETWEEN :history_from AND :hist_to_exclusive
              AND (:kind = 'all' OR tr.kind = :kind)
        ),
        window_uids AS (SELECT DISTINCT uid FROM labelled),
        agg AS (
            SELECT
                (SELECT COUNT(*) FROM window_runs)                                    AS runs,
                (SELECT COALESCE(SUM(passed), 0) FROM window_runs)::bigint            AS sum_passed,
                (SELECT COALESCE(SUM(total),  0) FROM window_runs)::bigint            AS sum_total,
                (SELECT COUNT(*) FROM latest_day WHERE status IN ('failed','error'))  AS failing_tests,
                (SELECT COUNT(*) FROM per_test
                  WHERE pass_days > 0 AND fail_days > 0)                              AS flaky_tests,
                (SELECT COUNT(*) FROM streak_per_test WHERE streak_len >= :streak_days) AS failing_streak,
                (SELECT COUNT(*) FROM history_uids h
                  WHERE NOT EXISTS (SELECT 1 FROM window_uids w WHERE w.uid = h.uid)) AS stale_tests
        ),
        prev_agg AS (
            SELECT
                COALESCE(SUM(passed), 0)::bigint AS sum_passed,
                COALESCE(SUM(total),  0)::bigint AS sum_total
            FROM test_run
            WHERE run_date BETWEEN :prev_from AND :prev_to
              AND (:kind = 'all' OR kind = :kind)
        )
        SELECT a.*, p.sum_passed AS prev_passed, p.sum_total AS prev_total
        FROM agg a CROSS JOIN prev_agg p
    """)

    params = {
        "date_from": window.date_from,
        "date_to": window.date_to,
        "kind": kind,
        "history_from": history_from,
        "hist_to_exclusive": window.date_from - timedelta(days=1),
        "streak_days": streak_days,
        "prev_from": prev_from,
        "prev_to": prev_to,
    }
    r = db.execute(sql, params).one()

    pass_rate = round(r.sum_passed / r.sum_total * 100, 2) if r.sum_total else None
    pass_rate_prev = round(r.prev_passed / r.prev_total * 100, 2) if r.prev_total else None

    return ExecutionSummary(
        runs=r.runs,
        pass_rate=pass_rate,
        pass_rate_prev=pass_rate_prev,
        failing_tests=r.failing_tests,
        flaky_tests=r.flaky_tests,
        failing_streak=r.failing_streak,
        stale_tests=r.stale_tests,
        window=window,
    )


@router.get("/heatmap", response_model=HeatmapOut)
def get_heatmap(
    days: int = Query(10, ge=1, le=60),
    kind: KindFilter = Query("all"),
    db: Session = Depends(get_db),
):
    window = _window(db, days)
    sql = text("""
        SELECT
            kind,
            CASE WHEN kind = 'playwright' THEN COALESCE(suite, '?') ELSE 'surefire' END AS row_key_part,
            run_date,
            COUNT(*)                                                           AS runs,
            COALESCE(SUM(total),   0)::bigint                                  AS total,
            COALESCE(SUM(passed),  0)::bigint                                  AS passed,
            COALESCE(SUM(failed),  0)::bigint                                  AS failed,
            COALESCE(SUM(errors),  0)::bigint                                  AS errors,
            COALESCE(SUM(skipped), 0)::bigint                                  AS skipped,
            BOOL_OR(top_level_error IS NOT NULL AND total = 0)                 AS build_failed
        FROM test_run
        WHERE run_date BETWEEN :date_from AND :date_to
          AND (:kind = 'all' OR kind = :kind)
        GROUP BY kind, row_key_part, run_date
        ORDER BY kind, row_key_part, run_date
    """)
    rows = db.execute(sql, {
        "date_from": window.date_from, "date_to": window.date_to, "kind": kind,
    }).all()

    grouped: dict[tuple[str, str], HeatmapRow] = {}
    for r in rows:
        key = (r.kind, r.row_key_part)
        if key not in grouped:
            row_label = (
                "surefire / lumberfi-services"
                if r.kind == "surefire"
                else f"playwright / {r.row_key_part}"
            )
            grouped[key] = HeatmapRow(
                row_key=f"{r.kind}:{r.row_key_part}",
                row_label=row_label,
                kind=r.kind,
                cells=[],
            )
        denom = r.passed + r.failed + r.errors
        pass_rate = round(r.passed / denom * 100, 2) if denom else None
        grouped[key].cells.append(
            HeatmapCell(
                date=r.run_date,
                runs=r.runs,
                total=r.total,
                passed=r.passed,
                failed=r.failed,
                errors=r.errors,
                skipped=r.skipped,
                pass_rate=pass_rate,
                build_failed=r.build_failed,
            )
        )

    # Stable order: surefire row(s) first, then playwright alphabetically.
    out_rows = sorted(
        grouped.values(),
        key=lambda r: (r.kind != "surefire", r.row_key),
    )
    return HeatmapOut(window=window, rows=out_rows)


@router.get("/trends", response_model=TrendsOut)
def get_trends(
    days: int = Query(30, ge=1, le=180),
    kind: KindFilter = Query("all"),
    db: Session = Depends(get_db),
):
    window = _window(db, days)

    if kind == "playwright":
        group_expr = "COALESCE(suite, '?')"
        key_prefix = "playwright:"
    elif kind == "surefire":
        group_expr = "'surefire'"
        key_prefix = "surefire:"
    else:
        group_expr = "kind"
        key_prefix = ""

    sql = text(f"""
        SELECT
            {group_expr}                AS series_key,
            kind,
            run_date,
            COUNT(*)                    AS runs,
            COALESCE(SUM(passed), 0)::bigint AS sum_passed,
            COALESCE(SUM(failed),  0)::bigint AS sum_failed,
            COALESCE(SUM(errors),  0)::bigint AS sum_errors
        FROM test_run
        WHERE run_date BETWEEN :date_from AND :date_to
          AND (:kind = 'all' OR kind = :kind)
        GROUP BY series_key, kind, run_date
        ORDER BY series_key, run_date
    """)
    rows = db.execute(sql, {
        "date_from": window.date_from, "date_to": window.date_to, "kind": kind,
    }).all()

    series_map: dict[str, TrendSeries] = {}
    for r in rows:
        key = f"{key_prefix}{r.series_key}" if key_prefix else r.series_key
        if key not in series_map:
            series_map[key] = TrendSeries(
                key=key,
                label=str(r.series_key),
                kind=r.kind,
                points=[],
            )
        denom = r.sum_passed + r.sum_failed + r.sum_errors
        pass_rate = round(r.sum_passed / denom * 100, 2) if denom else None
        series_map[key].points.append(
            TrendPoint(date=r.run_date, pass_rate=pass_rate, runs=r.runs)
        )

    return TrendsOut(
        window=window,
        series=sorted(series_map.values(), key=lambda s: (s.kind != "surefire", s.label)),
    )


# ---- tests-of-interest queries ---------------------------------------------

_PER_TEST_SQL_BODY = f"""
    {_BASE_CTES},
    per_test AS (
        SELECT
            uid,
            MAX(kind)                                                AS kind,
            MAX(test_name)                                           AS test_name,
            MAX(class_or_file)                                       AS class_or_file,
            MAX(package_or_suite)                                    AS package_or_suite,
            MIN(run_date)                                            AS first_seen,
            MAX(run_date)                                            AS last_seen,
            MAX(run_date) FILTER (WHERE status = 'passed')           AS last_passed,
            MAX(run_date) FILTER (WHERE status IN ('failed','error')) AS last_failed,
            COUNT(*) FILTER (WHERE status = 'passed')                AS pass_days,
            COUNT(*) FILTER (WHERE status IN ('failed','error'))    AS fail_days
        FROM per_day
        GROUP BY uid
    ),
    attempts AS (
        SELECT
            uid,
            COUNT(*)                                              AS total_attempts,
            COUNT(*) FILTER (WHERE status = 'passed')             AS pass_attempts,
            COUNT(*) FILTER (WHERE status IN ('failed','error'))  AS fail_attempts
        FROM labelled
        GROUP BY uid
    ),
    latest_day AS (
        SELECT DISTINCT ON (uid) uid, run_date, status, error_message
        FROM per_day
        ORDER BY uid, run_date DESC
    ),
    streak_calc AS (
        SELECT
            uid, run_date, status,
            ROW_NUMBER() OVER (PARTITION BY uid ORDER BY run_date DESC) AS rn,
            SUM(CASE WHEN status IN ('failed','error') THEN 0 ELSE 1 END)
                OVER (PARTITION BY uid ORDER BY run_date DESC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS non_fail_running
        FROM per_day
    ),
    streak_per_test AS (
        SELECT uid, COUNT(*) AS streak_len
        FROM streak_calc
        WHERE non_fail_running = 0
        GROUP BY uid
    ),
    joined AS (
        SELECT
            pt.uid,
            pt.kind,
            pt.test_name,
            pt.class_or_file,
            pt.package_or_suite,
            pt.first_seen,
            pt.last_seen,
            pt.last_passed,
            pt.last_failed,
            pt.pass_days,
            pt.fail_days,
            a.pass_attempts,
            a.fail_attempts,
            a.total_attempts,
            ld.status     AS last_status,
            ld.error_message,
            COALESCE(s.streak_len, 0) AS fail_streak_days
        FROM per_test pt
        LEFT JOIN attempts a            ON a.uid = pt.uid
        LEFT JOIN latest_day ld         ON ld.uid = pt.uid
        LEFT JOIN streak_per_test s     ON s.uid = pt.uid
    )
"""


def _row_to_toi(r) -> TestOfInterest:
    denom = r.pass_attempts + r.fail_attempts
    flakiness = round(r.fail_attempts / denom * 100, 2) if denom else None
    return TestOfInterest(
        test_uid=r.uid,
        kind=r.kind,
        test_name=r.test_name,
        class_or_file=r.class_or_file,
        package_or_suite=r.package_or_suite,
        last_status=r.last_status,
        last_seen=r.last_seen,
        last_passed=r.last_passed,
        last_failed=r.last_failed,
        fail_streak_days=r.fail_streak_days,
        pass_days=r.pass_days,
        fail_days=r.fail_days,
        pass_attempts=r.pass_attempts,
        fail_attempts=r.fail_attempts,
        total_attempts=r.total_attempts,
        flakiness_pct=flakiness,
        error_message=r.error_message,
    )


@router.get("/tests/failing", response_model=list[TestOfInterest])
def get_failing(
    days: int = Query(10, ge=1, le=60),
    kind: KindFilter = Query("all"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    window = _window(db, days)
    sql = text(f"""
        WITH {_PER_TEST_SQL_BODY}
        SELECT * FROM joined
        WHERE last_status IN ('failed','error')
        ORDER BY fail_streak_days DESC, last_seen DESC, fail_attempts DESC
        LIMIT :limit
    """)
    rows = db.execute(sql, {
        "date_from": window.date_from, "date_to": window.date_to,
        "kind": kind, "limit": limit,
    }).all()
    return [_row_to_toi(r) for r in rows]


@router.get("/tests/flaky", response_model=list[TestOfInterest])
def get_flaky(
    days: int = Query(10, ge=1, le=60),
    kind: KindFilter = Query("all"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    window = _window(db, days)
    sql = text(f"""
        WITH {_PER_TEST_SQL_BODY}
        SELECT * FROM joined
        WHERE pass_attempts > 0 AND fail_attempts > 0
        ORDER BY (fail_attempts::float / NULLIF(pass_attempts + fail_attempts, 0)) DESC,
                 total_attempts DESC, last_seen DESC
        LIMIT :limit
    """)
    rows = db.execute(sql, {
        "date_from": window.date_from, "date_to": window.date_to,
        "kind": kind, "limit": limit,
    }).all()
    return [_row_to_toi(r) for r in rows]


@router.get("/tests/failing-streak", response_model=list[TestOfInterest])
def get_failing_streak(
    days: int = Query(30, ge=2, le=120),
    streak_days: int = Query(7, ge=2, le=60),
    kind: KindFilter = Query("all"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Tests with a consecutive-fail streak of `streak_days` or more.

    `days` controls how far back we look when computing the streak. Default
    is 30 days so a "failing for 2 weeks" test is still counted even when
    the page is filtered to the 10-day window.
    """
    window = _window(db, days)
    sql = text(f"""
        WITH {_PER_TEST_SQL_BODY}
        SELECT * FROM joined
        WHERE fail_streak_days >= :streak_days
        ORDER BY fail_streak_days DESC, last_seen DESC
        LIMIT :limit
    """)
    rows = db.execute(sql, {
        "date_from": window.date_from, "date_to": window.date_to,
        "kind": kind, "streak_days": streak_days, "limit": limit,
    }).all()
    return [_row_to_toi(r) for r in rows]


@router.get("/tests/stale", response_model=list[StaleTest])
def get_stale(
    days: int = Query(10, ge=1, le=60),
    history_days: int = Query(30, ge=1, le=365),
    kind: KindFilter = Query("all"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Tests that appeared in the last `history_days` (anchored before the
    window) but have zero attempts in the current window.

    Returns the most recent historical sighting for each missing test.
    """
    window = _window(db, days)
    history_from = window.date_from - timedelta(days=history_days)
    history_to_exclusive = window.date_from - timedelta(days=1)

    sql = text("""
        WITH labelled_all AS (
            SELECT
                CASE
                    WHEN tcr.kind = 'surefire' THEN 'surefire:' || COALESCE(tcr.class_fqn, '?') || ':' || tcr.test_name
                    ELSE                          'playwright:' || COALESCE(tcr.test_file, '?') || ':' || tcr.test_name
                END AS uid,
                tcr.kind, tcr.test_name,
                COALESCE(tcr.class_fqn, tcr.test_file) AS class_or_file,
                COALESCE(tcr.package_name, tr.suite, tcr.suite_path) AS package_or_suite,
                tcr.status, tcr.started_at, tr.run_date
            FROM test_case_result tcr
            JOIN test_run tr ON tr.id = tcr.run_id
            WHERE tr.run_date BETWEEN :history_from AND :history_to_exclusive
              AND (:kind = 'all' OR tr.kind = :kind)
        ),
        history_latest AS (
            SELECT DISTINCT ON (uid)
                uid, kind, test_name, class_or_file, package_or_suite,
                run_date, status
            FROM labelled_all
            ORDER BY uid, run_date DESC, started_at DESC NULLS LAST
        ),
        window_uids AS (
            SELECT DISTINCT
                CASE
                    WHEN tcr.kind = 'surefire' THEN 'surefire:' || COALESCE(tcr.class_fqn, '?') || ':' || tcr.test_name
                    ELSE                          'playwright:' || COALESCE(tcr.test_file, '?') || ':' || tcr.test_name
                END AS uid
            FROM test_case_result tcr
            JOIN test_run tr ON tr.id = tcr.run_id
            WHERE tr.run_date BETWEEN :date_from AND :date_to
              AND (:kind = 'all' OR tr.kind = :kind)
        )
        SELECT h.uid, h.kind, h.test_name, h.class_or_file, h.package_or_suite,
               h.run_date AS last_seen, h.status AS last_status_seen,
               (:date_to - h.run_date) AS days_absent
        FROM history_latest h
        WHERE NOT EXISTS (SELECT 1 FROM window_uids w WHERE w.uid = h.uid)
        ORDER BY h.run_date DESC
        LIMIT :limit
    """)
    rows = db.execute(sql, {
        "date_from": window.date_from, "date_to": window.date_to,
        "history_from": history_from,
        "history_to_exclusive": history_to_exclusive,
        "kind": kind, "limit": limit,
    }).all()
    return [
        StaleTest(
            test_uid=r.uid,
            kind=r.kind,
            test_name=r.test_name,
            class_or_file=r.class_or_file,
            package_or_suite=r.package_or_suite,
            last_seen=r.last_seen,
            last_status_seen=r.last_status_seen,
            days_absent=r.days_absent,
        )
        for r in rows
    ]
