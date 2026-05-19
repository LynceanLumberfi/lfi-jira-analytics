from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Issue, IssueSprint, Sprint, Team, User
from app.schemas.dimensions import SprintOut, TeamOut, UserOut

router = APIRouter(prefix="/api", tags=["dimensions"])


@router.get("/teams", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)) -> list[TeamOut]:
    rows = db.execute(
        select(
            Team.id,
            Team.jira_team_id,
            Team.name,
            func.count(Issue.id).label("issue_count"),
        )
        .outerjoin(Issue, Issue.team_id == Team.id)
        .group_by(Team.id, Team.jira_team_id, Team.name)
        .order_by(Team.name.nulls_last())
    ).all()
    return [
        TeamOut(
            id=r.id,
            jira_team_id=r.jira_team_id,
            name=r.name,
            issue_count=r.issue_count or 0,
        )
        for r in rows
    ]


@router.get("/sprints", response_model=list[SprintOut])
def list_sprints(
    state: str | None = Query(None, description="active | closed | future"),
    team_id: int | None = Query(None),
    end_from: date | None = Query(None, description="end_date >= this (inclusive)"),
    end_to: date | None = Query(None, description="end_date <= this (inclusive)"),
    db: Session = Depends(get_db),
) -> list[SprintOut]:
    q = select(Sprint)
    if state:
        q = q.where(Sprint.state == state)
    if team_id is not None:
        q = q.where(
            Sprint.id.in_(
                select(IssueSprint.sprint_id)
                .join(Issue, Issue.id == IssueSprint.issue_id)
                .where(Issue.team_id == team_id)
            )
        )
    if end_from is not None:
        q = q.where(Sprint.end_date >= end_from)
    if end_to is not None:
        # end_date is a datetime; include the entire end_to day
        q = q.where(Sprint.end_date < end_to + timedelta(days=1))
    q = q.order_by(Sprint.jira_sprint_id.desc())
    rows = db.execute(q).scalars().all()
    return [SprintOut.model_validate(r) for r in rows]


@router.get("/users", response_model=list[UserOut])
def list_users(
    has_assigned: bool = Query(False, description="Only users with at least one assigned issue"),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    q = select(User)
    if has_assigned:
        q = q.where(
            User.id.in_(select(Issue.assignee_id).where(Issue.assignee_id.is_not(None)))
        )
    q = q.order_by(User.display_name.nulls_last())
    rows = db.execute(q).scalars().all()
    return [UserOut.model_validate(r) for r in rows]
