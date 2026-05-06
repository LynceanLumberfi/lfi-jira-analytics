from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class IssueAIScore(Base):
    __tablename__ = "issue_ai_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("issues.id"), unique=True, nullable=False
    )
    scoring_status: Mapped[str] = mapped_column(
        String, server_default="pending", nullable=False
    )
    description_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description_quality_score: Mapped[Decimal | None] = mapped_column(
        Numeric(2, 1), nullable=True
    )
    ai_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_cost_usd: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 6), nullable=True
    )
    ai_plan_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    skill_usage_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    skill_name: Mapped[str | None] = mapped_column(String, nullable=True)
    complexity_estimate: Mapped[str | None] = mapped_column(String, nullable=True)
    scoring_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String, nullable=True)
    scored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        Index("idx_ai_scores_issue", "issue_id"),
        Index("idx_ai_scores_status", "scoring_status"),
    )
