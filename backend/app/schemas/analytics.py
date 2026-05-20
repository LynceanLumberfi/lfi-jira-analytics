from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.schemas.issues import IssueListOut


class TeamAggregateOut(BaseModel):
    team_id: int | None
    team_name: str | None
    jira_team_id: str | None
    issue_count: int
    scored_count: int
    avg_quality: float | None
    total_story_points: float | None
    avg_story_points: float | None
    avg_estimate_hours: float | None
    avg_spent_hours: float | None
    skill_count: int
    skill_adopters: int
    active_devs: int
    no_description_count: int
    over_budget_count: int
    ai_plan_count: int


class AssigneeAggregateOut(BaseModel):
    assignee_id: int | None
    assignee_name: str | None
    assignee_email: str | None
    team_id: int | None
    team_name: str | None
    issue_count: int
    scored_count: int
    avg_quality: float | None
    total_story_points: float | None
    avg_story_points: float | None
    avg_estimate_hours: float | None
    avg_spent_hours: float | None
    skill_count: int
    no_description_count: int
    over_budget_count: int
    ai_plan_count: int


class SprintVelocityOut(BaseModel):
    sprint_id: int
    jira_sprint_id: int
    sprint_name: str | None
    sprint_state: str | None
    start_date: datetime | None
    end_date: datetime | None
    complete_date: datetime | None
    issue_count: int
    completed_count: int
    planned_points: float | None
    completed_points: float | None
    completion_pct: float | None


class EpicProgressOut(BaseModel):
    epic_key: str
    project: str | None
    total_count: int
    done_count: int
    bug_count: int
    points_total: float | None
    points_done: float | None
    completion_pct: float | None


class CostSummaryOut(BaseModel):
    issues_scored: int
    calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_cache_read_tokens: int
    cost_usd: float


class OverviewSummaryOut(BaseModel):
    total_issues: int
    scored_issues: int
    avg_quality: float | None
    avg_ai_plan_pct: float | None
    avg_skill_pct: float | None
    no_description_count: int
    over_budget_count: int
    open_failed_records: int


class StoryTrendOut(BaseModel):
    week_start: date
    story_points: float
    skill_adoption_rate: float | None
    points_per_active_resource: float | None
    hours_per_point: float | None
    story_count: int
    scored_count: int
    active_resources: int
    hour_logged_count: int
    skill_count: int
    skill_adopters: int
    active_delivered_devs: int


class CadenceTrendOut(BaseModel):
    cadence_start: date
    cadence_end: date
    sprint_ids: list[int]
    story_points: float
    skill_adoption_rate: float | None
    points_per_active_resource: float | None
    hours_per_point: float | None
    story_count: int
    scored_count: int
    active_resources: int
    hour_logged_count: int
    skill_count: int
    skill_adopters: int
    active_delivered_devs: int


class IssueTypeTrendOut(BaseModel):
    week_start: date
    stories: int
    bugs: int
    customer_bugs: int = 0
    qa_bugs: int = 0
    tasks: int
    total: int


class CadenceIssueTypeTrendOut(BaseModel):
    cadence_start: date
    cadence_end: date
    sprint_ids: list[int]
    stories: int
    bugs: int
    customer_bugs: int = 0
    qa_bugs: int = 0
    tasks: int
    total: int


# ---- Per-tab composite responses ----


class OverviewResponseOut(BaseModel):
    story_trends: list[StoryTrendOut]
    issue_type_trends: list[IssueTypeTrendOut]


class AiAdoptionResponseOut(BaseModel):
    story_trends: list[CadenceTrendOut]
    cadence_start: date | None
    cadence_end: date | None
    cadence_sprint_ids: list[int]
    cadence_team_breakdown: list[TeamAggregateOut]
    cadence_assignee_breakdown: list[AssigneeAggregateOut]
    cadence_stories: IssueListOut


class ResourceResponseOut(BaseModel):
    story_trends: list[CadenceTrendOut]
    cadence_start: date | None
    cadence_end: date | None
    cadence_sprint_ids: list[int]
    cadence_team_breakdown: list[TeamAggregateOut]
    cadence_assignee_breakdown: list[AssigneeAggregateOut]
    prev_only_assignees: list[AssigneeAggregateOut]
    prev_cadence_assignee_ids: list[int]
    cadence_stories: IssueListOut


class QualityCadenceTeamBreakdown(BaseModel):
    story: list[TeamAggregateOut]
    bug: list[TeamAggregateOut]
    task: list[TeamAggregateOut]


class QualityResponseOut(BaseModel):
    issue_type_trends: list[CadenceIssueTypeTrendOut]
    cadence_start: date | None
    cadence_end: date | None
    cadence_sprint_ids: list[int]
    cadence_team_breakdown: QualityCadenceTeamBreakdown
