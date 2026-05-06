from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class StagingIssue(Base):
    """Raw Jira issue payload held for user review before promotion to `issues`.

    Invariant: at most one row per `jira_key` is in an "active" state
    (`pending` or `approved`). When a re-sync brings a different hash for
    a `jira_key` whose current row is still active, the old row is moved
    to `superseded` (terminal) before the new row is inserted. Enforced
    by a partial unique index — see `uq_staging_active_jira_key`.
    """

    __tablename__ = "staging_issues"

    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_SKIPPED = "skipped"
    STATUS_PROMOTED = "promoted"
    STATUS_FAILED = "failed"
    STATUS_SUPERSEDED = "superseded"

    ACTIVE_STATUSES = (STATUS_PENDING, STATUS_APPROVED)

    CHANGE_NEW = "new"
    CHANGE_UPDATED = "updated"

    id: Mapped[int] = mapped_column(primary_key=True)
    jira_key: Mapped[str] = mapped_column(String, nullable=False)
    sync_state_id: Mapped[int] = mapped_column(
        ForeignKey("sync_state.id", ondelete="CASCADE"), nullable=False
    )
    jira_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    change_type: Mapped[str] = mapped_column(String, nullable=False)  # 'new' | 'updated'
    raw_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    review_status: Mapped[str] = mapped_column(
        String, server_default="pending", nullable=False
    )
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    promoted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    superseded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @property
    def summary(self) -> str | None:
        if not self.raw_payload:
            return None
        return self.raw_payload.get("fields", {}).get("summary")

    @property
    def issue_type(self) -> str | None:
        if not self.raw_payload:
            return None
        return (
            self.raw_payload.get("fields", {})
            .get("issuetype", {})
            .get("name")
        )

    __table_args__ = (
        Index("idx_staging_sync_key", "sync_state_id", "jira_key", unique=True),
        Index("idx_staging_key_id", "jira_key", "id"),
        Index("idx_staging_review_status", "review_status"),
        Index("idx_staging_change_type_status", "change_type", "review_status"),
        Index(
            "uq_staging_active_jira_key",
            "jira_key",
            unique=True,
            postgresql_where=text("review_status IN ('pending', 'approved')"),
        ),
    )
