from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class IssueListItemOut(BaseModel):
    issue_id: int
    jira_key: str
    project: str | None
    summary: str | None
    issue_type: str | None
    status: str | None
    priority: str | None
    epic_key: str | None
    story_points: float | None
    estimate_hours: float | None
    spent_hours: float | None
    no_description: bool
    over_budget: bool
    is_done: bool
    assignee_id: int | None
    assignee_name: str | None
    team_id: int | None
    team_name: str | None
    quality_score: float | None
    ai_plan_detected: bool | None
    skill_usage_detected: bool | None
    skill_name: str | None
    ai_scoring_status: str | None
    scored_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None
    resolved_at: datetime | None


class IssueListOut(BaseModel):
    items: list[IssueListItemOut]
    total: int
    limit: int
    offset: int


class CommentOut(BaseModel):
    id: int
    body: str | None
    author_name: str | None
    created_at: datetime | None
    updated_at: datetime | None


class SprintRefOut(BaseModel):
    id: int
    jira_sprint_id: int
    name: str | None
    state: str | None
    start_date: datetime | None
    end_date: datetime | None


class IssueAIScoreOut(BaseModel):
    scoring_status: str
    description_quality_score: float | None
    ai_score: int | None
    ai_plan_detected: bool | None
    skill_usage_detected: bool | None
    skill_name: str | None
    complexity_estimate: str | None
    scoring_notes: str | None
    model_used: str | None
    scored_at: datetime | None
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None


class IssueMetricsOut(BaseModel):
    cycle_time_hours: float | None
    lead_time_hours: float | None
    time_in_status: dict | None
    reopen_count: int
    comment_count: int


class IssueDetailOut(BaseModel):
    id: int
    jira_key: str
    jira_issue_id: str | None
    project: str
    summary: str | None
    description: str | None
    issue_type: str | None
    status: str | None
    priority: str | None
    epic_key: str | None
    story_points: float | None
    time_estimate_secs: int | None
    time_spent_secs: int | None
    labels: list[str] | None
    components: list[str] | None
    fix_versions: list[str] | None
    customers: list[str] | None
    reported_by_customer: bool | None
    prod_release_date: str | None
    created_at: datetime | None
    updated_at: datetime | None
    resolved_at: datetime | None
    synced_at: datetime
    assignee: dict | None
    reporter: dict | None
    team: dict | None
    sprints: list[SprintRefOut]
    ai_score: IssueAIScoreOut | None
    metrics: IssueMetricsOut | None
    comments: list[CommentOut]
