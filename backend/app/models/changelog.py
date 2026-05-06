from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Changelog(Base):
    __tablename__ = "changelogs"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("issues.id", ondelete="CASCADE"), nullable=False
    )
    field: Mapped[str | None] = mapped_column(String, nullable=True)
    from_value: Mapped[str | None] = mapped_column(String, nullable=True)
    to_value: Mapped[str | None] = mapped_column(String, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        Index("idx_changelogs_issue_field", "issue_id", "field", "changed_at"),
    )
