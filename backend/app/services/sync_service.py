from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import JiraSettings, get_jira_settings
from app.models import (
    Attachment,
    Changelog,
    Comment,
    Issue,
    IssueMetrics,
    IssueSprint,
    Sprint,
    StagingIssue,
    SyncPhase,
    SyncState,
    Team,
    User,
    Worklog,
)
from app.services.adf import adf_to_text
from app.services.jira_client import JiraClient
from app.services.phase_service import close_phase, close_running_phases, open_phase, tick
from app.services.staging_service import fetch_latest_hashes, stage_issue

logger = logging.getLogger(__name__)


# ---------- helpers ----------


def _latest_sync_group_id(db: Session) -> int | None:
    """Return the sync_group_id of the most recently started sync step."""
    row = (
        db.query(SyncState.sync_group_id)
        .filter(SyncState.triggered_by == SyncState.TRIGGERED_BY_SYNC)
        .filter(SyncState.sync_group_id.isnot(None))
        .order_by(SyncState.started_at.desc())
        .first()
    )
    return row[0] if row else None


# ---------- public entry points ----------


def create_pending_sync_state(
    db: Session, *, since: datetime | None, triggered_by: str | None
) -> SyncState:
    """Create a sync_state row in 'running' status. Caller commits."""

    state = SyncState(
        status=SyncState.STATUS_RUNNING,
        since=since,
        triggered_by=triggered_by,
    )
    db.add(state)
    db.flush()  # populate state.id from the sequence
    state.sync_group_id = state.id
    db.commit()
    db.refresh(state)
    return state


def run_sync(
    session_factory: Callable[[], Session],
    sync_state_id: int,
    *,
    requested_since: datetime | None,
) -> None:
    """Execute a sync run. Resolves the effective `since` against history,
    pages through Jira, upserts everything, and updates the SyncState row.
    Safe to invoke from a FastAPI BackgroundTasks worker."""

    settings = get_jira_settings()
    db = session_factory()
    started_now = datetime.now(timezone.utc)
    issues_synced = 0

    try:
        state = db.get(SyncState, sync_state_id)
        if state is None:
            raise RuntimeError(f"SyncState {sync_state_id} not found")

        effective_since = _resolve_since(db, requested_since, current_id=state.id)
        state.since = effective_since
        db.commit()

        jql = _build_jql(effective_since, settings.project_key)
        logger.info("starting sync id=%s jql=%r", state.id, jql)

        # --- phase: syncing (stage to staging_issues, not directly to issues) ---
        with JiraClient(settings) as client:
            items_total = client.get_issue_count(jql)

        phase_sync = open_phase(db, state.id, SyncPhase.PHASE_SYNCING)
        phase_sync.items_total = items_total
        db.commit()

        latest_hashes = fetch_latest_hashes(db)
        staged_new = 0
        staged_updated = 0
        staged_unchanged = 0

        with JiraClient(settings) as client:
            for jira_issue in client.search_issues(jql):
                result = stage_issue(db, jira_issue, settings, state.id, latest_hashes)
                if result == StagingIssue.CHANGE_NEW:
                    staged_new += 1
                elif result == StagingIssue.CHANGE_UPDATED:
                    staged_updated += 1
                else:
                    staged_unchanged += 1
                issues_synced += 1
                if issues_synced % 50 == 0:
                    db.commit()
                    state.issues_synced = issues_synced
                    db.commit()
                    tick(db, phase_sync, processed=issues_synced)

        # Jira's /search/approximate-count is an estimate that can drift from
        # what the paginated search/jql endpoint actually yields. Reconcile
        # items_total to the real count so the final bar reads N/N = 100%.
        phase_sync.items_total = issues_synced
        phase_sync.items_processed = issues_synced
        db.commit()
        close_phase(
            db,
            phase_sync,
            metrics={
                "total": issues_synced,
                "new": staged_new,
                "updated": staged_updated,
                "unchanged": staged_unchanged,
                "approximate_total": items_total,
            },
        )

        # Sanitize + scoring reconciliation happen at promote time, not here.
        state.status = SyncState.STATUS_SUCCESS
        state.finished_at = datetime.now(timezone.utc)
        state.synced_until = started_now
        state.issues_synced = issues_synced
        db.commit()
        logger.info(
            "sync %s ok — %d fetched, %d new, %d updated, %d unchanged",
            state.id,
            issues_synced,
            staged_new,
            staged_updated,
            staged_unchanged,
        )

    except Exception as exc:  # noqa: BLE001 — record any failure
        logger.exception("sync %s failed", sync_state_id)
        db.rollback()
        close_running_phases(db, sync_state_id, error=exc)
        state = db.get(SyncState, sync_state_id)
        if state is not None:
            state.status = SyncState.STATUS_ERROR
            state.finished_at = datetime.now(timezone.utc)
            state.issues_synced = issues_synced
            state.error_message = f"{type(exc).__name__}: {exc}"[:4000]
            db.commit()
        from app.services.failure_service import record_failure
        record_failure(
            db,
            phase="sync",
            entity="issue",
            title=f"Sync run {sync_state_id} failed",
            exc=exc,
            sync_state_id=sync_state_id,
        )
    finally:
        db.close()


# ---------- since resolution ----------


def _resolve_since(
    db: Session, requested: datetime | None, *, current_id: int
) -> datetime | None:
    """Effective `since` is: explicit request else (last successful synced_until - 1 day)
    else None (full sync)."""

    if requested is not None:
        return requested

    last = db.execute(
        select(SyncState)
        .where(
            SyncState.status == SyncState.STATUS_SUCCESS,
            SyncState.id != current_id,
            SyncState.synced_until.is_not(None),
        )
        .order_by(SyncState.synced_until.desc())
        .limit(1)
    ).scalar_one_or_none()

    if last is None or last.synced_until is None:
        return None
    return last.synced_until - timedelta(days=1)


def _build_jql(since: datetime | None, project_key: str | None) -> str:
    clauses: list[str] = []
    if project_key:
        clauses.append(f'project = "{project_key}"')
    if since is not None:
        ts = since.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
        clauses.append(f'updated >= "{ts}"')
    where = " AND ".join(clauses) if clauses else ""
    return f"{where} ORDER BY updated ASC".strip()


# ---------- issue persistence ----------


def persist_issue(
    db: Session,
    jira_issue: dict[str, Any],
    settings: JiraSettings,
    *,
    jira_client: "JiraClient | None" = None,
    sprint_cache: "dict[int, dict[str, Any]] | None" = None,
) -> dict[str, int]:
    """Promote one staged Jira issue into the relational tables.

    Returns counts of child entities written so the caller can roll them up
    into the per-entity extraction phase rows. Keys match SyncPhase
    PHASE_EXTRACTING_* constants.
    """
    fields = jira_issue.get("fields") or {}

    assignee_user = _upsert_user(db, fields.get("assignee"))
    reporter_user = _upsert_user(db, fields.get("reporter"))
    team_row = _upsert_team(db, fields.get(settings.field_team))

    description_adf = fields.get("description")
    description_text = adf_to_text(description_adf) or _rendered_description(jira_issue)

    issue = _upsert_issue(
        db,
        jira_issue=jira_issue,
        fields=fields,
        settings=settings,
        assignee_id=assignee_user.id if assignee_user else None,
        reporter_id=reporter_user.id if reporter_user else None,
        team_id=team_row.id if team_row else None,
        description_text=description_text,
        description_adf=description_adf if isinstance(description_adf, dict) else None,
    )

    _replace_issue_sprints(
        db, issue, fields.get(settings.field_sprint),
        jira_client=jira_client, sprint_cache=sprint_cache,
    )
    _upsert_comments(db, issue, fields.get("comment"))
    _upsert_attachments(db, issue, fields.get("attachment"))
    _upsert_worklogs(db, issue, fields.get("worklog"))
    _replace_changelog(db, issue, jira_issue.get("changelog"))
    _upsert_issue_metrics(db, issue)

    db.flush()

    return {
        SyncPhase.PHASE_EXTRACTING_CHANGELOGS: _count_changelog_items(
            jira_issue.get("changelog")
        ),
        SyncPhase.PHASE_EXTRACTING_COMMENTS: _count_comments(fields.get("comment")),
        SyncPhase.PHASE_EXTRACTING_WORKLOGS: _count_worklogs(fields.get("worklog")),
        SyncPhase.PHASE_EXTRACTING_ATTACHMENTS: _count_attachments(
            fields.get("attachment")
        ),
    }


def _count_changelog_items(changelog: Any) -> int:
    if not isinstance(changelog, dict):
        return 0
    return sum(
        len(h.get("items") or []) for h in (changelog.get("histories") or [])
    )


def _count_comments(payload: Any) -> int:
    if not isinstance(payload, dict):
        return 0
    return len(payload.get("comments") or [])


def _count_worklogs(payload: Any) -> int:
    if not isinstance(payload, dict):
        return 0
    return len(payload.get("worklogs") or [])


def _count_attachments(payload: Any) -> int:
    if not isinstance(payload, list):
        return 0
    return len(payload)


def _upsert_user(db: Session, payload: dict[str, Any] | None) -> User | None:
    if not payload:
        return None
    account_id = payload.get("accountId")
    if not account_id:
        return None
    user = db.execute(
        select(User).where(User.jira_account_id == account_id)
    ).scalar_one_or_none()
    if user is None:
        user = User(jira_account_id=account_id)
        db.add(user)
    user.display_name = payload.get("displayName")
    user.email = payload.get("emailAddress")
    db.flush()
    return user


def _upsert_team(db: Session, payload: Any) -> Team | None:
    if not payload:
        return None
    team_id, name = _team_id_and_name(payload)
    if not team_id:
        return None
    team = db.execute(
        select(Team).where(Team.jira_team_id == team_id)
    ).scalar_one_or_none()
    if team is None:
        team = Team(jira_team_id=team_id)
        db.add(team)
    if name:
        team.name = name
    db.flush()
    return team


def _team_id_and_name(payload: Any) -> tuple[str | None, str | None]:
    if isinstance(payload, dict):
        return (
            payload.get("id") or payload.get("teamId"),
            payload.get("name") or payload.get("displayName"),
        )
    if isinstance(payload, str):
        return payload, None
    return None, None


def _upsert_issue(
    db: Session,
    *,
    jira_issue: dict[str, Any],
    fields: dict[str, Any],
    settings: JiraSettings,
    assignee_id: int | None,
    reporter_id: int | None,
    team_id: int | None,
    description_text: str | None,
    description_adf: dict[str, Any] | None,
) -> Issue:
    jira_key = jira_issue.get("key")
    if not jira_key:
        raise ValueError("Jira issue payload missing 'key'")

    issue = db.execute(
        select(Issue).where(Issue.jira_key == jira_key)
    ).scalar_one_or_none()
    if issue is None:
        issue = Issue(jira_key=jira_key, project=jira_key.split("-", 1)[0])
        db.add(issue)

    issue.jira_issue_id = jira_issue.get("id")
    issue.project = jira_key.split("-", 1)[0]
    issue.summary = fields.get("summary")
    issue.description = description_text
    issue.description_adf = description_adf
    issue.issue_type = _named(fields.get("issuetype"))
    issue.status = _named(fields.get("status"))
    issue.priority = _named(fields.get("priority"))
    issue.assignee_id = assignee_id
    issue.reporter_id = reporter_id
    issue.team_id = team_id
    issue.epic_key = fields.get(settings.field_epic_link) or _parent_epic_key(fields)
    issue.story_points = _to_decimal(fields.get(settings.field_story_points))
    issue.time_estimate_secs = _to_int(fields.get("aggregatetimeoriginalestimate"))
    issue.time_spent_secs = _to_int(fields.get("aggregatetimespent"))
    issue.labels = list(fields.get("labels") or []) or None
    issue.components = [c.get("name") for c in (fields.get("components") or []) if c.get("name")] or None
    issue.fix_versions = [v.get("name") for v in (fields.get("fixVersions") or []) if v.get("name")] or None
    issue.customers = _customer_names(fields.get(settings.field_customer))
    issue.reported_by_customer = _yes_no(fields.get(settings.field_reported_by_customer))
    issue.prod_release_date = _to_date(fields.get(settings.field_prod_release_date))
    issue.created_at = _to_datetime(fields.get("created"))
    issue.updated_at = _to_datetime(fields.get("updated"))
    issue.resolved_at = _to_datetime(fields.get("resolutiondate"))
    issue.raw_json = jira_issue
    issue.synced_at = datetime.now(timezone.utc)
    db.flush()
    return issue


def _replace_issue_sprints(
    db: Session,
    issue: Issue,
    sprint_payload: Any,
    *,
    jira_client: "JiraClient | None" = None,
    sprint_cache: "dict[int, dict[str, Any]] | None" = None,
) -> None:
    sprint_dicts = _normalize_sprint_payload(sprint_payload)
    db.execute(delete(IssueSprint).where(IssueSprint.issue_id == issue.id))
    for sprint_dict in sprint_dicts:
        sprint = _upsert_sprint(
            db, sprint_dict,
            jira_client=jira_client, sprint_cache=sprint_cache,
        )
        if sprint is None:
            continue
        db.add(IssueSprint(issue_id=issue.id, sprint_id=sprint.id))
    db.flush()


def _upsert_sprint(
    db: Session,
    payload: dict[str, Any],
    *,
    jira_client: "JiraClient | None" = None,
    sprint_cache: "dict[int, dict[str, Any]] | None" = None,
) -> Sprint | None:
    sprint_id = payload.get("id")
    if sprint_id is None:
        return None
    try:
        sprint_id_int = int(sprint_id)
    except (TypeError, ValueError):
        return None
    # Prefer authoritative payload from /rest/agile/1.0/sprint/{id}. The
    # embedded-in-issue payload is frozen at the time of last issue.updated
    # so sprint state transitions (future → active → closed) and late date
    # population are missed. Cache per-run to avoid duplicate fetches.
    if jira_client is not None and sprint_cache is not None:
        if sprint_id_int not in sprint_cache:
            try:
                sprint_cache[sprint_id_int] = jira_client.get_sprint(sprint_id_int)
            except Exception as exc:
                logger.warning("sprint refresh failed id=%s: %s", sprint_id_int, exc)
                sprint_cache[sprint_id_int] = payload
        payload = sprint_cache[sprint_id_int]
    sprint = db.execute(
        select(Sprint).where(Sprint.jira_sprint_id == sprint_id_int)
    ).scalar_one_or_none()
    if sprint is None:
        sprint = Sprint(jira_sprint_id=sprint_id_int)
        db.add(sprint)
    sprint.name = payload.get("name")
    sprint.state = payload.get("state")
    sprint.board_id = _to_int(payload.get("boardId") or payload.get("originBoardId"))
    # Preserve manually-normalized start_date / end_date once they exist; only
    # populate from Jira on the first sync of a new sprint (or if a prior sync
    # left them null).
    if sprint.start_date is None:
        sprint.start_date = _to_datetime(payload.get("startDate"))
    if sprint.end_date is None:
        sprint.end_date = _to_datetime(payload.get("endDate"))
    sprint.complete_date = _to_datetime(payload.get("completeDate"))
    db.flush()
    return sprint


def _normalize_sprint_payload(payload: Any) -> list[dict[str, Any]]:
    if not payload:
        return []
    items = payload if isinstance(payload, list) else [payload]
    out: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, dict):
            out.append(item)
    return out


def _upsert_comments(db: Session, issue: Issue, comment_payload: Any) -> None:
    if not isinstance(comment_payload, dict):
        return
    seen_ids: set[str] = set()
    for raw in comment_payload.get("comments") or []:
        comment_id = raw.get("id")
        if not comment_id:
            continue
        seen_ids.add(str(comment_id))
        author = _upsert_user(db, raw.get("author"))
        existing = db.execute(
            select(Comment).where(Comment.jira_comment_id == str(comment_id))
        ).scalar_one_or_none()
        if existing is None:
            existing = Comment(issue_id=issue.id, jira_comment_id=str(comment_id))
            db.add(existing)
        existing.issue_id = issue.id
        existing.body = adf_to_text(raw.get("body")) or raw.get("renderedBody")
        existing.author_id = author.id if author else None
        existing.created_at = _to_datetime(raw.get("created"))
        existing.updated_at = _to_datetime(raw.get("updated"))
    db.flush()
    # Propagate Jira deletions: drop comments on this issue that are not in
    # the current payload. Comments are returned in full inline (Jira does
    # not paginate the comment field on issue search), so absence is real.
    _delete_missing_children(
        db,
        Comment,
        Comment.jira_comment_id,
        issue_id=issue.id,
        keep_ids=seen_ids,
    )


def _upsert_attachments(db: Session, issue: Issue, attachments: Any) -> None:
    if not isinstance(attachments, list):
        return
    seen_ids: set[str] = set()
    for raw in attachments:
        att_id = raw.get("id")
        if not att_id:
            continue
        seen_ids.add(str(att_id))
        author = _upsert_user(db, raw.get("author"))
        existing = db.execute(
            select(Attachment).where(Attachment.jira_attachment_id == str(att_id))
        ).scalar_one_or_none()
        if existing is None:
            existing = Attachment(issue_id=issue.id, jira_attachment_id=str(att_id))
            db.add(existing)
        existing.issue_id = issue.id
        existing.filename = raw.get("filename")
        existing.mime_type = raw.get("mimeType")
        existing.size_bytes = _to_int(raw.get("size"))
        existing.author_id = author.id if author else None
        existing.content_url = raw.get("content")
        existing.created_at = _to_datetime(raw.get("created"))
        existing.synced_at = datetime.now(timezone.utc)
    db.flush()
    # Attachment field is also returned in full on issue search; absence is
    # real → propagate Jira deletions.
    _delete_missing_children(
        db,
        Attachment,
        Attachment.jira_attachment_id,
        issue_id=issue.id,
        keep_ids=seen_ids,
    )


def _upsert_worklogs(db: Session, issue: Issue, payload: Any) -> None:
    """Upsert worklog rows. The inline `worklog` field caps at 20 entries
    (Jira's `maxResults`); when `total > len(inline)`, fetch the rest via
    `JiraClient.get_issue_worklogs`. Deletion propagation is gated on having
    the complete set — if pagination fails, do NOT delete (avoid losing
    rows we couldn't see)."""
    if not isinstance(payload, dict):
        return
    inline = payload.get("worklogs") or []
    total = payload.get("total")
    full_set_known = True

    if isinstance(total, int) and total > len(inline):
        try:
            settings = get_jira_settings()
            with JiraClient(settings) as client:
                inline = client.get_issue_worklogs(issue.jira_key)
        except Exception:
            logger.exception(
                "worklog pagination failed for %s — falling back to inline %d/%d",
                issue.jira_key,
                len(inline),
                total,
            )
            full_set_known = False

    seen_ids: set[str] = set()
    for raw in inline:
        wl_id = raw.get("id")
        if not wl_id:
            continue
        seen_ids.add(str(wl_id))
        author = _upsert_user(db, raw.get("author"))
        existing = db.execute(
            select(Worklog).where(Worklog.jira_worklog_id == str(wl_id))
        ).scalar_one_or_none()
        if existing is None:
            existing = Worklog(issue_id=issue.id, jira_worklog_id=str(wl_id))
            db.add(existing)
        existing.issue_id = issue.id
        existing.author_id = author.id if author else None
        existing.started_at = _to_datetime(raw.get("started"))
        existing.time_spent_secs = _to_int(raw.get("timeSpentSeconds")) or 0
        comment = raw.get("comment")
        existing.comment_adf = comment if isinstance(comment, dict) else None
        existing.comment_text = (
            adf_to_text(comment) if isinstance(comment, dict) else (comment or None)
        )
        existing.created_at = _to_datetime(raw.get("created"))
        existing.updated_at = _to_datetime(raw.get("updated"))
        existing.synced_at = datetime.now(timezone.utc)
    db.flush()
    if full_set_known:
        _delete_missing_children(
            db,
            Worklog,
            Worklog.jira_worklog_id,
            issue_id=issue.id,
            keep_ids=seen_ids,
        )


def _delete_missing_children(
    db: Session,
    model: type,
    id_col,
    *,
    issue_id: int,
    keep_ids: set[str],
) -> None:
    """DELETE rows of `model` for `issue_id` whose external id is NOT in `keep_ids`.

    If `keep_ids` is empty, deletes every row for the issue (the payload had
    no children of this type)."""
    stmt = delete(model).where(model.issue_id == issue_id)
    if keep_ids:
        stmt = stmt.where(~id_col.in_(keep_ids))
    db.execute(stmt)
    db.flush()


def _replace_changelog(db: Session, issue: Issue, changelog: Any) -> None:
    if not isinstance(changelog, dict):
        return
    histories = changelog.get("histories") or []
    db.execute(delete(Changelog).where(Changelog.issue_id == issue.id))
    for history in histories:
        when = _to_datetime(history.get("created"))
        if when is None:
            continue
        author = _upsert_user(db, history.get("author"))
        author_id = author.id if author else None
        for item in history.get("items") or []:
            db.add(
                Changelog(
                    issue_id=issue.id,
                    field=item.get("field"),
                    from_value=item.get("fromString") or item.get("from"),
                    to_value=item.get("toString") or item.get("to"),
                    changed_at=when,
                    changed_by=author_id,
                )
            )
    db.flush()


# ---------- issue metrics ----------


_DONE_STATUSES = ("done", "closed", "resolved", "completed", "deployed")
_IN_PROGRESS_STATUSES = ("in progress", "in review", "in development", "doing")


def _is_done(value: str | None) -> bool:
    return (value or "").strip().lower() in _DONE_STATUSES


def _is_in_progress(value: str | None) -> bool:
    return (value or "").strip().lower() in _IN_PROGRESS_STATUSES


def _upsert_issue_metrics(db: Session, issue: Issue) -> None:
    """Compute cycle_time / lead_time / reopen_count / comment_count from the
    issue's already-persisted children and upsert into `issue_metrics`.

    - cycle_time_hours: hours from the first transition INTO an in-progress
      status to the first subsequent transition INTO a done status.
    - lead_time_hours: hours from `issues.created_at` to `issues.resolved_at`,
      or to the first transition into a done status if `resolved_at` is unset.
    - reopen_count: number of changelog status events going from done back
      to non-done.
    - comment_count: count of `comments` rows for this issue.

    All four are NULL/0 if the underlying data is absent — never raises.
    """
    status_history = (
        db.execute(
            select(Changelog)
            .where(Changelog.issue_id == issue.id, Changelog.field == "status")
            .order_by(Changelog.changed_at)
        )
        .scalars()
        .all()
    )

    cycle_start: datetime | None = None
    cycle_end: datetime | None = None
    first_done: datetime | None = None
    reopen_count = 0
    for row in status_history:
        if cycle_start is None and _is_in_progress(row.to_value):
            cycle_start = row.changed_at
        if (
            cycle_end is None
            and cycle_start is not None
            and _is_done(row.to_value)
            and row.changed_at >= cycle_start
        ):
            cycle_end = row.changed_at
        if first_done is None and _is_done(row.to_value):
            first_done = row.changed_at
        if _is_done(row.from_value) and not _is_done(row.to_value):
            reopen_count += 1

    cycle_time_hours: Decimal | None = None
    if cycle_start is not None and cycle_end is not None:
        cycle_time_hours = Decimal((cycle_end - cycle_start).total_seconds()) / Decimal(3600)

    lead_end = issue.resolved_at or first_done
    lead_time_hours: Decimal | None = None
    if issue.created_at is not None and lead_end is not None:
        lead_time_hours = Decimal((lead_end - issue.created_at).total_seconds()) / Decimal(3600)

    comment_count = int(
        db.execute(
            select(func.count())
            .select_from(Comment)
            .where(Comment.issue_id == issue.id)
        ).scalar_one()
    )

    metrics = db.execute(
        select(IssueMetrics).where(IssueMetrics.issue_id == issue.id)
    ).scalar_one_or_none()
    if metrics is None:
        metrics = IssueMetrics(issue_id=issue.id)
        db.add(metrics)
    metrics.cycle_time_hours = cycle_time_hours
    metrics.lead_time_hours = lead_time_hours
    metrics.reopen_count = reopen_count
    metrics.comment_count = comment_count
    metrics.computed_at = datetime.now(timezone.utc)
    db.flush()


# ---------- field coercion helpers ----------


def _named(payload: Any) -> str | None:
    if isinstance(payload, dict):
        return payload.get("name")
    return None


def _parent_epic_key(fields: dict[str, Any]) -> str | None:
    parent = fields.get("parent")
    if isinstance(parent, dict):
        parent_fields = parent.get("fields") or {}
        issue_type = parent_fields.get("issuetype") or {}
        if issue_type.get("name", "").lower() == "epic":
            return parent.get("key")
    return None


def _customer_names(payload: Any) -> list[str] | None:
    if not payload:
        return None
    items = payload if isinstance(payload, list) else [payload]
    names: list[str] = []
    for item in items:
        if isinstance(item, dict):
            name = item.get("value") or item.get("name")
            if name:
                names.append(name)
        elif isinstance(item, str):
            names.append(item)
    return names or None


def _yes_no(payload: Any) -> bool | None:
    if payload is None:
        return None
    if isinstance(payload, bool):
        return payload
    if isinstance(payload, dict):
        value = payload.get("value")
    else:
        value = payload
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"yes", "true", "1"}:
        return True
    if text in {"no", "false", "0"}:
        return False
    return None


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _to_date(value: Any):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _to_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    # Normalize Jira's compact ±HHMM offset to ±HH:MM that Python 3.10's
    # fromisoformat accepts. Without this, every timestamp from Jira lands NULL.
    if len(text) >= 5 and text[-5] in "+-" and text[-4:].isdigit():
        text = text[:-2] + ":" + text[-2:]
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _rendered_description(jira_issue: dict[str, Any]) -> str | None:
    rendered = jira_issue.get("renderedFields") or {}
    body = rendered.get("description")
    if not body:
        return None
    if isinstance(body, str):
        return body.strip() or None
    return None
