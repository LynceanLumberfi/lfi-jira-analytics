from __future__ import annotations

from datetime import date

from sqlalchemy import Date, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TestCoverage(Base):
    __tablename__ = "test_coverage"
    __table_args__ = (
        UniqueConstraint(
            "feature", "module", "as_of_date",
            name="uq_test_coverage_feature_module_date",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    feature: Mapped[str] = mapped_column(String, nullable=False)
    module: Mapped[str] = mapped_column(String, nullable=False)
    covered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
