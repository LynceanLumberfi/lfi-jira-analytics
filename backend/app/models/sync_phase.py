from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SyncPhase(Base):
    """One row per pipeline phase within a sync run.
    Tracks live progress (heartbeat, items_processed) and stores phase-specific
    outcome metrics for per-phase average-time queries and UI progress bars.
    """

    __tablename__ = "sync_phases"

    PHASE_SYNCING = "syncing"
    PHASE_PROMOTING = "promoting"
    PHASE_EXTRACTING = "extracting"
    PHASE_EXTRACTING_CHANGELOGS = "extracting_changelogs"
    PHASE_EXTRACTING_COMMENTS = "extracting_comments"
    PHASE_EXTRACTING_WORKLOGS = "extracting_worklogs"
    PHASE_EXTRACTING_ATTACHMENTS = "extracting_attachments"
    PHASE_RECONCILING = "reconciling"
    PHASE_SCORING = "scoring"

    STATUS_RUNNING = "running"
    STATUS_SUCCESS = "success"
    STATUS_ERROR = "error"

    id: Mapped[int] = mapped_column(primary_key=True)
    sync_state_id: Mapped[int] = mapped_column(
        ForeignKey("sync_state.id", ondelete="CASCADE"), nullable=False
    )
    phase: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, server_default="running", nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    items_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    items_processed: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    sync_state: Mapped["SyncState"] = relationship(  # type: ignore[name-defined]
        "SyncState", back_populates="phases"
    )

    __table_args__ = (
        Index("idx_sync_phases_sync_state", "sync_state_id"),
        Index("idx_sync_phases_phase_status", "phase", "status"),
        Index(
            "idx_sync_phases_heartbeat_running",
            "heartbeat_at",
            postgresql_where=text("status = 'running'"),
        ),
    )
