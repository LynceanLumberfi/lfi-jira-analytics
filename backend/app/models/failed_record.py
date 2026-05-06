from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FailedRecord(Base):
    """One row per record-level failure across sync, promote, sanitize, score phases.

    Distinct from `staging_issues.review_status='failed'`, which only tracks
    per-issue promote failures via free-text. This table normalizes errors
    with a shared taxonomy so the UI can group, retry, or dismiss them.
    """

    __tablename__ = "failed_records"

    PHASE_SYNC = "sync"
    PHASE_PROMOTE = "promote"
    PHASE_SANITIZE = "sanitize"
    PHASE_SCORE = "score"

    ENTITY_ISSUE = "issue"
    ENTITY_USER = "user"
    ENTITY_SPRINT = "sprint"
    ENTITY_COMMENT = "comment"
    ENTITY_ATTACHMENT = "attachment"
    ENTITY_TEAM = "team"

    CODE_DEPENDENCY = "DEPENDENCY"
    CODE_CONFLICT_UNIQUE = "CONFLICT_UNIQUE"
    CODE_CONFLICT_FIELDS = "CONFLICT_FIELDS"
    CODE_VALIDATION = "VALIDATION"
    CODE_RATE_LIMITED = "RATE_LIMITED"
    CODE_NETWORK = "NETWORK"
    CODE_TIMEOUT = "TIMEOUT"
    CODE_UNKNOWN = "UNKNOWN"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sync_state_id: Mapped[int | None] = mapped_column(
        ForeignKey("sync_state.id", ondelete="CASCADE"), nullable=True
    )
    staging_id: Mapped[int | None] = mapped_column(
        ForeignKey("staging_issues.id", ondelete="SET NULL"), nullable=True
    )
    phase: Mapped[str] = mapped_column(String, nullable=False)
    entity: Mapped[str] = mapped_column(String, nullable=False)
    direction: Mapped[str] = mapped_column(
        String, server_default="jira_to_lumber", nullable=False
    )
    jira_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str] = mapped_column(String, nullable=False)
    fix_steps: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    raw_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    retry_count: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    last_retried_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    dismissed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "phase IN ('sync', 'promote', 'sanitize', 'score')",
            name="ck_failed_records_phase",
        ),
        CheckConstraint(
            "entity IN ('issue', 'user', 'sprint', 'comment', 'attachment', 'team')",
            name="ck_failed_records_entity",
        ),
        CheckConstraint(
            "error_code IN ('DEPENDENCY', 'CONFLICT_UNIQUE', 'CONFLICT_FIELDS', "
            "'VALIDATION', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT', 'UNKNOWN')",
            name="ck_failed_records_error_code",
        ),
        Index("idx_failed_sync", "sync_state_id"),
        Index(
            "idx_failed_open",
            text("created_at DESC"),
            postgresql_where=text("dismissed_at IS NULL"),
        ),
        Index("idx_failed_code", "error_code"),
        Index("idx_failed_entity_ref", "entity", "jira_ref"),
    )
