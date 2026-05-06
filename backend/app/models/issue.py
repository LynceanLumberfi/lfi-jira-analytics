from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    jira_key: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    jira_issue_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    project: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_adf: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    issue_type: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    priority: Mapped[str | None] = mapped_column(String, nullable=True)
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    reporter_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id"), nullable=True
    )
    epic_key: Mapped[str | None] = mapped_column(String, nullable=True)
    story_points: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    time_estimate_secs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_spent_secs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    labels: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    components: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    fix_versions: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    customers: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    reported_by_customer: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    prod_release_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    raw_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_issues_project", "project"),
        Index("idx_issues_assignee", "assignee_id"),
        Index("idx_issues_team", "team_id"),
        Index("idx_issues_status", "status"),
        Index("idx_issues_created_at", "created_at"),
        Index("idx_issues_issue_type", "issue_type"),
        Index("idx_issues_epic_key", "epic_key"),
    )
