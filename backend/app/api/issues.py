from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Comment, Issue, IssueAIScore, IssueMetrics, IssueSprint, Sprint, Team, User
from app.schemas.issues import (
    CommentOut,
    IssueAIScoreOut,
    IssueDetailOut,
    IssueListItemOut,
    IssueListOut,
    IssueMetricsOut,
    SprintRefOut,
)
from app.services.scoring_service import ScoringRateLimitedError, score_single

router = APIRouter(prefix="/api/issues", tags=["issues"])


_SORT_COLUMNS = {
    "created_at": "f.created_at",
    "updated_at": "f.updated_at",
    "story_points": "f.story_points",
    "quality_score": "f.quality_score",
    "spent_hours": "f.spent_hours",
    "estimate_hours": "f.estimate_hours",
    "jira_key": "f.jira_key",
    "sprint_name": "ls.name",
    "status": "f.status",
    "issue_type": "f.issue_type",
}


@router.get("", response_model=IssueListOut)
def list_issues(
    team_id: int | None = Query(None),
    team_ids: list[int] | None = Query(None),
    sprint_id: int | None = Query(None),
    sprint_ids: list[int] | None = Query(None),
    assignee_id: int | None = Query(None),
    project: str | None = Query(None),
    status: str | None = Query(None),
    issue_type: str | None = Query(None),
    epic_key: str | None = Query(None),
    has_ai_score: bool | None = Query(None),
    has_sprint: bool | None = Query(None),
    is_done: bool | None = Query(None),
    score_status: str | None = Query(
        None,
        description="pending | scored | unscored | attention",
        regex="^(pending|scored|unscored|attention)$",
    ),
    staged: bool | None = Query(
        None,
        description="true: issues with a pending/approved staging row (queued for promote)",
    ),
    resolved_since: Optional[datetime] = Query(None),
    resolved_until: Optional[datetime] = Query(None),
    q: str | None = Query(None, description="Substring match on jira_key or summary"),
    sort: str = Query("created_at", description="created_at|updated_at|story_points|quality_score|spent_hours|estimate_hours|jira_key"),
    order: str = Query("desc", description="asc|desc"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> IssueListOut:
    if sort not in _SORT_COLUMNS:
        raise HTTPException(status_code=400, detail=f"sort must be one of {list(_SORT_COLUMNS)}")
    if order.lower() not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be asc or desc")

    clauses: list[str] = []
    params: dict[str, Any] = {}
    effective_team_ids = team_ids or ([team_id] if team_id is not None else None)
    if effective_team_ids:
        clauses.append("f.team_id = ANY(:team_ids)")
        params["team_ids"] = effective_team_ids
    if assignee_id is not None:
        clauses.append("f.assignee_id = :assignee_id")
        params["assignee_id"] = assignee_id
    if project:
        clauses.append("f.project = :project")
        params["project"] = project
    if status:
        clauses.append("f.status = :status")
        params["status"] = status
    if issue_type:
        clauses.append("lower(f.issue_type) = lower(:issue_type)")
        params["issue_type"] = issue_type
    if epic_key:
        clauses.append("f.epic_key = :epic_key")
        params["epic_key"] = epic_key
    if has_ai_score is True:
        clauses.append("f.quality_score IS NOT NULL")
    elif has_ai_score is False:
        clauses.append("f.quality_score IS NULL")
    if score_status == "pending":
        clauses.append("f.ai_scoring_status = 'pending'")
    elif score_status == "scored":
        clauses.append("f.ai_scoring_status = 'completed'")
    elif score_status == "unscored":
        clauses.append("f.ai_scoring_status IS NULL")
    elif score_status == "attention":
        clauses.append(
            "(f.ai_scoring_status = 'failed' OR f.quality_score < 2.5)"
        )
    if staged is True:
        clauses.append(
            "f.jira_key IN (SELECT jira_key FROM staging_issues"
            " WHERE review_status IN ('pending', 'approved'))"
        )
    elif staged is False:
        clauses.append(
            "f.jira_key NOT IN (SELECT jira_key FROM staging_issues"
            " WHERE review_status IN ('pending', 'approved'))"
        )
    if has_sprint is True:
        clauses.append("f.issue_id IN (SELECT issue_id FROM issue_sprints)")
    elif has_sprint is False:
        clauses.append("f.issue_id NOT IN (SELECT issue_id FROM issue_sprints)")
    if is_done is True:
        clauses.append("f.is_done IS TRUE")
    elif is_done is False:
        clauses.append("f.is_done IS NOT TRUE")
    if q:
        clauses.append("(f.jira_key ILIKE :q OR f.summary ILIKE :q)")
        params["q"] = f"%{q}%"
    if sprint_id is not None:
        clauses.append(
            "f.issue_id IN (SELECT issue_id FROM issue_sprints WHERE sprint_id = :sprint_id)"
        )
        params["sprint_id"] = sprint_id
    if sprint_ids:
        # Latest-sprint-per-issue must be in the given set. Matches the
        # bucketing used by /api/analytics/story-trends so hero counts and
        # this grid stay consistent.
        clauses.append(
            "f.issue_id IN ("
            " SELECT lsp.issue_id FROM ("
            "   SELECT DISTINCT ON (iss.issue_id) iss.issue_id, iss.sprint_id"
            "   FROM issue_sprints iss"
            "   JOIN sprints s ON s.id = iss.sprint_id"
            "   WHERE s.end_date IS NOT NULL"
            "   ORDER BY iss.issue_id, s.end_date DESC"
            " ) lsp WHERE lsp.sprint_id = ANY(:sprint_ids)"
            ")"
        )
        params["sprint_ids"] = sprint_ids
    if resolved_since is not None:
        clauses.append("f.resolved_at >= :resolved_since")
        params["resolved_since"] = resolved_since
    if resolved_until is not None:
        clauses.append("f.resolved_at < :resolved_until")
        params["resolved_until"] = resolved_until

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    sort_col = _SORT_COLUMNS[sort]
    direction = order.upper()

    total_sql = text(f"SELECT COUNT(*) FROM v_issue_facts f {where}")
    total = db.execute(total_sql, params).scalar_one() or 0

    list_sql = text(
        f"""
        SELECT
            f.issue_id,
            f.jira_key,
            f.project,
            f.summary,
            f.issue_type,
            f.status,
            f.priority,
            f.epic_key,
            f.story_points,
            f.estimate_hours,
            f.spent_hours,
            f.no_description,
            f.over_budget,
            f.is_done,
            f.assignee_id,
            f.assignee_name,
            f.team_id,
            f.team_name,
            f.quality_score,
            f.ai_plan_detected,
            f.skill_usage_detected,
            f.skill_name,
            f.ai_scoring_status,
            f.scored_at,
            f.created_at,
            f.updated_at,
            f.resolved_at,
            ls.id    AS sprint_id,
            ls.name  AS sprint_name,
            ls.state AS sprint_state
        FROM v_issue_facts f
        LEFT JOIN LATERAL (
            SELECT s.id, s.name, s.state
            FROM issue_sprints iss
            JOIN sprints s ON s.id = iss.sprint_id
            WHERE iss.issue_id = f.issue_id AND s.end_date IS NOT NULL
            ORDER BY s.end_date DESC
            LIMIT 1
        ) ls ON TRUE
        {where}
        ORDER BY {sort_col} {direction} NULLS LAST, f.issue_id DESC
        LIMIT :limit OFFSET :offset
        """
    )
    items_params = {**params, "limit": limit, "offset": offset}
    rows = db.execute(list_sql, items_params).all()
    items = [IssueListItemOut(**_coerce(dict(r._mapping))) for r in rows]

    return IssueListOut(items=items, total=total, limit=limit, offset=offset)


@router.post("/{key}/score", response_model=IssueAIScoreOut)
def rescore_issue(key: str, db: Session = Depends(get_db)) -> IssueAIScoreOut:
    """Re-score a single issue synchronously using claude-sonnet-4-6. Bypasses
    batch eligibility filters and the scoring_lock."""
    issue = db.query(Issue).filter(Issue.jira_key == key).one_or_none()
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")
    try:
        row = score_single(db, issue)
    except ScoringRateLimitedError as exc:
        raise HTTPException(status_code=503, detail=f"Claude CLI rate-limited: {exc}")
    except RuntimeError as exc:
        msg = str(exc)
        if "already being scored" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=500, detail=msg)
    return _ai_score_out(row)


@router.get("/{key}", response_model=IssueDetailOut)
def get_issue(key: str, db: Session = Depends(get_db)) -> IssueDetailOut:
    issue = db.query(Issue).filter(Issue.jira_key == key).one_or_none()
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")

    assignee = db.get(User, issue.assignee_id) if issue.assignee_id else None
    reporter = db.get(User, issue.reporter_id) if issue.reporter_id else None
    team = db.get(Team, issue.team_id) if issue.team_id else None

    ai_row = (
        db.query(IssueAIScore).filter(IssueAIScore.issue_id == issue.id).one_or_none()
    )
    metrics_row = (
        db.query(IssueMetrics).filter(IssueMetrics.issue_id == issue.id).one_or_none()
    )

    sprint_rows = (
        db.query(Sprint)
        .join(IssueSprint, IssueSprint.sprint_id == Sprint.id)
        .filter(IssueSprint.issue_id == issue.id)
        .order_by(Sprint.start_date.desc().nulls_last())
        .all()
    )
    sprints = [
        SprintRefOut(
            id=s.id,
            jira_sprint_id=s.jira_sprint_id,
            name=s.name,
            state=s.state,
            start_date=s.start_date,
            end_date=s.end_date,
        )
        for s in sprint_rows
    ]

    comment_rows = (
        db.query(Comment)
        .filter(Comment.issue_id == issue.id)
        .order_by(Comment.created_at.desc().nulls_last())
        .limit(20)
        .all()
    )
    comments = [
        CommentOut(
            id=c.id,
            body=c.body,
            author_name=(
                db.get(User, c.author_id).display_name if c.author_id else None
            ),
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in comment_rows
    ]

    return IssueDetailOut(
        id=issue.id,
        jira_key=issue.jira_key,
        jira_issue_id=issue.jira_issue_id,
        project=issue.project,
        summary=issue.summary,
        description=issue.description,
        issue_type=issue.issue_type,
        status=issue.status,
        priority=issue.priority,
        epic_key=issue.epic_key,
        story_points=float(issue.story_points) if issue.story_points is not None else None,
        time_estimate_secs=issue.time_estimate_secs,
        time_spent_secs=issue.time_spent_secs,
        labels=issue.labels,
        components=issue.components,
        fix_versions=issue.fix_versions,
        customers=issue.customers,
        reported_by_customer=issue.reported_by_customer,
        prod_release_date=issue.prod_release_date.isoformat() if issue.prod_release_date else None,
        created_at=issue.created_at,
        updated_at=issue.updated_at,
        resolved_at=issue.resolved_at,
        synced_at=issue.synced_at,
        assignee=_user_dict(assignee),
        reporter=_user_dict(reporter),
        team=_team_dict(team),
        sprints=sprints,
        ai_score=_ai_score_out(ai_row),
        metrics=_metrics_out(metrics_row),
        comments=comments,
    )


# ---------- coercion helpers ----------


def _coerce(row: dict) -> dict:
    out: dict = {}
    for key, value in row.items():
        if value is None or isinstance(value, (int, float, bool, str)):
            out[key] = value
        elif hasattr(value, "is_finite"):
            out[key] = float(value)
        else:
            out[key] = value
    return out


def _user_dict(user: User | None) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "jira_account_id": user.jira_account_id,
        "display_name": user.display_name,
        "email": user.email,
    }


def _team_dict(team: Team | None) -> dict | None:
    if team is None:
        return None
    return {
        "id": team.id,
        "jira_team_id": team.jira_team_id,
        "name": team.name,
    }


def _ai_score_out(row: IssueAIScore | None) -> IssueAIScoreOut | None:
    if row is None:
        return None
    return IssueAIScoreOut(
        scoring_status=row.scoring_status,
        description_quality_score=(
            float(row.description_quality_score)
            if row.description_quality_score is not None
            else None
        ),
        ai_score=row.ai_score,
        ai_plan_detected=row.ai_plan_detected,
        skill_usage_detected=row.skill_usage_detected,
        skill_name=row.skill_name,
        complexity_estimate=row.complexity_estimate,
        scoring_notes=row.scoring_notes,
        model_used=row.model_used,
        scored_at=row.scored_at,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        cache_read_tokens=row.cache_read_tokens,
    )


def _metrics_out(row: IssueMetrics | None) -> IssueMetricsOut | None:
    if row is None:
        return None
    return IssueMetricsOut(
        cycle_time_hours=float(row.cycle_time_hours) if row.cycle_time_hours is not None else None,
        lead_time_hours=float(row.lead_time_hours) if row.lead_time_hours is not None else None,
        time_in_status=row.time_in_status,
        reopen_count=row.reopen_count,
        comment_count=row.comment_count,
    )
