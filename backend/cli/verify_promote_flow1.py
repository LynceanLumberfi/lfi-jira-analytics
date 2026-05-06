"""Verification harness for promote Flow 1 (first-time promote, all actual tables empty).

Each scenario:
  1. Wipes any prior `VERIFY-P1-*` rows across staging + actual tables.
  2. Inserts approved StagingIssue rows directly (we are not re-verifying the
     staging path — that's verify_staging_flow1/2's job).
  3. Calls `promote_approved(db)`.
  4. Asserts the actual tables landed correctly.

Promote and sanitize are decoupled — `promote_approved` no longer fires
sanitize automatically. G3 verifies that promotion does NOT touch
`issue_ai_scores`; sanitize must be triggered explicitly via the
`/api/sanitize` endpoint or `run_sanitize(db)`.

Uses jira_keys prefixed with `VERIFY-P1-`, jira_account_ids `verify-p1-*`,
jira_team_ids `verify-p1-team-*`, sprint IDs in [90001, 90099], and
triggered_by='verify-promote-flow1' for the sync_state row.

Run: ../.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
"""
from __future__ import annotations

import os
import sys
import traceback

# ---- env bootstrap ---------------------------------------------------------

os.environ.setdefault(
    "DATABASE_URL", "postgresql://admin:secret@localhost:5433/jira_analytics"
)
os.environ.setdefault("JIRA_BASE_URL", "https://placeholder.atlassian.net")
os.environ.setdefault("JIRA_EMAIL", "x@x.com")
os.environ.setdefault("JIRA_API_TOKEN", "x")

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from sqlalchemy import select, text  # noqa: E402

from app.config import get_jira_settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Attachment,
    Changelog,
    Comment,
    FailedRecord,
    Issue,
    IssueMetrics,
    IssueSprint,
    Sprint,
    StagingIssue,
    SyncState,
    Team,
    User,
    Worklog,
)
from app.services.staging_service import compute_payload_hash, promote_approved  # noqa: E402


KEY_PREFIX = "VERIFY-P1-"
USER_PREFIX = "verify-p1-"
TEAM_PREFIX = "verify-p1-team-"
TRIGGERED_BY = "verify-promote-flow1"
SPRINT_ID_MIN = 90001
SPRINT_ID_MAX = 90099


# ---- payload builder -------------------------------------------------------


def make_payload(jira_key: str, **field_overrides) -> dict:
    """Build a minimally-valid Jira issue payload. Overrides land in `fields`,
    except `changelog` which is a top-level sibling of `fields`."""
    settings = get_jira_settings()
    changelog = field_overrides.pop("changelog", None)
    fields: dict = {
        "summary": f"summary for {jira_key}",
        "status": {"name": "To Do"},
        "issuetype": {"name": "Story"},
        "assignee": None,
        "reporter": None,
        "priority": None,
        "description": None,
        "labels": [],
        "components": [],
        "fixVersions": [],
        "attachment": [],
        "comment": {"comments": []},
        "worklog": {"worklogs": [], "total": 0, "maxResults": 20},
        "created": "2026-05-01T08:00:00Z",
        "updated": "2026-05-08T10:00:00Z",
    }
    # Custom-field defaults (None) so persist_issue's null path is exercised
    fields[settings.field_team] = None
    fields[settings.field_sprint] = None
    fields[settings.field_customer] = None
    fields[settings.field_reported_by_customer] = None
    fields[settings.field_story_points] = None
    fields[settings.field_epic_link] = None

    fields.update(field_overrides)
    payload = {"key": jira_key, "id": f"id-{jira_key}", "fields": fields}
    if changelog is not None:
        payload["changelog"] = changelog
    return payload


def user_payload(suffix: str, *, name: str | None = None, email: str | None = None) -> dict:
    return {
        "accountId": f"{USER_PREFIX}{suffix}",
        "displayName": name or f"User {suffix}",
        "emailAddress": email,
    }


def team_payload(suffix: str, *, name: str | None = None) -> dict:
    return {"id": f"{TEAM_PREFIX}{suffix}", "name": name or f"Team {suffix}"}


def sprint_payload(jira_id: int, *, name: str | None = None, state: str = "active") -> dict:
    assert SPRINT_ID_MIN <= jira_id <= SPRINT_ID_MAX, f"sprint id {jira_id} outside verify range"
    return {
        "id": jira_id,
        "name": name or f"Sprint {jira_id}",
        "state": state,
        "startDate": "2026-04-01T00:00:00Z" if state != "future" else None,
        "endDate": "2026-04-15T00:00:00Z" if state == "closed" else None,
    }


# ---- DB helpers ------------------------------------------------------------


def make_sync_state() -> int:
    db = SessionLocal()
    try:
        state = SyncState(triggered_by=TRIGGERED_BY, status=SyncState.STATUS_SUCCESS)
        db.add(state)
        db.commit()
        return state.id
    finally:
        db.close()


def stage_approved(jira_key: str, payload: dict, sync_state_id: int) -> int:
    """Insert one approved staging row, returning its id."""
    db = SessionLocal()
    try:
        h = compute_payload_hash(payload, get_jira_settings())
        row = StagingIssue(
            jira_key=jira_key,
            sync_state_id=sync_state_id,
            payload_hash=h,
            change_type=StagingIssue.CHANGE_NEW,
            raw_payload=payload,
            review_status=StagingIssue.STATUS_APPROVED,
        )
        db.add(row)
        db.commit()
        return row.id
    finally:
        db.close()


def run_promote() -> dict:
    db = SessionLocal()
    try:
        return promote_approved(db)
    finally:
        db.close()


def reset_verify_data() -> None:
    """Delete every row owned by this harness, top-down by FK dependency."""
    db = SessionLocal()
    try:
        ids_subq = (
            f"SELECT id FROM issues WHERE jira_key LIKE '{KEY_PREFIX}%'"
        )
        # Children of issues
        db.execute(text(f"DELETE FROM issue_metrics WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM issue_sprints WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM changelogs WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM comments WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM attachments WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM worklogs WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM issue_ai_scores WHERE issue_id IN ({ids_subq})"))
        # Failed records and staging
        db.execute(
            text(
                "DELETE FROM failed_records WHERE jira_ref LIKE :p "
                "OR sync_state_id IN (SELECT id FROM sync_state WHERE triggered_by = :tb)"
            ),
            {"p": f"{KEY_PREFIX}%", "tb": TRIGGERED_BY},
        )
        db.execute(text("DELETE FROM staging_issues WHERE jira_key LIKE :p"), {"p": f"{KEY_PREFIX}%"})
        # Issues themselves
        db.execute(text("DELETE FROM issues WHERE jira_key LIKE :p"), {"p": f"{KEY_PREFIX}%"})
        # Dimensions
        db.execute(text("DELETE FROM users WHERE jira_account_id LIKE :p"), {"p": f"{USER_PREFIX}%"})
        db.execute(text("DELETE FROM teams WHERE jira_team_id LIKE :p"), {"p": f"{TEAM_PREFIX}%"})
        db.execute(
            text("DELETE FROM sprints WHERE jira_sprint_id BETWEEN :lo AND :hi"),
            {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX},
        )
        # Sync_state (cascades to phases via FK)
        db.execute(
            text(
                "DELETE FROM sync_phases WHERE sync_state_id IN "
                "(SELECT id FROM sync_state WHERE triggered_by = :tb)"
            ),
            {"tb": TRIGGERED_BY},
        )
        db.execute(text("DELETE FROM sync_state WHERE triggered_by = :tb"), {"tb": TRIGGERED_BY})
        db.commit()
    finally:
        db.close()


def get_issue(jira_key: str) -> dict | None:
    db = SessionLocal()
    try:
        issue = db.execute(
            select(Issue).where(Issue.jira_key == jira_key)
        ).scalar_one_or_none()
        if issue is None:
            return None
        return {
            "id": issue.id,
            "jira_key": issue.jira_key,
            "project": issue.project,
            "summary": issue.summary,
            "issue_type": issue.issue_type,
            "status": issue.status,
            "assignee_id": issue.assignee_id,
            "reporter_id": issue.reporter_id,
            "team_id": issue.team_id,
            "epic_key": issue.epic_key,
            "story_points": float(issue.story_points) if issue.story_points is not None else None,
            "labels": list(issue.labels) if issue.labels else None,
            "customers": list(issue.customers) if issue.customers else None,
            "reported_by_customer": issue.reported_by_customer,
            "time_estimate_secs": issue.time_estimate_secs,
            "time_spent_secs": issue.time_spent_secs,
        }
    finally:
        db.close()


def staging_row_for(jira_key: str) -> dict | None:
    db = SessionLocal()
    try:
        row = db.execute(
            select(StagingIssue).where(StagingIssue.jira_key == jira_key)
        ).scalar_one_or_none()
        if row is None:
            return None
        return {
            "review_status": row.review_status,
            "promoted_at": row.promoted_at,
            "raw_payload_key": (row.raw_payload or {}).get("key"),
        }
    finally:
        db.close()


def count(model_or_table, where_sql: str, params: dict | None = None) -> int:
    db = SessionLocal()
    try:
        table = model_or_table.__tablename__ if hasattr(model_or_table, "__tablename__") else model_or_table
        result = db.execute(
            text(f"SELECT COUNT(*) FROM {table} WHERE {where_sql}"), params or {}
        ).scalar_one()
        return int(result)
    finally:
        db.close()


# ---- assertion helpers -----------------------------------------------------


def assert_eq(label: str, actual, expected):
    if actual != expected:
        return f"{label}: expected {expected!r}, got {actual!r}"
    return None


def check(name: str, fn) -> bool:
    print(f"\n=== {name} ===")
    reset_verify_data()
    try:
        errors = fn() or []
    except Exception:
        traceback.print_exc()
        errors = ["EXCEPTION raised"]
    if errors:
        for e in errors:
            print(f"  FAIL  {e}")
        return False
    print("  PASS")
    return True


# ---- scenarios -------------------------------------------------------------


def scenario_a1_empty():
    """A1: No approved rows → no-op."""
    result = run_promote()
    return [e for e in [
        assert_eq("promoted", result["promoted"], 0),
        assert_eq("failed", result["failed"], 0),
        assert_eq("no sanitize key in result", "sanitize" not in result, True),
    ] if e]


def scenario_a2_minimal():
    """A2: Single minimal payload → 1 issue, no users/teams/sprints/children."""
    sid = make_sync_state()
    stage_approved(f"{KEY_PREFIX}A2", make_payload(f"{KEY_PREFIX}A2"), sid)
    result = run_promote()
    issue = get_issue(f"{KEY_PREFIX}A2")
    errs = []
    for e in [
        assert_eq("promoted", result["promoted"], 1),
        assert_eq("failed", result["failed"], 0),
        assert_eq("issue exists", issue is not None, True),
    ]:
        if e:
            errs.append(e)
    if issue is None:
        return errs
    for e in [
        assert_eq("issue.summary", issue["summary"], f"summary for {KEY_PREFIX}A2"),
        assert_eq("issue.status", issue["status"], "To Do"),
        assert_eq("issue.issue_type", issue["issue_type"], "Story"),
        assert_eq("issue.project", issue["project"], "VERIFY"),
        assert_eq("issue.assignee_id", issue["assignee_id"], None),
        assert_eq("issue.reporter_id", issue["reporter_id"], None),
        assert_eq("issue.team_id", issue["team_id"], None),
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 0),
        assert_eq("team count", count(Team, "jira_team_id LIKE :p", {"p": f"{TEAM_PREFIX}%"}), 0),
        assert_eq("sprint count", count(Sprint, "jira_sprint_id BETWEEN :lo AND :hi", {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX}), 0),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_b1_distinct_users():
    """B1: Distinct assignee + reporter → 2 user rows, both FKs wired."""
    sid = make_sync_state()
    payload = make_payload(
        f"{KEY_PREFIX}B1",
        assignee=user_payload("alice"),
        reporter=user_payload("bob"),
    )
    stage_approved(f"{KEY_PREFIX}B1", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}B1")
    errs = [assert_eq("issue exists", issue is not None, True)]
    if issue is None:
        return [e for e in errs if e]
    user_count = count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"})
    errs += [
        assert_eq("user count", user_count, 2),
        assert_eq("assignee_id is set", issue["assignee_id"] is not None, True),
        assert_eq("reporter_id is set", issue["reporter_id"] is not None, True),
    ]
    if issue["assignee_id"] == issue["reporter_id"]:
        errs.append("assignee_id and reporter_id must differ")
    return [e for e in errs if e]


def scenario_b2_same_user_both_roles():
    """B2: Same person as assignee AND reporter → 1 user row."""
    sid = make_sync_state()
    payload = make_payload(
        f"{KEY_PREFIX}B2",
        assignee=user_payload("solo"),
        reporter=user_payload("solo"),
    )
    stage_approved(f"{KEY_PREFIX}B2", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}B2")
    errs = [
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 1),
        assert_eq("assignee_id == reporter_id", issue["assignee_id"], issue["reporter_id"]),
        assert_eq("assignee_id not null", issue["assignee_id"] is not None, True),
    ]
    return [e for e in errs if e]


def scenario_b3_unassigned():
    """B3: Unassigned issue → no user row, both FKs null."""
    sid = make_sync_state()
    stage_approved(f"{KEY_PREFIX}B3", make_payload(f"{KEY_PREFIX}B3"), sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}B3")
    errs = [
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 0),
        assert_eq("assignee_id", issue["assignee_id"], None),
        assert_eq("reporter_id", issue["reporter_id"], None),
    ]
    return [e for e in errs if e]


def scenario_b4_team():
    """B4: Team field present → team row created, FK wired."""
    sid = make_sync_state()
    settings = get_jira_settings()
    payload = make_payload(
        f"{KEY_PREFIX}B4",
        **{settings.field_team: team_payload("alpha", name="Alpha Squad")},
    )
    stage_approved(f"{KEY_PREFIX}B4", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}B4")
    errs = [
        assert_eq("team count", count(Team, "jira_team_id LIKE :p", {"p": f"{TEAM_PREFIX}%"}), 1),
        assert_eq("team_id not null", issue["team_id"] is not None, True),
    ]
    db = SessionLocal()
    try:
        team = db.execute(select(Team).where(Team.id == issue["team_id"])).scalar_one()
        if team.name != "Alpha Squad":
            errs.append(f"team.name expected 'Alpha Squad', got {team.name!r}")
    finally:
        db.close()
    return [e for e in errs if e]


def scenario_b5_sprints():
    """B5: Sprint history (active + closed + future) → 3 sprints + 3 issue_sprint."""
    sid = make_sync_state()
    settings = get_jira_settings()
    payload = make_payload(
        f"{KEY_PREFIX}B5",
        **{settings.field_sprint: [
            sprint_payload(SPRINT_ID_MIN + 0, state="closed"),
            sprint_payload(SPRINT_ID_MIN + 1, state="active"),
            sprint_payload(SPRINT_ID_MIN + 2, state="future"),
        ]},
    )
    stage_approved(f"{KEY_PREFIX}B5", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}B5")
    errs = [
        assert_eq("sprint count", count(Sprint, "jira_sprint_id BETWEEN :lo AND :hi", {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX}), 3),
        assert_eq("issue_sprint count", count(IssueSprint, "issue_id = :i", {"i": issue["id"]}), 3),
    ]
    return [e for e in errs if e]


def scenario_b6_customers():
    """B6: Customers (multi-value) → stored as ARRAY on issues."""
    sid = make_sync_state()
    settings = get_jira_settings()
    payload = make_payload(
        f"{KEY_PREFIX}B6",
        **{
            settings.field_customer: [{"value": "Acme"}, {"value": "Globex"}],
            settings.field_reported_by_customer: {"value": "Yes"},
        },
    )
    stage_approved(f"{KEY_PREFIX}B6", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}B6")
    errs = [
        assert_eq("customers", issue["customers"], ["Acme", "Globex"]),
        assert_eq("reported_by_customer", issue["reported_by_customer"], True),
    ]
    return [e for e in errs if e]


def scenario_c1_comments_assignee_author():
    """C1: 2 comments by the assignee → 2 comment rows, no extra users."""
    sid = make_sync_state()
    author = user_payload("commenter")
    payload = make_payload(
        f"{KEY_PREFIX}C1",
        assignee=author,
        comment={"comments": [
            {"id": f"{KEY_PREFIX}CMT-1", "author": author, "body": "first comment", "created": "2026-05-08T09:00:00Z"},
            {"id": f"{KEY_PREFIX}CMT-2", "author": author, "body": "second comment", "created": "2026-05-08T09:30:00Z"},
        ]},
    )
    stage_approved(f"{KEY_PREFIX}C1", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}C1")
    errs = [
        assert_eq("comment count", count(Comment, "issue_id = :i", {"i": issue["id"]}), 2),
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 1),
    ]
    return [e for e in errs if e]


def scenario_c2_third_party_comment_author():
    """C2: Comment by someone other than assignee/reporter → new user row."""
    sid = make_sync_state()
    payload = make_payload(
        f"{KEY_PREFIX}C2",
        assignee=user_payload("alice"),
        comment={"comments": [
            {"id": f"{KEY_PREFIX}CMT-3", "author": user_payload("guest"), "body": "from guest", "created": "2026-05-08T10:00:00Z"},
        ]},
    )
    stage_approved(f"{KEY_PREFIX}C2", payload, sid)
    run_promote()
    return [e for e in [
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 2),
    ] if e]


def scenario_c3_attachments():
    """C3: Attachments → N attachment rows."""
    sid = make_sync_state()
    payload = make_payload(
        f"{KEY_PREFIX}C3",
        attachment=[
            {"id": f"{KEY_PREFIX}ATT-1", "filename": "diagram.png", "mimeType": "image/png", "size": 1234},
            {"id": f"{KEY_PREFIX}ATT-2", "filename": "spec.pdf", "mimeType": "application/pdf", "size": 9999},
        ],
    )
    stage_approved(f"{KEY_PREFIX}C3", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}C3")
    return [e for e in [
        assert_eq("attachment count", count(Attachment, "issue_id = :i", {"i": issue["id"]}), 2),
    ] if e]


def scenario_c4_worklogs():
    """C4: Worklogs → N worklog rows + author user."""
    sid = make_sync_state()
    author = user_payload("worker")
    payload = make_payload(
        f"{KEY_PREFIX}C4",
        aggregatetimespent=5400,
        worklog={
            "total": 2,
            "maxResults": 20,
            "worklogs": [
                {"id": f"{KEY_PREFIX}WL-1", "author": author, "started": "2026-05-08T09:00:00Z",
                 "timeSpentSeconds": 3600, "comment": "did work", "created": "2026-05-08T10:00:00Z"},
                {"id": f"{KEY_PREFIX}WL-2", "author": author, "started": "2026-05-08T13:00:00Z",
                 "timeSpentSeconds": 1800, "comment": "more work", "created": "2026-05-08T14:00:00Z"},
            ],
        },
    )
    stage_approved(f"{KEY_PREFIX}C4", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}C4")
    return [e for e in [
        assert_eq("worklog count", count(Worklog, "issue_id = :i", {"i": issue["id"]}), 2),
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 1),
        assert_eq("issue.time_spent_secs", issue["time_spent_secs"], 5400),
    ] if e]


def scenario_c5_changelog():
    """C5: Changelog (status transitions) → N changelog rows."""
    sid = make_sync_state()
    actor = user_payload("actor")
    payload = make_payload(
        f"{KEY_PREFIX}C5",
        changelog={
            "histories": [
                {
                    "id": "h1",
                    "author": actor,
                    "created": "2026-05-02T10:00:00Z",
                    "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}],
                },
                {
                    "id": "h2",
                    "author": actor,
                    "created": "2026-05-05T15:00:00Z",
                    "items": [{"field": "status", "fromString": "In Progress", "toString": "Done"}],
                },
            ],
        },
    )
    stage_approved(f"{KEY_PREFIX}C5", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}C5")
    return [e for e in [
        assert_eq("changelog count", count(Changelog, "issue_id = :i", {"i": issue["id"]}), 2),
    ] if e]


def scenario_c6_kitchen_sink():
    """C6: One issue with comments + attachments + worklogs + changelog + sprints — all wired."""
    sid = make_sync_state()
    settings = get_jira_settings()
    author = user_payload("kitchen-sink")
    payload = make_payload(
        f"{KEY_PREFIX}C6",
        assignee=author,
        reporter=author,
        story_points=None,
        **{
            settings.field_team: team_payload("ks", name="KS Team"),
            settings.field_sprint: [sprint_payload(SPRINT_ID_MIN + 10, state="active")],
            settings.field_story_points: 5.0,
        },
        comment={"comments": [
            {"id": f"{KEY_PREFIX}CMT-K1", "author": author, "body": "kitchen sink", "created": "2026-05-08T09:00:00Z"},
        ]},
        attachment=[{"id": f"{KEY_PREFIX}ATT-K1", "filename": "k.png", "mimeType": "image/png", "size": 100}],
        worklog={"total": 1, "maxResults": 20, "worklogs": [
            {"id": f"{KEY_PREFIX}WL-K1", "author": author, "timeSpentSeconds": 600, "started": "2026-05-08T09:00:00Z", "created": "2026-05-08T09:10:00Z"},
        ]},
        changelog={"histories": [
            {"id": "h-k1", "author": author, "created": "2026-05-04T10:00:00Z",
             "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
        ]},
    )
    stage_approved(f"{KEY_PREFIX}C6", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}C6")
    iid = issue["id"]
    errs = [
        assert_eq("issue exists", issue is not None, True),
        assert_eq("team_id not null", issue["team_id"] is not None, True),
        assert_eq("story_points", issue["story_points"], 5.0),
        assert_eq("comment count", count(Comment, "issue_id = :i", {"i": iid}), 1),
        assert_eq("attachment count", count(Attachment, "issue_id = :i", {"i": iid}), 1),
        assert_eq("worklog count", count(Worklog, "issue_id = :i", {"i": iid}), 1),
        assert_eq("changelog count", count(Changelog, "issue_id = :i", {"i": iid}), 1),
        assert_eq("issue_sprint count", count(IssueSprint, "issue_id = :i", {"i": iid}), 1),
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 1),
        assert_eq("team count", count(Team, "jira_team_id LIKE :p", {"p": f"{TEAM_PREFIX}%"}), 1),
        assert_eq("sprint count", count(Sprint, "jira_sprint_id BETWEEN :lo AND :hi", {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX}), 1),
    ]
    return [e for e in errs if e]


def scenario_d1_shared_assignee():
    """D1: Two issues, same assignee → 1 user row, both issues FK to it."""
    sid = make_sync_state()
    shared = user_payload("shared")
    stage_approved(f"{KEY_PREFIX}D1a", make_payload(f"{KEY_PREFIX}D1a", assignee=shared), sid)
    stage_approved(f"{KEY_PREFIX}D1b", make_payload(f"{KEY_PREFIX}D1b", assignee=shared), sid)
    result = run_promote()
    a = get_issue(f"{KEY_PREFIX}D1a")
    b = get_issue(f"{KEY_PREFIX}D1b")
    errs = [
        assert_eq("promoted", result["promoted"], 2),
        assert_eq("user count", count(User, "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 1),
        assert_eq("a.assignee_id == b.assignee_id", a["assignee_id"], b["assignee_id"]),
        assert_eq("a.assignee_id not null", a["assignee_id"] is not None, True),
    ]
    return [e for e in errs if e]


def scenario_d2_shared_sprint():
    """D2: Two issues, same sprint → 1 sprint row, 2 issue_sprint rows."""
    sid = make_sync_state()
    settings = get_jira_settings()
    sp = [sprint_payload(SPRINT_ID_MIN + 20, state="active")]
    stage_approved(f"{KEY_PREFIX}D2a", make_payload(f"{KEY_PREFIX}D2a", **{settings.field_sprint: sp}), sid)
    stage_approved(f"{KEY_PREFIX}D2b", make_payload(f"{KEY_PREFIX}D2b", **{settings.field_sprint: sp}), sid)
    run_promote()
    return [e for e in [
        assert_eq("sprint count", count(Sprint, "jira_sprint_id BETWEEN :lo AND :hi", {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX}), 1),
        assert_eq("issue_sprint count", count(IssueSprint, "issue_id IN (SELECT id FROM issues WHERE jira_key LIKE :p)", {"p": f"{KEY_PREFIX}D2%"}), 2),
    ] if e]


def scenario_d3_shared_team():
    """D3: Two issues, same team → 1 team row, both issues FK to it."""
    sid = make_sync_state()
    settings = get_jira_settings()
    tp = team_payload("shared", name="Shared")
    stage_approved(f"{KEY_PREFIX}D3a", make_payload(f"{KEY_PREFIX}D3a", **{settings.field_team: tp}), sid)
    stage_approved(f"{KEY_PREFIX}D3b", make_payload(f"{KEY_PREFIX}D3b", **{settings.field_team: tp}), sid)
    run_promote()
    a = get_issue(f"{KEY_PREFIX}D3a")
    b = get_issue(f"{KEY_PREFIX}D3b")
    return [e for e in [
        assert_eq("team count", count(Team, "jira_team_id LIKE :p", {"p": f"{TEAM_PREFIX}%"}), 1),
        assert_eq("a.team_id == b.team_id", a["team_id"], b["team_id"]),
        assert_eq("a.team_id not null", a["team_id"] is not None, True),
    ] if e]


def scenario_e1_epic_key_string():
    """E1: epic_key references a key also in the batch — stored as plain string, no FK."""
    sid = make_sync_state()
    settings = get_jira_settings()
    epic_key = f"{KEY_PREFIX}EPIC"
    stage_approved(epic_key, make_payload(epic_key, issuetype={"name": "Epic"}), sid)
    child_key = f"{KEY_PREFIX}E1-CHILD"
    stage_approved(
        child_key,
        make_payload(child_key, **{settings.field_epic_link: epic_key}),
        sid,
    )
    run_promote()
    child = get_issue(child_key)
    epic = get_issue(epic_key)
    return [e for e in [
        assert_eq("child.epic_key", child["epic_key"], epic_key),
        assert_eq("epic exists", epic is not None, True),
        assert_eq("epic.issue_type", epic["issue_type"], "Epic"),
    ] if e]


def scenario_e2_epic_self():
    """E2: Issue is itself an Epic → just persisted, no special handling."""
    sid = make_sync_state()
    key = f"{KEY_PREFIX}E2"
    stage_approved(key, make_payload(key, issuetype={"name": "Epic"}, summary="An Epic"), sid)
    run_promote()
    issue = get_issue(key)
    return [e for e in [
        assert_eq("issue.issue_type", issue["issue_type"], "Epic"),
        assert_eq("issue.epic_key", issue["epic_key"], None),
    ] if e]


def scenario_f1_failure_isolation():
    """F1: 3 approved, one bad payload (key empty/missing) → 2 promoted, 1 failed.
    failed_records gets a row; staging row flips to 'failed'."""
    sid = make_sync_state()
    stage_approved(f"{KEY_PREFIX}F1a", make_payload(f"{KEY_PREFIX}F1a"), sid)
    # Bad payload: missing 'key' → _upsert_issue raises ValueError
    bad_id = stage_approved(
        f"{KEY_PREFIX}F1bad",
        {"id": "bad", "fields": {"summary": "no key"}},  # no top-level "key"
        sid,
    )
    stage_approved(f"{KEY_PREFIX}F1c", make_payload(f"{KEY_PREFIX}F1c"), sid)

    result = run_promote()
    errs = [
        assert_eq("promoted", result["promoted"], 2),
        assert_eq("failed", result["failed"], 1),
        assert_eq("a issue exists", get_issue(f"{KEY_PREFIX}F1a") is not None, True),
        assert_eq("c issue exists", get_issue(f"{KEY_PREFIX}F1c") is not None, True),
    ]
    # Bad staging row should be marked 'failed'
    db = SessionLocal()
    try:
        bad_row = db.get(StagingIssue, bad_id)
        if bad_row is None:
            errs.append("bad staging row missing")
        else:
            if bad_row.review_status != StagingIssue.STATUS_FAILED:
                errs.append(f"bad row review_status: expected 'failed', got {bad_row.review_status!r}")
            if not bad_row.review_notes or "promote error" not in bad_row.review_notes:
                errs.append(f"bad row review_notes missing 'promote error': {bad_row.review_notes!r}")
        # failed_records row created
        fr = db.execute(
            select(FailedRecord).where(FailedRecord.staging_id == bad_id)
        ).scalars().all()
        if len(fr) != 1:
            errs.append(f"expected 1 failed_records row, got {len(fr)}")
    finally:
        db.close()
    return [e for e in errs if e]


def scenario_f2_failed_not_retried():
    """F2: After F1, calling promote again → 0 promoted (failed row not picked up,
    promoted rows already done)."""
    sid = make_sync_state()
    stage_approved(f"{KEY_PREFIX}F2a", make_payload(f"{KEY_PREFIX}F2a"), sid)
    stage_approved(f"{KEY_PREFIX}F2bad", {"id": "bad", "fields": {"summary": "no key"}}, sid)
    run_promote()  # first run: 1 promoted, 1 failed

    result2 = run_promote()  # second run: 0 approved left
    return [e for e in [
        assert_eq("promoted", result2["promoted"], 0),
        assert_eq("failed", result2["failed"], 0),
    ] if e]


def scenario_g1_staging_bookkeeping():
    """G1: Staging row flips to 'promoted' with promoted_at set; raw_payload preserved."""
    sid = make_sync_state()
    key = f"{KEY_PREFIX}G1"
    stage_approved(key, make_payload(key), sid)
    run_promote()
    row = staging_row_for(key)
    return [e for e in [
        assert_eq("review_status", row["review_status"], "promoted"),
        assert_eq("promoted_at not null", row["promoted_at"] is not None, True),
        assert_eq("raw_payload preserved", row["raw_payload_key"], key),
    ] if e]


def scenario_g3_no_auto_sanitize():
    """G3: Promote does NOT auto-fire sanitize. After promote, no `issue_ai_scores`
    rows exist; the result dict has no `sanitize` key. Sanitize must be triggered
    separately."""
    sid = make_sync_state()
    key = f"{KEY_PREFIX}G3"
    stage_approved(key, make_payload(key), sid)  # default issuetype is Story
    result = run_promote()
    issue = get_issue(key)
    errs = [
        assert_eq("no sanitize key in result", "sanitize" not in result, True),
        assert_eq(
            "issue_ai_scores not auto-created",
            count("issue_ai_scores", "issue_id = :i", {"i": issue["id"]}),
            0,
        ),
    ]
    # Now run sanitize explicitly and confirm it picks up the Story
    from app.services.sanitize_service import run_sanitize
    db = SessionLocal()
    try:
        sanitize_result = run_sanitize(db)
    finally:
        db.close()
    errs += [
        assert_eq("explicit sanitize: stories_marked_pending", sanitize_result["stories_marked_pending"], 1),
        assert_eq(
            "issue_ai_scores after explicit sanitize",
            count("issue_ai_scores", "issue_id = :i", {"i": issue["id"]}),
            1,
        ),
    ]
    return [e for e in errs if e]


def scenario_g4_order_independent():
    """G4: Same outcome regardless of created_at order. Two issues sharing a sprint;
    insert them with reversed created_at to the order in which they were approved.
    Both should still promote, and the shared sprint should resolve to one row."""
    sid = make_sync_state()
    settings = get_jira_settings()
    sp = [sprint_payload(SPRINT_ID_MIN + 30, state="active")]
    # Stage in order A then B; manually predate A's created_at so promote sees B first
    a_id = stage_approved(f"{KEY_PREFIX}G4a", make_payload(f"{KEY_PREFIX}G4a", **{settings.field_sprint: sp}), sid)
    b_id = stage_approved(f"{KEY_PREFIX}G4b", make_payload(f"{KEY_PREFIX}G4b", **{settings.field_sprint: sp}), sid)
    db = SessionLocal()
    try:
        # Make B older than A — promote orders by created_at, so B runs first
        db.execute(text("UPDATE staging_issues SET created_at = '2020-01-01T00:00:00Z' WHERE id = :i"), {"i": b_id})
        db.execute(text("UPDATE staging_issues SET created_at = '2026-01-01T00:00:00Z' WHERE id = :i"), {"i": a_id})
        db.commit()
    finally:
        db.close()

    result = run_promote()
    return [e for e in [
        assert_eq("promoted", result["promoted"], 2),
        assert_eq("sprint count", count(Sprint, "jira_sprint_id BETWEEN :lo AND :hi", {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX}), 1),
        assert_eq("issue_sprint count", count(IssueSprint, "issue_id IN (SELECT id FROM issues WHERE jira_key LIKE :p)", {"p": f"{KEY_PREFIX}G4%"}), 2),
    ] if e]


# ---- Group K: issue_metrics population ------------------------------------


def scenario_k1_metrics_basic():
    """K1: After first promote, an `issue_metrics` row exists for the issue
    with `comment_count` and `reopen_count` set."""
    sid = make_sync_state()
    author = user_payload("k1")
    payload = make_payload(
        f"{KEY_PREFIX}K1",
        comment={"comments": [
            {"id": f"{KEY_PREFIX}CMT-K1-1", "author": author, "body": "x", "created": "2026-05-08T09:00:00Z"},
            {"id": f"{KEY_PREFIX}CMT-K1-2", "author": author, "body": "y", "created": "2026-05-08T10:00:00Z"},
        ]},
    )
    stage_approved(f"{KEY_PREFIX}K1", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}K1")
    db = SessionLocal()
    try:
        m = db.execute(
            text(
                "SELECT comment_count, reopen_count, cycle_time_hours, lead_time_hours "
                "FROM issue_metrics WHERE issue_id = :i"
            ),
            {"i": issue["id"]},
        ).one_or_none()
    finally:
        db.close()
    if m is None:
        return ["issue_metrics row missing"]
    return [e for e in [
        assert_eq("comment_count", m[0], 2),
        assert_eq("reopen_count", m[1], 0),
        assert_eq("cycle_time_hours (no In Progress→Done)", m[2], None),
        assert_eq("lead_time_hours (no resolved/done)", m[3], None),
    ] if e]


def scenario_k2_cycle_lead_time_from_changelog():
    """K2: Changelog has In Progress → Done transition → cycle_time computed.
    Issue has resolved_at → lead_time computed."""
    sid = make_sync_state()
    actor = user_payload("k2")
    payload = make_payload(
        f"{KEY_PREFIX}K2",
        created="2026-05-01T08:00:00Z",
        resolutiondate="2026-05-05T14:00:00Z",
        changelog={"histories": [
            {"id": "h1", "author": actor, "created": "2026-05-02T08:00:00Z",
             "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
            {"id": "h2", "author": actor, "created": "2026-05-05T14:00:00Z",
             "items": [{"field": "status", "fromString": "In Progress", "toString": "Done"}]},
        ]},
    )
    stage_approved(f"{KEY_PREFIX}K2", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}K2")
    db = SessionLocal()
    try:
        m = db.execute(
            text(
                "SELECT cycle_time_hours, lead_time_hours, reopen_count "
                "FROM issue_metrics WHERE issue_id = :i"
            ),
            {"i": issue["id"]},
        ).one()
    finally:
        db.close()
    cycle_h, lead_h, reopens = m
    errs = []
    # cycle: 2026-05-02 08:00 → 2026-05-05 14:00 = 78h
    if cycle_h is None or abs(float(cycle_h) - 78.0) > 0.01:
        errs.append(f"cycle_time_hours expected ~78.0, got {cycle_h}")
    # lead: 2026-05-01 08:00 → 2026-05-05 14:00 = 102h
    if lead_h is None or abs(float(lead_h) - 102.0) > 0.01:
        errs.append(f"lead_time_hours expected ~102.0, got {lead_h}")
    if reopens != 0:
        errs.append(f"reopen_count expected 0, got {reopens}")
    return errs


def scenario_k3_reopen_count():
    """K3: Status went Done → In Progress → Done — reopen_count = 1."""
    sid = make_sync_state()
    actor = user_payload("k3")
    payload = make_payload(
        f"{KEY_PREFIX}K3",
        changelog={"histories": [
            {"id": "h1", "author": actor, "created": "2026-05-01T10:00:00Z",
             "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
            {"id": "h2", "author": actor, "created": "2026-05-02T10:00:00Z",
             "items": [{"field": "status", "fromString": "In Progress", "toString": "Done"}]},
            {"id": "h3", "author": actor, "created": "2026-05-03T10:00:00Z",
             "items": [{"field": "status", "fromString": "Done", "toString": "In Progress"}]},
            {"id": "h4", "author": actor, "created": "2026-05-04T10:00:00Z",
             "items": [{"field": "status", "fromString": "In Progress", "toString": "Done"}]},
        ]},
    )
    stage_approved(f"{KEY_PREFIX}K3", payload, sid)
    run_promote()
    issue = get_issue(f"{KEY_PREFIX}K3")
    db = SessionLocal()
    try:
        reopens = db.execute(
            text("SELECT reopen_count FROM issue_metrics WHERE issue_id = :i"),
            {"i": issue["id"]},
        ).scalar_one()
    finally:
        db.close()
    return [assert_eq("reopen_count", reopens, 1)] if reopens != 1 else []


# ---- Group P: promote phase tracking + batch limit ------------------------


def scenario_p1_phase_row_recorded():
    """P1: When sync_state_id is provided, a `promoting` phase row is created
    with status='success', items_total=N, items_processed=N, metrics populated."""
    from app.services.staging_service import promote_approved

    sid = make_sync_state()
    stage_approved(f"{KEY_PREFIX}P1a", make_payload(f"{KEY_PREFIX}P1a"), sid)
    stage_approved(f"{KEY_PREFIX}P1b", make_payload(f"{KEY_PREFIX}P1b"), sid)

    db = SessionLocal()
    try:
        promote_approved(db, sync_state_id=sid)
    finally:
        db.close()

    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                "SELECT phase, status, items_total, items_processed, metrics "
                "FROM sync_phases WHERE sync_state_id = :s AND phase = 'promoting'"
            ),
            {"s": sid},
        ).all()
    finally:
        db.close()
    if len(rows) != 1:
        return [f"expected 1 promoting phase row, got {len(rows)}"]
    phase, status, total, processed, metrics = rows[0]
    return [e for e in [
        assert_eq("phase", phase, "promoting"),
        assert_eq("status", status, "success"),
        assert_eq("items_total", total, 2),
        assert_eq("items_processed", processed, 2),
        assert_eq("metrics.promoted", (metrics or {}).get("promoted"), 2),
        assert_eq("metrics.failed", (metrics or {}).get("failed"), 0),
    ] if e]


def scenario_p3_extracting_phase_rows_recorded():
    """P3: promote with sync_state_id opens 4 sibling extracting_* phase rows
    (changelogs/comments/worklogs/attachments) tracked alongside `promoting`,
    each closing with metrics.items reflecting the entity counts processed."""
    from app.services.staging_service import promote_approved

    sid = make_sync_state()
    payload = make_payload(
        f"{KEY_PREFIX}P3",
        comment={"comments": [{"id": "c1", "body": "hi"}]},
        attachment=[{"id": "a1", "filename": "n.txt"}],
        worklog={
            "worklogs": [
                {
                    "id": "w1",
                    "started": "2026-01-01T00:00:00.000+0000",
                    "timeSpentSeconds": 60,
                }
            ],
            "total": 1,
            "maxResults": 20,
        },
        changelog={
            "histories": [
                {
                    "id": "1",
                    "created": "2026-01-01T00:00:00.000+0000",
                    "items": [
                        {"field": "status", "fromString": "To Do", "toString": "In Progress"}
                    ],
                }
            ]
        },
    )
    stage_approved(f"{KEY_PREFIX}P3", payload, sid)

    db = SessionLocal()
    try:
        promote_approved(db, sync_state_id=sid)
    finally:
        db.close()

    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                "SELECT phase, status, items_total, items_processed, metrics "
                "FROM sync_phases WHERE sync_state_id = :s "
                "AND phase LIKE 'extracting_%' ORDER BY phase"
            ),
            {"s": sid},
        ).all()
    finally:
        db.close()

    by_phase = {r[0]: r for r in rows}
    expected = {
        "extracting_attachments": 1,
        "extracting_changelogs": 1,
        "extracting_comments": 1,
        "extracting_worklogs": 1,
    }
    errs = [assert_eq("extracting_* phase count", len(rows), 4)] if len(rows) != 4 else []
    for phase_name, expected_items in expected.items():
        row = by_phase.get(phase_name)
        if row is None:
            errs.append(f"missing phase row {phase_name}")
            continue
        _phase, status, total, processed, metrics = row
        errs.extend(e for e in [
            assert_eq(f"{phase_name} status", status, "success"),
            assert_eq(f"{phase_name} items_total", total, 1),
            assert_eq(f"{phase_name} items_processed", processed, 1),
            assert_eq(f"{phase_name} metrics.items", (metrics or {}).get("items"), expected_items),
        ] if e)
    return errs


def scenario_p2_batch_limit_honored():
    """P2: limit=2 → only 2 of 5 approved rows promoted, others remain `approved`."""
    from app.services.staging_service import promote_approved

    sid = make_sync_state()
    for n in range(5):
        stage_approved(f"{KEY_PREFIX}P2-{n}", make_payload(f"{KEY_PREFIX}P2-{n}"), sid)

    db = SessionLocal()
    try:
        result = promote_approved(db, limit=2)
    finally:
        db.close()
    return [e for e in [
        assert_eq("promoted", result["promoted"], 2),
        assert_eq("issues created", count(Issue, "jira_key LIKE :p", {"p": f"{KEY_PREFIX}P2%"}), 2),
        assert_eq(
            "remaining approved staging rows",
            count(StagingIssue, "jira_key LIKE :p AND review_status = 'approved'", {"p": f"{KEY_PREFIX}P2%"}),
            3,
        ),
    ] if e]


# ---- main ------------------------------------------------------------------


def main():
    scenarios = [
        ("A1: no approved rows", scenario_a1_empty),
        ("A2: minimal payload, single issue", scenario_a2_minimal),
        ("B1: distinct assignee + reporter", scenario_b1_distinct_users),
        ("B2: same person both roles", scenario_b2_same_user_both_roles),
        ("B3: unassigned issue", scenario_b3_unassigned),
        ("B4: team field", scenario_b4_team),
        ("B5: sprint history (3 sprints)", scenario_b5_sprints),
        ("B6: customers + reported_by_customer", scenario_b6_customers),
        ("C1: comments by assignee author", scenario_c1_comments_assignee_author),
        ("C2: third-party comment author", scenario_c2_third_party_comment_author),
        ("C3: attachments", scenario_c3_attachments),
        ("C4: worklogs", scenario_c4_worklogs),
        ("C5: changelog", scenario_c5_changelog),
        ("C6: kitchen sink", scenario_c6_kitchen_sink),
        ("D1: shared assignee across issues", scenario_d1_shared_assignee),
        ("D2: shared sprint across issues", scenario_d2_shared_sprint),
        ("D3: shared team across issues", scenario_d3_shared_team),
        ("E1: epic_key references in-batch issue (string only)", scenario_e1_epic_key_string),
        ("E2: issue is itself an Epic", scenario_e2_epic_self),
        ("F1: per-row failure isolation", scenario_f1_failure_isolation),
        ("F2: failed row not retried", scenario_f2_failed_not_retried),
        ("G1: staging bookkeeping (promoted, promoted_at, payload preserved)", scenario_g1_staging_bookkeeping),
        ("G3: promote does NOT auto-fire sanitize (decoupled)", scenario_g3_no_auto_sanitize),
        ("G4: order-independent promote", scenario_g4_order_independent),
        ("K1: issue_metrics row exists with comment_count + reopen_count", scenario_k1_metrics_basic),
        ("K2: cycle_time + lead_time computed from changelog and resolved_at", scenario_k2_cycle_lead_time_from_changelog),
        ("K3: reopen_count counts done→non-done transitions", scenario_k3_reopen_count),
        ("P1: promote with sync_state_id records a `promoting` phase row", scenario_p1_phase_row_recorded),
        ("P2: promote limit=N honored, remaining rows stay approved", scenario_p2_batch_limit_honored),
        ("P3: promote opens 4 sibling extracting_* phase rows", scenario_p3_extracting_phase_rows_recorded),
    ]

    passed: list[str] = []
    failed: list[str] = []
    for name, fn in scenarios:
        if check(name, fn):
            passed.append(name)
        else:
            failed.append(name)

    reset_verify_data()

    print(f"\n{'=' * 60}")
    print(f"Summary: {len(passed)} passed, {len(failed)} failed")
    for n in failed:
        print(f"  FAIL  {n}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
