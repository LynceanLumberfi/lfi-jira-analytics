from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    jira_team_id: str
    name: str | None
    issue_count: int = 0


class SprintOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    jira_sprint_id: int
    name: str | None
    state: str | None
    start_date: datetime | None
    end_date: datetime | None
    complete_date: datetime | None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    jira_account_id: str
    display_name: str | None
    email: str | None
