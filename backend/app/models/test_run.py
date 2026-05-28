from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TestRun(Base):
    __tablename__ = "test_run"

    KIND_PLAYWRIGHT = "playwright"
    KIND_SUREFIRE = "surefire"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    bucket: Mapped[str] = mapped_column(String, nullable=False)
    source_path: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    build_number: Mapped[int] = mapped_column(Integer, nullable=False)
    suite: Mapped[str | None] = mapped_column(String, nullable=True)
    repo_path: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    run_date: Mapped[date] = mapped_column(Date, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    flaky: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)
    ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    top_level_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_test_run_kind_run_date", "kind", "run_date"),
        Index("idx_test_run_suite_run_date", "suite", "run_date"),
    )
