from __future__ import annotations

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class IssueSprint(Base):
    """Junction table — issues belong to many sprints over their lifetime."""

    __tablename__ = "issue_sprints"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("issues.id", ondelete="CASCADE"), nullable=False
    )
    sprint_id: Mapped[int] = mapped_column(
        ForeignKey("sprints.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("issue_id", "sprint_id", name="uq_issue_sprints_issue_sprint"),
        Index("idx_issue_sprints_issue", "issue_id"),
        Index("idx_issue_sprints_sprint", "sprint_id"),
    )
