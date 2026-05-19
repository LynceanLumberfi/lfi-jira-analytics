import io
from datetime import date
from typing import Any, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.test_coverage import TestCoverage

router = APIRouter(prefix="/api/test-coverage", tags=["test-coverage"])


# ---- schemas ----

class UploadResult(BaseModel):
    inserted: int
    updated: int
    total: int


class SummaryResponse(BaseModel):
    total_covered: int
    total_cases: int
    pct: float
    modules_done: int
    modules_zero: int
    product_count: int
    prev_covered: Optional[int] = None
    prev_cases: Optional[int] = None
    prev_pct: Optional[float] = None


class ProductRow(BaseModel):
    feature: str
    covered: int
    total: int
    pct: float
    module_count: int
    prev_covered: Optional[int] = None
    prev_total: Optional[int] = None
    prev_pct: Optional[float] = None


class ModuleRow(BaseModel):
    feature: str
    module: str
    covered: int
    total: int
    pct: float
    as_of_date: Optional[date]
    prev_covered: Optional[int] = None
    prev_total: Optional[int] = None
    prev_pct: Optional[float] = None
    prev_as_of_date: Optional[date] = None


class TrendRow(BaseModel):
    week_start: date
    covered: int
    total: int
    pct: float


# ---- endpoints ----

@router.post("/upload", response_model=UploadResult)
async def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload must be a .csv file")

    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {e}")

    df.columns = [c.strip() for c in df.columns]
    # Drop rows where Feature is blank (separator rows)
    df = df[df["Feature"].notna() & (df["Feature"].str.strip() != "")].copy()

    if df.empty:
        raise HTTPException(status_code=400, detail="No valid rows found in CSV")

    # Date formats we accept. Order matters: try day-first (D/M/YY — the team's
    # current convention) before US month-first to avoid misparsing 5/4/26 as Apr 5.
    DATE_FORMATS = ("%d/%m/%y", "%d/%m/%Y", "%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d")

    def _parse_date(raw: str):
        for fmt in DATE_FORMATS:
            ts = pd.to_datetime(raw, format=fmt, errors="coerce")
            if not pd.isnull(ts):
                return ts.date()
        return None

    rows = []
    skipped_no_date = 0
    for _, row in df.iterrows():
        try:
            raw_date = str(row.get("Date", "")).strip()
            if not raw_date or raw_date.lower() in ("nat", "nan"):
                skipped_no_date += 1
                continue
            as_of = _parse_date(raw_date)
            if as_of is None:
                skipped_no_date += 1
                continue
            rows.append({
                "feature": str(row["Feature"]).strip(),
                "module": str(row["Module"]).strip(),
                "covered": int(row["Covered"]),
                "total": int(row["Total"]),
                "as_of_date": as_of,
            })
        except (ValueError, KeyError):
            continue

    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No parseable rows in CSV (each row requires a Date)",
        )

    # Dedupe within the upload by (feature, module, as_of_date) — last row wins.
    # Postgres rejects multiple rows in the same statement that target the same
    # ON CONFLICT key.
    deduped: dict[tuple[str, str, date], dict[str, Any]] = {}
    for r in rows:
        deduped[(r["feature"], r["module"], r["as_of_date"])] = r
    rows = list(deduped.values())

    # Count which (feature, module, as_of_date) triples already exist so we
    # can report inserted vs updated. Postgres ON CONFLICT rowcount alone
    # doesn't distinguish.
    existing_count = 0
    if rows:
        keys_clause = ", ".join(
            f"(:f{i}, :m{i}, :d{i})" for i in range(len(rows))
        )
        params = {}
        for i, r in enumerate(rows):
            params[f"f{i}"] = r["feature"]
            params[f"m{i}"] = r["module"]
            params[f"d{i}"] = r["as_of_date"]
        existing_count = db.execute(
            text(
                "SELECT COUNT(*) FROM test_coverage "
                "WHERE (feature, module, as_of_date) IN "
                f"(VALUES {keys_clause})"
            ),
            params,
        ).scalar_one() or 0

    stmt = insert(TestCoverage).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_test_coverage_feature_module_date",
        set_={
            "covered": stmt.excluded.covered,
            "total": stmt.excluded.total,
        },
    )
    db.execute(stmt)
    db.commit()

    total = len(rows)
    updated = min(existing_count, total)
    inserted = total - updated

    return UploadResult(inserted=inserted, updated=updated, total=total)


# Reusable CTEs: latest + previous test_coverage row per (feature, module).
# `latest_fm` = most recent, `prev_fm` = second-most-recent (NULL when no prior).
_LATEST_PREV_CTES = """
    ranked AS (
        SELECT
            id, feature, module, covered, total, as_of_date,
            ROW_NUMBER() OVER (
                PARTITION BY feature, module
                ORDER BY as_of_date DESC, id DESC
            ) AS rn
        FROM test_coverage
    ),
    latest_fm AS (
        SELECT id, feature, module, covered, total, as_of_date FROM ranked WHERE rn = 1
    ),
    prev_fm AS (
        SELECT feature, module, covered, total, as_of_date FROM ranked WHERE rn = 2
    )
"""


@router.get("/summary", response_model=SummaryResponse)
def get_summary(db: Session = Depends(get_db)):
    sql = text(f"""
        WITH {_LATEST_PREV_CTES},
        agg_latest AS (
            SELECT
                COALESCE(SUM(covered), 0)::int AS total_covered,
                COALESCE(SUM(total),   0)::int AS total_cases,
                COUNT(*) FILTER (WHERE covered = total AND total > 0)::int AS modules_done,
                COUNT(*) FILTER (WHERE covered = 0)::int AS modules_zero,
                COUNT(DISTINCT feature)::int   AS product_count
            FROM latest_fm
        ),
        agg_prev AS (
            -- For prev totals, sum prev_fm.covered/total only over modules that
            -- exist in latest_fm (so the comparison set is the same).
            SELECT
                COALESCE(SUM(p.covered), 0)::int AS prev_covered,
                COALESCE(SUM(p.total),   0)::int AS prev_cases,
                COUNT(*)::int                     AS prev_module_count
            FROM prev_fm p
            JOIN latest_fm l USING (feature, module)
        )
        SELECT * FROM agg_latest, agg_prev
    """)
    r = db.execute(sql).one()
    pct = round(r.total_covered / r.total_cases * 100, 1) if r.total_cases else 0.0
    prev_pct = (
        round(r.prev_covered / r.prev_cases * 100, 1)
        if r.prev_module_count > 0 and r.prev_cases else None
    )
    return SummaryResponse(
        total_covered=r.total_covered,
        total_cases=r.total_cases,
        pct=pct,
        modules_done=r.modules_done,
        modules_zero=r.modules_zero,
        product_count=r.product_count,
        prev_covered=r.prev_covered if r.prev_module_count > 0 else None,
        prev_cases=r.prev_cases if r.prev_module_count > 0 else None,
        prev_pct=prev_pct,
    )


@router.get("/by-product", response_model=list[ProductRow])
def get_by_product(db: Session = Depends(get_db)):
    sql = text(f"""
        WITH {_LATEST_PREV_CTES},
        latest_agg AS (
            SELECT feature,
                   SUM(covered)::int AS covered,
                   SUM(total)::int   AS total,
                   COUNT(*)::int     AS module_count
            FROM latest_fm GROUP BY feature
        ),
        prev_agg AS (
            -- Sum prev counts only over modules that still exist in latest
            SELECT l.feature,
                   SUM(p.covered)::int AS prev_covered,
                   SUM(p.total)::int   AS prev_total,
                   COUNT(*)::int       AS prev_module_count
            FROM prev_fm p
            JOIN latest_fm l USING (feature, module)
            GROUP BY l.feature
        )
        SELECT l.feature, l.covered, l.total, l.module_count,
               p.prev_covered, p.prev_total, p.prev_module_count
        FROM latest_agg l
        LEFT JOIN prev_agg p USING (feature)
        ORDER BY l.feature
    """)
    rows = db.execute(sql).all()
    result = []
    for r in rows:
        pct = round(r.covered / r.total * 100, 1) if r.total else 0.0
        has_prev = r.prev_module_count is not None and r.prev_module_count > 0
        prev_pct = (
            round(r.prev_covered / r.prev_total * 100, 1)
            if has_prev and r.prev_total else None
        )
        result.append(ProductRow(
            feature=r.feature,
            covered=r.covered,
            total=r.total,
            pct=pct,
            module_count=r.module_count,
            prev_covered=r.prev_covered if has_prev else None,
            prev_total=r.prev_total if has_prev else None,
            prev_pct=prev_pct,
        ))
    return result


@router.get("/modules", response_model=list[ModuleRow])
def get_modules(feature: Optional[str] = None, db: Session = Depends(get_db)):
    feature_filter = "WHERE l.feature = :feature" if feature else ""
    sql = text(f"""
        WITH {_LATEST_PREV_CTES}
        SELECT
            l.feature, l.module, l.covered, l.total, l.as_of_date,
            p.covered     AS prev_covered,
            p.total       AS prev_total,
            p.as_of_date  AS prev_as_of_date
        FROM latest_fm l
        LEFT JOIN prev_fm p USING (feature, module)
        {feature_filter}
        ORDER BY l.feature, l.module
    """)
    params = {"feature": feature} if feature else {}
    rows = db.execute(sql, params).all()
    result = []
    for r in rows:
        pct = round(r.covered / r.total * 100, 1) if r.total else 0.0
        has_prev = r.prev_covered is not None and r.prev_total is not None
        prev_pct = (
            round(r.prev_covered / r.prev_total * 100, 1)
            if has_prev and r.prev_total else None
        )
        result.append(ModuleRow(
            feature=r.feature,
            module=r.module,
            covered=r.covered,
            total=r.total,
            pct=pct,
            as_of_date=r.as_of_date,
            prev_covered=r.prev_covered if has_prev else None,
            prev_total=r.prev_total if has_prev else None,
            prev_pct=prev_pct,
            prev_as_of_date=r.prev_as_of_date if has_prev else None,
        ))
    return result


@router.get("/trends", response_model=list[TrendRow])
def get_trends(feature: Optional[str] = None, db: Session = Depends(get_db)):
    """Weekly snapshot of total coverage. For each week-Monday that has data,
    we take the latest row per (feature, module) where as_of_date <= week-end,
    then sum covered/total across the snapshot. Result: a true progression of
    coverage as it stood at the end of each week with activity."""
    feature_filter_outer = "AND feature = :feature" if feature else ""
    feature_filter_inner = "AND feature = :feature" if feature else ""
    sql = text(f"""
        WITH weeks AS (
            SELECT DISTINCT DATE_TRUNC('week', as_of_date)::date AS week_start
            FROM test_coverage
            WHERE as_of_date IS NOT NULL
              {feature_filter_outer}
        ),
        snapshots AS (
            SELECT
                w.week_start,
                tc.feature,
                tc.module,
                tc.covered,
                tc.total,
                ROW_NUMBER() OVER (
                    PARTITION BY w.week_start, tc.feature, tc.module
                    ORDER BY tc.as_of_date DESC, tc.id DESC
                ) AS rn
            FROM weeks w
            JOIN test_coverage tc
              ON tc.as_of_date <= (w.week_start + INTERVAL '6 days')::date
            WHERE tc.as_of_date IS NOT NULL
              {feature_filter_inner}
        )
        SELECT
            week_start,
            SUM(covered)::int AS covered,
            SUM(total)::int   AS total
        FROM snapshots
        WHERE rn = 1
        GROUP BY week_start
        ORDER BY week_start
    """)
    params = {"feature": feature} if feature else {}
    rows = db.execute(sql, params).fetchall()
    result = []
    for r in rows:
        pct = round(r.covered / r.total * 100, 1) if r.total else 0.0
        result.append(TrendRow(week_start=r.week_start, covered=r.covered, total=r.total, pct=pct))
    return result
