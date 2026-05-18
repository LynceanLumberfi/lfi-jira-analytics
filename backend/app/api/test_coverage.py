import io
from datetime import date
from typing import Optional

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


class ProductRow(BaseModel):
    feature: str
    covered: int
    total: int
    pct: float
    module_count: int


class ModuleRow(BaseModel):
    module: str
    covered: int
    total: int
    pct: float
    as_of_date: Optional[date]


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

    rows = []
    for _, row in df.iterrows():
        try:
            as_of = None
            raw_date = str(row.get("Date", "")).strip()
            if raw_date and raw_date.lower() not in ("nat", "nan", ""):
                as_of = pd.to_datetime(raw_date, format="%m/%d/%y", errors="coerce")
                as_of = as_of.date() if not pd.isnull(as_of) else None
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
        raise HTTPException(status_code=400, detail="No parseable rows in CSV")

    keys = [(r["feature"], r["module"]) for r in rows]
    existing_count = (
        db.query(func.count(TestCoverage.id))
        .filter(
            TestCoverage.feature.in_([k[0] for k in keys]),
            TestCoverage.module.in_([k[1] for k in keys]),
        )
        .scalar()
        or 0
    )

    stmt = insert(TestCoverage).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_test_coverage_feature_module",
        set_={
            "covered": stmt.excluded.covered,
            "total": stmt.excluded.total,
            "as_of_date": stmt.excluded.as_of_date,
        },
    )
    db.execute(stmt)
    db.commit()

    total = len(rows)
    updated = min(existing_count, total)
    inserted = total - updated

    return UploadResult(inserted=inserted, updated=updated, total=total)


@router.get("/summary", response_model=SummaryResponse)
def get_summary(db: Session = Depends(get_db)):
    rows = db.query(TestCoverage).all()
    if not rows:
        return SummaryResponse(
            total_covered=0, total_cases=0, pct=0.0,
            modules_done=0, modules_zero=0, product_count=0,
        )
    total_covered = sum(r.covered for r in rows)
    total_cases = sum(r.total for r in rows)
    pct = round(total_covered / total_cases * 100, 1) if total_cases else 0.0
    modules_done = sum(1 for r in rows if r.covered == r.total and r.total > 0)
    modules_zero = sum(1 for r in rows if r.covered == 0)
    features = {r.feature for r in rows}
    return SummaryResponse(
        total_covered=total_covered,
        total_cases=total_cases,
        pct=pct,
        modules_done=modules_done,
        modules_zero=modules_zero,
        product_count=len(features),
    )


@router.get("/by-product", response_model=list[ProductRow])
def get_by_product(db: Session = Depends(get_db)):
    rows = (
        db.query(
            TestCoverage.feature,
            func.sum(TestCoverage.covered).label("covered"),
            func.sum(TestCoverage.total).label("total"),
            func.count(TestCoverage.id).label("module_count"),
        )
        .group_by(TestCoverage.feature)
        .order_by(TestCoverage.feature)
        .all()
    )
    result = []
    for r in rows:
        pct = round(r.covered / r.total * 100, 1) if r.total else 0.0
        result.append(ProductRow(
            feature=r.feature,
            covered=r.covered,
            total=r.total,
            pct=pct,
            module_count=r.module_count,
        ))
    return result


@router.get("/modules", response_model=list[ModuleRow])
def get_modules(feature: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(TestCoverage)
    if feature:
        q = q.filter(TestCoverage.feature == feature)
    rows = q.order_by(TestCoverage.feature, TestCoverage.module).all()
    result = []
    for r in rows:
        pct = round(r.covered / r.total * 100, 1) if r.total else 0.0
        result.append(ModuleRow(
            module=r.module,
            covered=r.covered,
            total=r.total,
            pct=pct,
            as_of_date=r.as_of_date,
        ))
    return result


@router.get("/trends", response_model=list[TrendRow])
def get_trends(feature: Optional[str] = None, db: Session = Depends(get_db)):
    """Weekly cumulative coverage trends derived from as_of_date."""
    feature_filter = "AND feature = :feature" if feature else ""
    sql = text(f"""
        SELECT
            DATE_TRUNC('week', as_of_date)::date AS week_start,
            SUM(SUM(covered)) OVER (ORDER BY DATE_TRUNC('week', as_of_date)) AS covered,
            SUM(SUM(total))   OVER (ORDER BY DATE_TRUNC('week', as_of_date)) AS total
        FROM test_coverage
        WHERE as_of_date IS NOT NULL
          {feature_filter}
        GROUP BY DATE_TRUNC('week', as_of_date)
        ORDER BY week_start
    """)
    params = {"feature": feature} if feature else {}
    rows = db.execute(sql, params).fetchall()
    result = []
    for r in rows:
        covered = int(r.covered)
        total = int(r.total)
        pct = round(covered / total * 100, 1) if total else 0.0
        result.append(TrendRow(week_start=r.week_start, covered=covered, total=total, pct=pct))
    return result
