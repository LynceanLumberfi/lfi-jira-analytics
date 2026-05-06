"""Verification harness for promote Flow 2 (re-promote with existing data).

Each scenario:
  1. Wipes any prior `VERIFY-P2-*` rows.
  2. Stages an approved row with payload v1, calls `promote_approved` →
     `issues` and friends are populated. Then stages v2 (the active-row
     invariant lets this happen because v1's staging row is now terminal
     `promoted`), calls `promote_approved` again. Asserts the *combined*
     state of the actual tables.
  3. Wraps up by checking the staging-side audit trail.

Uses jira_keys prefixed `VERIFY-P2-`, jira_account_ids `verify-p2-*`,
jira_team_ids `verify-p2-team-*`, sprint IDs in [91001, 91099], and
`triggered_by='verify-promote-flow2'`.

Run: ../.jira-analytics/bin/python backend/cli/verify_promote_flow2.py
"""
from __future__ import annotations

import os
import sys
import time
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
    Issue,
    IssueSprint,
    Sprint,
    StagingIssue,
    SyncState,
    Team,
    User,
    Worklog,
)
from app.services.staging_service import compute_payload_hash, promote_approved  # noqa: E402


KEY_PREFIX = "VERIFY-P2-"
USER_PREFIX = "verify-p2-"
TEAM_PREFIX = "verify-p2-team-"
TRIGGERED_BY = "verify-promote-flow2"
SPRINT_ID_MIN = 91001
SPRINT_ID_MAX = 91099


# ---- payload builder -------------------------------------------------------


def make_payload(jira_key: str, **field_overrides) -> dict:
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


def two_promotes(jira_key: str, payload_v1: dict, payload_v2: dict) -> tuple[int, int, int, int]:
    """Stage v1 (under sync_state_1) → promote → stage v2 (under sync_state_2) → promote.

    Two distinct sync states because the unique index `idx_staging_sync_key`
    is on `(sync_state_id, jira_key)` — staging two rows for the same key
    under one sync would collide. In production, each sync gets its own
    `sync_state` row anyway.

    Returns (sync_state_1, sync_state_2, sid_v1, sid_v2)."""
    sync_id_1 = make_sync_state()
    sid_v1 = stage_approved(jira_key, payload_v1, sync_id_1)
    run_promote()
    time.sleep(0.01)  # so synced_at can advance between promotes
    sync_id_2 = make_sync_state()
    sid_v2 = stage_approved(jira_key, payload_v2, sync_id_2)
    run_promote()
    return sync_id_1, sync_id_2, sid_v1, sid_v2


def reset_verify_data() -> None:
    db = SessionLocal()
    try:
        ids_subq = f"SELECT id FROM issues WHERE jira_key LIKE '{KEY_PREFIX}%'"
        db.execute(text(f"DELETE FROM issue_metrics WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM issue_sprints WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM changelogs WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM comments WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM attachments WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM worklogs WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM issue_ai_scores WHERE issue_id IN ({ids_subq})"))
        db.execute(
            text(
                "DELETE FROM failed_records WHERE jira_ref LIKE :p "
                "OR sync_state_id IN (SELECT id FROM sync_state WHERE triggered_by = :tb)"
            ),
            {"p": f"{KEY_PREFIX}%", "tb": TRIGGERED_BY},
        )
        db.execute(text("DELETE FROM staging_issues WHERE jira_key LIKE :p"), {"p": f"{KEY_PREFIX}%"})
        db.execute(text("DELETE FROM issues WHERE jira_key LIKE :p"), {"p": f"{KEY_PREFIX}%"})
        db.execute(text("DELETE FROM users WHERE jira_account_id LIKE :p"), {"p": f"{USER_PREFIX}%"})
        db.execute(text("DELETE FROM teams WHERE jira_team_id LIKE :p"), {"p": f"{TEAM_PREFIX}%"})
        db.execute(
            text("DELETE FROM sprints WHERE jira_sprint_id BETWEEN :lo AND :hi"),
            {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX},
        )
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
            "summary": issue.summary,
            "status": issue.status,
            "priority": issue.priority,
            "assignee_id": issue.assignee_id,
            "reporter_id": issue.reporter_id,
            "team_id": issue.team_id,
            "story_points": float(issue.story_points) if issue.story_points is not None else None,
            "labels": list(issue.labels) if issue.labels else None,
            "synced_at": issue.synced_at,
        }
    finally:
        db.close()


def staging_rows_for(jira_key: str) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.execute(
                select(StagingIssue)
                .where(StagingIssue.jira_key == jira_key)
                .order_by(StagingIssue.id)
            )
            .scalars()
            .all()
        )
        return [
            {
                "id": r.id,
                "review_status": r.review_status,
                "promoted_at": r.promoted_at,
                "raw_payload_summary": (r.raw_payload or {}).get("fields", {}).get("summary"),
            }
            for r in rows
        ]
    finally:
        db.close()


def count(table: str, where_sql: str, params: dict | None = None) -> int:
    db = SessionLocal()
    try:
        return int(
            db.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE {where_sql}"), params or {}
            ).scalar_one()
        )
    finally:
        db.close()


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


def scenario_a1_idempotent_repromote():
    """A1: Re-promote identical content → 1 issues row, fields unchanged,
    `synced_at` advances, both staging rows are `promoted`."""
    key = f"{KEY_PREFIX}A1"
    p = make_payload(key, summary="stable")
    two_promotes(key, p, p)
    issue = get_issue(key)
    rows = staging_rows_for(key)
    errs = [
        assert_eq("issues count", count("issues", "jira_key LIKE :p", {"p": f"{KEY_PREFIX}A1%"}), 1),
        assert_eq("issue.summary", issue["summary"], "stable"),
        assert_eq("staging row count", len(rows), 2),
        assert_eq("both staging rows promoted",
                  all(r["review_status"] == "promoted" for r in rows), True),
        assert_eq("both promoted_at set",
                  all(r["promoted_at"] is not None for r in rows), True),
    ]
    return [e for e in errs if e]


def scenario_b1_summary_status_update():
    """B1: Summary + status change between promotes → issue row updated."""
    key = f"{KEY_PREFIX}B1"
    v1 = make_payload(key, summary="A", status={"name": "To Do"})
    v2 = make_payload(key, summary="B", status={"name": "In Progress"})
    two_promotes(key, v1, v2)
    issue = get_issue(key)
    return [e for e in [
        assert_eq("issue.summary", issue["summary"], "B"),
        assert_eq("issue.status", issue["status"], "In Progress"),
        assert_eq("issues count", count("issues", "jira_key = :k", {"k": key}), 1),
    ] if e]


def scenario_b2_priority_storypoints_labels():
    """B2: Priority / story_points / labels change → all reflected on the same issue row."""
    key = f"{KEY_PREFIX}B2"
    settings = get_jira_settings()
    v1 = make_payload(
        key,
        priority=None,
        labels=["alpha"],
        **{settings.field_story_points: None},
    )
    v2 = make_payload(
        key,
        priority={"name": "High"},
        labels=["alpha", "beta"],
        **{settings.field_story_points: 5.0},
    )
    two_promotes(key, v1, v2)
    issue = get_issue(key)
    return [e for e in [
        assert_eq("issue.priority", issue["priority"], "High"),
        assert_eq("issue.story_points", issue["story_points"], 5.0),
        assert_eq("issue.labels", issue["labels"], ["alpha", "beta"]),
    ] if e]


def scenario_c1_assignee_swap():
    """C1: Assignee Alice → Bob (Bob is new) → user count = 2; FK now points to Bob."""
    key = f"{KEY_PREFIX}C1"
    v1 = make_payload(key, assignee=user_payload("alice"))
    v2 = make_payload(key, assignee=user_payload("bob"))
    two_promotes(key, v1, v2)
    issue = get_issue(key)
    db = SessionLocal()
    try:
        bob = db.execute(
            select(User).where(User.jira_account_id == f"{USER_PREFIX}bob")
        ).scalar_one_or_none()
        alice = db.execute(
            select(User).where(User.jira_account_id == f"{USER_PREFIX}alice")
        ).scalar_one_or_none()
    finally:
        db.close()
    errs = [
        assert_eq("user count", count("users", "jira_account_id LIKE :p", {"p": f"{USER_PREFIX}%"}), 2),
        assert_eq("alice still exists (no orphaning)", alice is not None, True),
        assert_eq("bob exists", bob is not None, True),
        assert_eq("issue.assignee_id == bob.id", issue["assignee_id"], bob.id if bob else None),
    ]
    return [e for e in errs if e]


def scenario_c2_assignee_cleared():
    """C2: Assignee Alice → None → issue.assignee_id NULL; Alice user row stays."""
    key = f"{KEY_PREFIX}C2"
    v1 = make_payload(key, assignee=user_payload("alice"))
    v2 = make_payload(key, assignee=None)
    two_promotes(key, v1, v2)
    issue = get_issue(key)
    return [e for e in [
        assert_eq("issue.assignee_id", issue["assignee_id"], None),
        assert_eq("alice user row stays",
                  count("users", "jira_account_id = :k", {"k": f"{USER_PREFIX}alice"}), 1),
    ] if e]


def scenario_c3_team_swap():
    """C3: Team A → Team B → both teams in DB, issue FK points to B."""
    key = f"{KEY_PREFIX}C3"
    settings = get_jira_settings()
    v1 = make_payload(key, **{settings.field_team: team_payload("alpha", name="Alpha")})
    v2 = make_payload(key, **{settings.field_team: team_payload("beta", name="Beta")})
    two_promotes(key, v1, v2)
    issue = get_issue(key)
    db = SessionLocal()
    try:
        beta = db.execute(
            select(Team).where(Team.jira_team_id == f"{TEAM_PREFIX}beta")
        ).scalar_one_or_none()
    finally:
        db.close()
    return [e for e in [
        assert_eq("team count", count("teams", "jira_team_id LIKE :p", {"p": f"{TEAM_PREFIX}%"}), 2),
        assert_eq("issue.team_id == beta.id", issue["team_id"], beta.id if beta else None),
    ] if e]


def scenario_d1_sprint_membership_change():
    """D1: Issue in [S1, S2] → re-promote in [S2, S3]. issue_sprints reflects {S2, S3};
    sprints table keeps S1, S2, S3 (no orphan deletion of dimensions)."""
    key = f"{KEY_PREFIX}D1"
    settings = get_jira_settings()
    s1 = sprint_payload(SPRINT_ID_MIN + 0)
    s2 = sprint_payload(SPRINT_ID_MIN + 1)
    s3 = sprint_payload(SPRINT_ID_MIN + 2)
    v1 = make_payload(key, **{settings.field_sprint: [s1, s2]})
    v2 = make_payload(key, **{settings.field_sprint: [s2, s3]})
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    db = SessionLocal()
    try:
        membership_sprint_ids = sorted(
            row[0] for row in db.execute(
                text(
                    "SELECT s.jira_sprint_id FROM issue_sprints isp "
                    "JOIN sprints s ON s.id = isp.sprint_id "
                    "WHERE isp.issue_id = :i"
                ),
                {"i": iid},
            ).all()
        )
    finally:
        db.close()
    return [e for e in [
        assert_eq("issue_sprints membership", membership_sprint_ids,
                  [SPRINT_ID_MIN + 1, SPRINT_ID_MIN + 2]),
        assert_eq("sprints dim count (S1+S2+S3 retained)",
                  count("sprints", "jira_sprint_id BETWEEN :lo AND :hi",
                        {"lo": SPRINT_ID_MIN, "hi": SPRINT_ID_MAX}), 3),
    ] if e]


def scenario_e1_comment_added_in_v2():
    """E1: v1 has 1 comment, v2 has 2 (1 retained + 1 new) → 2 comment rows."""
    key = f"{KEY_PREFIX}E1"
    author = user_payload("commenter")
    c1 = {"id": f"{KEY_PREFIX}CMT-1", "author": author, "body": "first", "created": "2026-05-01T09:00:00Z"}
    c2 = {"id": f"{KEY_PREFIX}CMT-2", "author": author, "body": "second", "created": "2026-05-08T09:00:00Z"}
    v1 = make_payload(key, assignee=author, comment={"comments": [c1]})
    v2 = make_payload(key, assignee=author, comment={"comments": [c1, c2]})
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("comment count", count("comments", "issue_id = :i", {"i": iid}), 2),
    ] if e]


def scenario_e2_attachment_added_in_v2():
    """E2: v1 has 0 attachments, v2 has 1 → 1 attachment row."""
    key = f"{KEY_PREFIX}E2"
    a1 = {"id": f"{KEY_PREFIX}ATT-1", "filename": "spec.pdf", "mimeType": "application/pdf", "size": 99}
    v1 = make_payload(key, attachment=[])
    v2 = make_payload(key, attachment=[a1])
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("attachment count", count("attachments", "issue_id = :i", {"i": iid}), 1),
    ] if e]


def scenario_e3_worklog_added_in_v2():
    """E3: v1 has 1 worklog, v2 has 2 → 2 worklog rows."""
    key = f"{KEY_PREFIX}E3"
    author = user_payload("worker")
    wl1 = {"id": f"{KEY_PREFIX}WL-1", "author": author, "started": "2026-05-01T09:00:00Z",
           "timeSpentSeconds": 3600, "comment": "wl1", "created": "2026-05-01T10:00:00Z"}
    wl2 = {"id": f"{KEY_PREFIX}WL-2", "author": author, "started": "2026-05-08T09:00:00Z",
           "timeSpentSeconds": 1800, "comment": "wl2", "created": "2026-05-08T10:00:00Z"}
    v1 = make_payload(key, aggregatetimespent=3600,
                      worklog={"total": 1, "maxResults": 20, "worklogs": [wl1]})
    v2 = make_payload(key, aggregatetimespent=5400,
                      worklog={"total": 2, "maxResults": 20, "worklogs": [wl1, wl2]})
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("worklog count", count("worklogs", "issue_id = :i", {"i": iid}), 2),
    ] if e]


def scenario_f1_comment_edited():
    """F1: Comment body changed, same `id` between promotes → 1 comment row, body updated."""
    key = f"{KEY_PREFIX}F1"
    author = user_payload("editor")

    def adf(text_str: str) -> dict:
        return {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text_str}]}
            ],
        }

    c_v1 = {"id": f"{KEY_PREFIX}CMT-EDIT", "author": author, "body": adf("original"),
            "created": "2026-05-01T09:00:00Z", "updated": "2026-05-01T09:00:00Z"}
    c_v2 = {"id": f"{KEY_PREFIX}CMT-EDIT", "author": author, "body": adf("edited"),
            "created": "2026-05-01T09:00:00Z", "updated": "2026-05-08T09:00:00Z"}
    v1 = make_payload(key, comment={"comments": [c_v1]})
    v2 = make_payload(key, comment={"comments": [c_v2]})
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    db = SessionLocal()
    try:
        comment = db.execute(
            select(Comment).where(Comment.issue_id == iid)
        ).scalar_one()
    finally:
        db.close()
    return [e for e in [
        assert_eq("comment count", count("comments", "issue_id = :i", {"i": iid}), 1),
        assert_eq("comment.body", comment.body, "edited"),
    ] if e]


def scenario_g1_comment_deletion_propagates():
    """G1: v1 has c1 + c2, v2 has only c1. Deleted comment is removed from DB
    (deletion now propagates via _delete_missing_children)."""
    key = f"{KEY_PREFIX}G1"
    author = user_payload("ghost")
    c1 = {"id": f"{KEY_PREFIX}CMT-G1-1", "author": author, "body": "stays", "created": "2026-05-01T09:00:00Z"}
    c2 = {"id": f"{KEY_PREFIX}CMT-G1-2", "author": author, "body": "deleted in jira", "created": "2026-05-02T09:00:00Z"}
    v1 = make_payload(key, comment={"comments": [c1, c2]})
    v2 = make_payload(key, comment={"comments": [c1]})
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT jira_comment_id FROM comments WHERE issue_id = :i"),
            {"i": iid},
        ).all()
    finally:
        db.close()
    surviving_ids = {r[0] for r in rows}
    return [e for e in [
        assert_eq("comment count (deletion propagated)", len(surviving_ids), 1),
        assert_eq("c1 retained", f"{KEY_PREFIX}CMT-G1-1" in surviving_ids, True),
        assert_eq("c2 deleted", f"{KEY_PREFIX}CMT-G1-2" not in surviving_ids, True),
    ] if e]


def scenario_g2_attachment_deletion_propagates():
    """G2: attachment deleted in Jira → row removed from DB."""
    key = f"{KEY_PREFIX}G2"
    a1 = {"id": f"{KEY_PREFIX}ATT-G2-1", "filename": "kept.png", "mimeType": "image/png", "size": 1}
    a2 = {"id": f"{KEY_PREFIX}ATT-G2-2", "filename": "deleted.png", "mimeType": "image/png", "size": 2}
    v1 = make_payload(key, attachment=[a1, a2])
    v2 = make_payload(key, attachment=[a1])
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT jira_attachment_id FROM attachments WHERE issue_id = :i"),
            {"i": iid},
        ).all()
    finally:
        db.close()
    surviving = {r[0] for r in rows}
    return [e for e in [
        assert_eq("attachment count", len(surviving), 1),
        assert_eq("a1 retained", f"{KEY_PREFIX}ATT-G2-1" in surviving, True),
        assert_eq("a2 deleted", f"{KEY_PREFIX}ATT-G2-2" not in surviving, True),
    ] if e]


def scenario_g3_worklog_deletion_propagates_when_complete_set():
    """G3: worklog deleted in Jira and the inline payload is the complete set
    (total == len(worklogs)) → row removed from DB."""
    key = f"{KEY_PREFIX}G3"
    author = user_payload("logger")
    wl1 = {"id": f"{KEY_PREFIX}WL-G3-1", "author": author, "timeSpentSeconds": 600,
           "started": "2026-05-01T09:00:00Z", "created": "2026-05-01T10:00:00Z"}
    wl2 = {"id": f"{KEY_PREFIX}WL-G3-2", "author": author, "timeSpentSeconds": 1200,
           "started": "2026-05-02T09:00:00Z", "created": "2026-05-02T10:00:00Z"}
    v1 = make_payload(key, aggregatetimespent=1800,
                      worklog={"total": 2, "maxResults": 20, "worklogs": [wl1, wl2]})
    # v2: complete set → only wl1; deletion is safe
    v2 = make_payload(key, aggregatetimespent=600,
                      worklog={"total": 1, "maxResults": 20, "worklogs": [wl1]})
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT jira_worklog_id FROM worklogs WHERE issue_id = :i"),
            {"i": iid},
        ).all()
    finally:
        db.close()
    surviving = {r[0] for r in rows}
    return [e for e in [
        assert_eq("worklog count", len(surviving), 1),
        assert_eq("wl1 retained", f"{KEY_PREFIX}WL-G3-1" in surviving, True),
        assert_eq("wl2 deleted", f"{KEY_PREFIX}WL-G3-2" not in surviving, True),
    ] if e]


def scenario_h1_changelog_replay():
    """H1: Same changelog history in both versions → final state is correct (DELETE+REINSERT churn doesn't break correctness)."""
    key = f"{KEY_PREFIX}H1"
    actor = user_payload("actor")
    cl = {"histories": [
        {"id": "h1", "author": actor, "created": "2026-05-02T10:00:00Z",
         "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
        {"id": "h2", "author": actor, "created": "2026-05-05T15:00:00Z",
         "items": [{"field": "status", "fromString": "In Progress", "toString": "Done"}]},
    ]}
    v1 = make_payload(key, changelog=cl)
    v2 = make_payload(key, changelog=cl)
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("changelog count", count("changelogs", "issue_id = :i", {"i": iid}), 2),
    ] if e]


def scenario_h2_changelog_grew():
    """H2: v2 adds a new history event → 3 changelog rows."""
    key = f"{KEY_PREFIX}H2"
    actor = user_payload("actor")
    cl_v1 = {"histories": [
        {"id": "h1", "author": actor, "created": "2026-05-02T10:00:00Z",
         "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
        {"id": "h2", "author": actor, "created": "2026-05-05T15:00:00Z",
         "items": [{"field": "status", "fromString": "In Progress", "toString": "Done"}]},
    ]}
    cl_v2 = {"histories": cl_v1["histories"] + [
        {"id": "h3", "author": actor, "created": "2026-05-08T10:00:00Z",
         "items": [{"field": "priority", "fromString": "Low", "toString": "High"}]},
    ]}
    v1 = make_payload(key, changelog=cl_v1)
    v2 = make_payload(key, changelog=cl_v2)
    two_promotes(key, v1, v2)
    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("changelog count", count("changelogs", "issue_id = :i", {"i": iid}), 3),
    ] if e]


def scenario_i1_dual_staging_audit_trail():
    """I1: Two successful promotes → both staging rows are `promoted`,
    each preserves its own `raw_payload`, both `promoted_at` set."""
    key = f"{KEY_PREFIX}I1"
    v1 = make_payload(key, summary="version one")
    v2 = make_payload(key, summary="version two")
    two_promotes(key, v1, v2)
    rows = staging_rows_for(key)
    if len(rows) != 2:
        return [f"expected 2 staging rows, got {len(rows)}"]
    errs = [
        assert_eq("row[0] status", rows[0]["review_status"], "promoted"),
        assert_eq("row[1] status", rows[1]["review_status"], "promoted"),
        assert_eq("row[0] payload preserved", rows[0]["raw_payload_summary"], "version one"),
        assert_eq("row[1] payload preserved", rows[1]["raw_payload_summary"], "version two"),
        assert_eq("row[0] promoted_at set", rows[0]["promoted_at"] is not None, True),
        assert_eq("row[1] promoted_at set", rows[1]["promoted_at"] is not None, True),
    ]
    return [e for e in errs if e]


def scenario_j1_failed_then_recovered():
    """J1: First approved row fails (bad payload). Second approved row is good →
    it promotes; staging row 1 stays `failed`, row 2 is `promoted`, issue exists."""
    key = f"{KEY_PREFIX}J1"
    sync_id_1 = make_sync_state()
    bad_payload = {"id": "bad", "fields": {"summary": "missing key"}}  # no top-level "key"
    good_payload = make_payload(key, summary="recovered")

    bad_id = stage_approved(key, bad_payload, sync_id_1)
    res1 = run_promote()
    # After first run: bad_id is `failed`, no issue yet.
    sync_id_2 = make_sync_state()
    good_id = stage_approved(key, good_payload, sync_id_2)
    res2 = run_promote()

    issue = get_issue(key)
    db = SessionLocal()
    try:
        bad_row = db.get(StagingIssue, bad_id)
        good_row = db.get(StagingIssue, good_id)
    finally:
        db.close()
    errs = [
        assert_eq("first promote failed", res1["failed"], 1),
        assert_eq("second promote succeeded", res2["promoted"], 1),
        assert_eq("issue created on recovery", issue is not None, True),
        assert_eq("issue.summary", issue["summary"], "recovered"),
        assert_eq("bad row stays `failed`", bad_row.review_status, "failed"),
        assert_eq("good row `promoted`", good_row.review_status, "promoted"),
    ]
    return [e for e in errs if e]


def scenario_j2_good_then_failed_keeps_first_intact():
    """J2: First approved row promotes successfully. Second approved row fails →
    issue from first promote intact; staging rows in correct terminal states."""
    key = f"{KEY_PREFIX}J2"
    sync_id_1 = make_sync_state()
    good_payload = make_payload(key, summary="durable")
    bad_payload = {"id": "bad", "fields": {"summary": "missing key"}}

    good_id = stage_approved(key, good_payload, sync_id_1)
    run_promote()
    sync_id_2 = make_sync_state()
    bad_id = stage_approved(key, bad_payload, sync_id_2)
    run_promote()

    issue = get_issue(key)
    db = SessionLocal()
    try:
        good_row = db.get(StagingIssue, good_id)
        bad_row = db.get(StagingIssue, bad_id)
    finally:
        db.close()
    return [e for e in [
        assert_eq("issue exists", issue is not None, True),
        assert_eq("issue.summary intact", issue["summary"], "durable"),
        assert_eq("first row promoted", good_row.review_status, "promoted"),
        assert_eq("second row failed", bad_row.review_status, "failed"),
    ] if e]


# ---- Group W: worklog pagination ------------------------------------------


from contextlib import contextmanager  # noqa: E402

from app.services import sync_service  # noqa: E402


class _MockJiraClient:
    """Returns canned worklog payloads. download_attachment is unused here."""

    def __init__(self, worklogs_by_key=None, raise_on=None):
        self.worklogs_by_key = worklogs_by_key or {}
        self.raise_on = raise_on or set()
        self.calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        pass

    def get_issue_worklogs(self, key, page_size=100):
        self.calls.append(key)
        if key in self.raise_on:
            raise ConnectionError("simulated pagination failure")
        return list(self.worklogs_by_key.get(key, []))

    def download_attachment(self, url):  # not used by these tests
        raise NotImplementedError


@contextmanager
def _patch_jira_client(mock):
    original = sync_service.JiraClient
    sync_service.JiraClient = lambda *_a, **_kw: mock
    try:
        yield
    finally:
        sync_service.JiraClient = original


def scenario_w1_pagination_completes_set():
    """W1: total > len(inline) → JiraClient.get_issue_worklogs is called and
    returns the complete set; all worklogs are persisted."""
    key = f"{KEY_PREFIX}W1"
    author = user_payload("paginator")

    def wl(n: int) -> dict:
        return {
            "id": f"{KEY_PREFIX}WL-W1-{n}",
            "author": author,
            "started": f"2026-05-{n:02d}T09:00:00Z",
            "timeSpentSeconds": 600,
            "created": f"2026-05-{n:02d}T10:00:00Z",
        }

    full_set = [wl(n) for n in range(1, 26)]  # 25 worklogs
    inline_truncated = full_set[:20]  # only 20 inline (Jira's default cap)

    sync_id = make_sync_state()
    payload = make_payload(
        key,
        worklog={"total": 25, "maxResults": 20, "worklogs": inline_truncated},
        aggregatetimespent=15000,
    )
    stage_approved(key, payload, sync_id)

    mock = _MockJiraClient(worklogs_by_key={key: full_set})
    db = SessionLocal()
    try:
        with _patch_jira_client(mock):
            from app.services.staging_service import promote_approved
            promote_approved(db)
    finally:
        db.close()

    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("paginated fetch called once", mock.calls, [key]),
        assert_eq(
            "all 25 worklogs persisted",
            count("worklogs", "issue_id = :i", {"i": iid}),
            25,
        ),
    ] if e]


def scenario_w2_pagination_failure_no_delete():
    """W2: After a successful first promote with 25 worklogs, a second promote
    has truncated inline (20 of 25) AND pagination fails. Behavior: 20 inline
    upserted, the 5 we couldn't see are NOT deleted (we never had the complete
    set on this run)."""
    key = f"{KEY_PREFIX}W2"
    author = user_payload("paginator2")

    def wl(n: int) -> dict:
        return {
            "id": f"{KEY_PREFIX}WL-W2-{n}",
            "author": author,
            "started": f"2026-05-{n:02d}T09:00:00Z",
            "timeSpentSeconds": 600,
            "created": f"2026-05-{n:02d}T10:00:00Z",
        }

    full_set = [wl(n) for n in range(1, 26)]
    inline_truncated = full_set[:20]

    sync_id_1 = make_sync_state()
    v1 = make_payload(
        key,
        worklog={"total": 25, "maxResults": 20, "worklogs": inline_truncated},
        aggregatetimespent=15000,
    )
    stage_approved(key, v1, sync_id_1)
    mock_ok = _MockJiraClient(worklogs_by_key={key: full_set})
    db = SessionLocal()
    try:
        with _patch_jira_client(mock_ok):
            from app.services.staging_service import promote_approved
            promote_approved(db)
    finally:
        db.close()

    sync_id_2 = make_sync_state()
    v2 = make_payload(
        key,
        worklog={"total": 25, "maxResults": 20, "worklogs": inline_truncated},
        aggregatetimespent=15000,
        # bump summary so the second stage row is distinct
        summary="re-promote with pagination failure",
    )
    stage_approved(key, v2, sync_id_2)
    mock_fail = _MockJiraClient(raise_on={key})
    db = SessionLocal()
    try:
        with _patch_jira_client(mock_fail):
            from app.services.staging_service import promote_approved
            promote_approved(db)
    finally:
        db.close()

    iid = get_issue(key)["id"]
    return [e for e in [
        assert_eq("pagination attempted", mock_fail.calls, [key]),
        assert_eq(
            "all 25 worklogs preserved (no deletion when set was incomplete)",
            count("worklogs", "issue_id = :i", {"i": iid}),
            25,
        ),
    ] if e]


# ---- main ------------------------------------------------------------------


def main():
    scenarios = [
        ("A1: idempotent re-promote", scenario_a1_idempotent_repromote),
        ("B1: summary + status update", scenario_b1_summary_status_update),
        ("B2: priority + story_points + labels update", scenario_b2_priority_storypoints_labels),
        ("C1: assignee swap (new user appears)", scenario_c1_assignee_swap),
        ("C2: assignee cleared", scenario_c2_assignee_cleared),
        ("C3: team swap (both teams retained)", scenario_c3_team_swap),
        ("D1: sprint membership change (S1 leaves, S3 joins)", scenario_d1_sprint_membership_change),
        ("E1: comment added in v2", scenario_e1_comment_added_in_v2),
        ("E2: attachment added in v2", scenario_e2_attachment_added_in_v2),
        ("E3: worklog added in v2", scenario_e3_worklog_added_in_v2),
        ("F1: comment edited (same id, body changes)", scenario_f1_comment_edited),
        ("G1: comment deletion in Jira propagates", scenario_g1_comment_deletion_propagates),
        ("G2: attachment deletion in Jira propagates", scenario_g2_attachment_deletion_propagates),
        ("G3: worklog deletion propagates when complete set", scenario_g3_worklog_deletion_propagates_when_complete_set),
        ("H1: changelog replay produces same state", scenario_h1_changelog_replay),
        ("H2: changelog grew across promotes", scenario_h2_changelog_grew),
        ("I1: dual-staging audit trail (both rows `promoted`)", scenario_i1_dual_staging_audit_trail),
        ("J1: failed first, recovered on second promote", scenario_j1_failed_then_recovered),
        ("J2: good first, failed second → first issue intact", scenario_j2_good_then_failed_keeps_first_intact),
        ("W1: worklog pagination — total > inline → all rows persisted", scenario_w1_pagination_completes_set),
        ("W2: pagination failure → no deletion, existing rows preserved", scenario_w2_pagination_failure_no_delete),
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
