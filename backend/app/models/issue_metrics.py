from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class IssueMetrics(Base):
    __tablename__ = "issue_metrics"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("issues.id"), unique=True, nullable=False
    )
    cycle_time_hours: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    lead_time_hours: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    time_in_status: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    reopen_count: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    comment_count: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
