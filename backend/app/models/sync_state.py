from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SyncState(Base):
    """One row per Jira sync run — audit log + cursor for incremental syncs."""

    __tablename__ = "sync_state"

    STATUS_RUNNING = "running"
    STATUS_SUCCESS = "success"
    STATUS_ERROR = "error"

    # `sync_state` rows are now shared by sync runs *and* by promote / sanitize
    # batches (so each gets its own phase row + reaper coverage). The set
    # below identifies non-sync triggered_by values — callers that mean "any
    # in-progress sync" should exclude these.
    TRIGGERED_BY_SYNC = "api"
    TRIGGERED_BY_PROMOTE = "api-promote"
    TRIGGERED_BY_SANITIZE = "api-sanitize"
    TRIGGERED_BY_SCORE = "api-score"
    NON_SYNC_TRIGGERED_BY: tuple[str, ...] = (
        TRIGGERED_BY_PROMOTE,
        TRIGGERED_BY_SANITIZE,
        TRIGGERED_BY_SCORE,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String, nullable=False)
    since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    synced_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    issues_synced: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String, nullable=True)
    sync_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    phases: Mapped[list["SyncPhase"]] = relationship(  # type: ignore[name-defined]
        "SyncPhase",
        back_populates="sync_state",
        order_by="SyncPhase.started_at",
        cascade="all, delete-orphan",
        lazy="select",
    )

    __table_args__ = (
        Index("idx_sync_state_started_at", "started_at"),
        Index("idx_sync_state_status", "status"),
        Index("idx_sync_state_sync_group_id", "sync_group_id"),
    )
