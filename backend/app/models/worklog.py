from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Worklog(Base):
    """One row per Jira worklog entry. Stores the ADF comment alongside the
    time spent so analytics can answer "where is dev time going" by grouping
    on author, started_at, or comment_text patterns.
    """

    __tablename__ = "worklogs"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("issues.id", ondelete="CASCADE"), nullable=False
    )
    jira_worklog_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    time_spent_secs: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    comment_adf: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    comment_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_worklogs_issue_started", "issue_id", "started_at"),
        Index("idx_worklogs_author_started", "author_id", "started_at"),
    )
