from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class TestCaseResult(Base):
    __tablename__ = "test_case_result"

    STATUS_PASSED = "passed"
    STATUS_FAILED = "failed"
    STATUS_ERROR = "error"
    STATUS_SKIPPED = "skipped"
    STATUS_TIMED_OUT = "timedOut"
    STATUS_INTERRUPTED = "interrupted"
    STATUS_FLAKY = "flaky"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("test_run.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    test_name: Mapped[str] = mapped_column(Text, nullable=False)
    test_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    class_fqn: Mapped[str | None] = mapped_column(Text, nullable=True)
    package_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    suite_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_name: Mapped[str | None] = mapped_column(String, nullable=True)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    outcome: Mapped[str | None] = mapped_column(String, nullable=True)
    ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    retry: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_stack: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    step_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachment_names: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    module: Mapped[str | None] = mapped_column(String, nullable=True)
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("idx_test_case_result_run", "run_id"),
        Index("idx_test_case_result_kind_status", "kind", "status"),
        Index("idx_test_case_result_kind_name_started", "kind", "test_name", "started_at"),
        Index("idx_test_case_result_kind_module", "kind", "module"),
    )
