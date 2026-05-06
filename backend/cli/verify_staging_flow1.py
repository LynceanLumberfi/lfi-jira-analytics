"""Verification harness for staging Flow 1 (first sync into empty staging).

Runs the real `sync_service.run_sync` with a mocked JiraClient so each scenario
hits the actual staging path: hash → stage → phase tracking → commit cadence.

Uses jira_keys prefixed with `VERIFY-` and `triggered_by='verify-flow1'` so
nothing else in the DB is touched. Cleans up at the end.

Run: ../.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
"""
from __future__ import annotations

import os
import sys
import traceback
from contextlib import contextmanager

# ---- env bootstrap ---------------------------------------------------------

os.environ.setdefault(
    "DATABASE_URL", "postgresql://admin:secret@localhost:5433/jira_analytics"
)
os.environ.setdefault("JIRA_BASE_URL", "https://placeholder.atlassian.net")
os.environ.setdefault("JIRA_EMAIL", "x@x.com")
os.environ.setdefault("JIRA_API_TOKEN", "x")

# Make `app` importable when running from the project root
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from datetime import datetime, timezone  # noqa: E402

import httpx  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import StagingIssue, SyncPhase, SyncState  # noqa: E402
from app.services import sync_service  # noqa: E402


# ---- mock JiraClient -------------------------------------------------------


class MockJiraClient:
    def __init__(
        self,
        issues=None,
        total=None,
        count_error=None,
        search_error_after=None,
    ):
        self.issues = list(issues or [])
        self.total = total if total is not None else len(self.issues)
        self.count_error = count_error
        self.search_error_after = search_error_after

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        pass

    def get_issue_count(self, jql):
        if self.count_error:
            raise self.count_error
        return self.total

    def search_issues(self, jql, **_kwargs):
        for i, issue in enumerate(self.issues):
            if self.search_error_after is not None and i >= self.search_error_after:
                raise httpx.NetworkError("simulated network drop")
            yield issue


@contextmanager
def patch_jira_client(mock):
    original = sync_service.JiraClient
    sync_service.JiraClient = lambda *_a, **_kw: mock
    try:
        yield
    finally:
        sync_service.JiraClient = original


# ---- helpers ---------------------------------------------------------------


def make_issue(key: str, **field_overrides) -> dict:
    fields = {
        "summary": f"summary for {key}",
        "status": {"name": "To Do"},
        "issuetype": {"name": "Story"},
        "assignee": None,
        "priority": None,
        "story_points": None,
        "description": None,
        "labels": [],
        "attachment": [],
        "updated": "2026-05-08T10:00:00Z",
    }
    fields.update(field_overrides)
    return {"key": key, "id": f"id-{key}", "fields": fields}


def reset_verify_data(db) -> None:
    db.execute(
        text(
            "DELETE FROM failed_records WHERE "
            "(jira_ref LIKE 'VERIFY-%' "
            "OR sync_state_id IN (SELECT id FROM sync_state WHERE triggered_by = 'verify-flow1'))"
        )
    )
    db.execute(text("DELETE FROM staging_issues WHERE jira_key LIKE 'VERIFY-%'"))
    db.execute(
        text(
            "DELETE FROM sync_phases WHERE sync_state_id IN "
            "(SELECT id FROM sync_state WHERE triggered_by = 'verify-flow1')"
        )
    )
    db.execute(text("DELETE FROM sync_state WHERE triggered_by = 'verify-flow1'"))
    db.commit()


def run_sync_with_mock(mock_client) -> int:
    db = SessionLocal()
    try:
        state = sync_service.create_pending_sync_state(
            db, since=None, triggered_by="verify-flow1"
        )
        sid = state.id
    finally:
        db.close()

    with patch_jira_client(mock_client):
        sync_service.run_sync(SessionLocal, sid, requested_since=None)
    return sid


def collect(sid: int) -> dict:
    db = SessionLocal()
    try:
        state = db.get(SyncState, sid)
        phases = (
            db.execute(select(SyncPhase).where(SyncPhase.sync_state_id == sid))
            .scalars()
            .all()
        )
        staging = (
            db.execute(
                select(StagingIssue)
                .where(StagingIssue.sync_state_id == sid)
                .order_by(StagingIssue.jira_key)
            )
            .scalars()
            .all()
        )
        return {
            "sync_state": {
                "status": state.status if state else None,
                "issues_synced": state.issues_synced if state else None,
                "error_message": state.error_message if state else None,
            },
            "phases": [
                {
                    "phase": p.phase,
                    "status": p.status,
                    "items_total": p.items_total,
                    "items_processed": p.items_processed,
                    "metrics": p.metrics,
                    "error_message": p.error_message,
                }
                for p in phases
            ],
            "staging": [
                {
                    "jira_key": s.jira_key,
                    "change_type": s.change_type,
                    "review_status": s.review_status,
                    "payload_hash": (s.payload_hash or "")[:8],
                }
                for s in staging
            ],
        }
    finally:
        db.close()


def assert_eq(label: str, actual, expected):
    if actual != expected:
        return f"{label}: expected {expected!r}, got {actual!r}"
    return None


def check(name: str, fn) -> bool:
    print(f"\n=== {name} ===")
    db = SessionLocal()
    try:
        reset_verify_data(db)
    finally:
        db.close()
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


def scenario_a1():
    """A1: Single populated issue → 1 row, change_type='new', metrics correct."""
    issue = make_issue("VERIFY-1")
    sid = run_sync_with_mock(MockJiraClient(issues=[issue]))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("sync_state.issues_synced", s["sync_state"]["issues_synced"], 1),
        assert_eq("len(phases)", len(s["phases"]), 1),
        assert_eq("phase.phase", s["phases"][0]["phase"], "syncing"),
        assert_eq("phase.status", s["phases"][0]["status"], "success"),
        assert_eq("phase.items_total", s["phases"][0]["items_total"], 1),
        assert_eq(
            "phase.metrics",
            s["phases"][0]["metrics"],
            {"total": 1, "new": 1, "updated": 0, "unchanged": 0},
        ),
        assert_eq("len(staging)", len(s["staging"]), 1),
        assert_eq("staging[0].jira_key", s["staging"][0]["jira_key"], "VERIFY-1"),
        assert_eq("staging[0].change_type", s["staging"][0]["change_type"], "new"),
        assert_eq("staging[0].review_status", s["staging"][0]["review_status"], "pending"),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_a2():
    """A2: 5 issues → 5 'new' rows."""
    issues = [make_issue(f"VERIFY-{i}") for i in range(1, 6)]
    sid = run_sync_with_mock(MockJiraClient(issues=issues))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("sync_state.issues_synced", s["sync_state"]["issues_synced"], 5),
        assert_eq(
            "phase.metrics",
            s["phases"][0]["metrics"],
            {"total": 5, "new": 5, "updated": 0, "unchanged": 0},
        ),
        assert_eq("len(staging)", len(s["staging"]), 5),
    ]:
        if e:
            errs.append(e)
    if not all(r["change_type"] == "new" for r in s["staging"]):
        errs.append("not all rows have change_type='new'")
    if not all(r["review_status"] == "pending" for r in s["staging"]):
        errs.append("not all rows have review_status='pending'")
    return errs


def scenario_a3():
    """A3: Different summaries → distinct hashes (sanity check on hash function)."""
    issues = [
        make_issue("VERIFY-A", summary="alpha"),
        make_issue("VERIFY-B", summary="beta"),
        make_issue("VERIFY-C", summary="gamma"),
    ]
    sid = run_sync_with_mock(MockJiraClient(issues=issues))
    s = collect(sid)
    hashes = {r["payload_hash"] for r in s["staging"]}
    if len(hashes) != 3:
        return [f"hashes not distinct: {hashes}"]
    return []


def scenario_a4_hours_in_hash():
    """A4: estimated/actual hours change → distinct hashes.
    Two issues that differ only in time_estimate / time_spent must produce
    different hashes (so editing time tracking in Jira triggers a re-review)."""
    from app.config import get_jira_settings
    from app.services.staging_service import compute_payload_hash

    settings = get_jira_settings()
    base_fields = {
        "summary": "same summary",
        "status": {"name": "To Do"},
        "issuetype": {"name": "Story"},
        "assignee": None,
        "priority": None,
        "story_points": None,
        "description": None,
        "labels": [],
        "attachment": [],
    }
    a = {"key": "VERIFY-1", "fields": {**base_fields, "aggregatetimeoriginalestimate": 3600}}
    b = {"key": "VERIFY-1", "fields": {**base_fields, "aggregatetimeoriginalestimate": 7200}}
    c = {"key": "VERIFY-1", "fields": {**base_fields,
                                        "aggregatetimeoriginalestimate": 3600,
                                        "aggregatetimespent": 1800}}

    h_a = compute_payload_hash(a, settings)
    h_b = compute_payload_hash(b, settings)
    h_c = compute_payload_hash(c, settings)

    errs = []
    if h_a == h_b:
        errs.append("hash should change when estimate changes (3600 → 7200)")
    if h_a == h_c:
        errs.append("hash should change when time_spent changes (None → 1800)")
    if len({h_a, h_b, h_c}) != 3:
        errs.append("expected 3 distinct hashes, got fewer")
    return errs


def scenario_a5_sprint_customer_reported():
    """A5: sprint, customer, reported_by_customer all influence the hash."""
    from app.config import get_jira_settings
    from app.services.staging_service import compute_payload_hash

    settings = get_jira_settings()
    base = {
        "summary": "same",
        "status": {"name": "To Do"},
        "issuetype": {"name": "Story"},
        "assignee": None,
        "priority": None,
        "description": None,
        "labels": [],
        "attachment": [],
    }

    def issue_with(**extra):
        return {"key": "VERIFY-1", "fields": {**base, **extra}}

    # Sprint changes
    base_no_sprint = issue_with()
    one_sprint = issue_with(**{settings.field_sprint: [{"id": 5, "name": "Sprint 5", "state": "active"}]})
    two_sprints = issue_with(
        **{settings.field_sprint: [
            {"id": 5, "name": "Sprint 5", "state": "active"},
            {"id": 6, "name": "Sprint 6", "state": "future"},
        ]}
    )
    # Same sprint IDs in different order — should hash the same (sorted)
    two_sprints_reordered = issue_with(
        **{settings.field_sprint: [
            {"id": 6, "name": "Sprint 6", "state": "future"},
            {"id": 5, "name": "Sprint 5", "state": "active"},
        ]}
    )
    # Same sprint IDs but the sprint's own state changed — should hash the same
    two_sprints_state_changed = issue_with(
        **{settings.field_sprint: [
            {"id": 5, "name": "Sprint 5", "state": "closed"},  # state churn
            {"id": 6, "name": "Sprint 6", "state": "active"},
        ]}
    )

    # Customer changes (multi-choice)
    one_customer = issue_with(**{settings.field_customer: [{"value": "Acme"}]})
    two_customers = issue_with(**{settings.field_customer: [{"value": "Acme"}, {"value": "Globex"}]})
    customers_reordered = issue_with(**{settings.field_customer: [{"value": "Globex"}, {"value": "Acme"}]})

    # Reported By Customer (radio)
    rbc_yes = issue_with(**{settings.field_reported_by_customer: {"value": "Yes"}})
    rbc_no = issue_with(**{settings.field_reported_by_customer: {"value": "No"}})
    rbc_yes_string = issue_with(**{settings.field_reported_by_customer: "Yes"})
    rbc_yes_bool = issue_with(**{settings.field_reported_by_customer: True})

    h = lambda i: compute_payload_hash(i, settings)
    errs = []

    # --- sprint membership change → distinct hash
    if h(base_no_sprint) == h(one_sprint):
        errs.append("hash should change when adding a sprint")
    if h(one_sprint) == h(two_sprints):
        errs.append("hash should change when adding a second sprint")
    # --- sprint reordering → SAME hash (we sort)
    if h(two_sprints) != h(two_sprints_reordered):
        errs.append("sprint reordering must not affect the hash (sorted)")
    # --- sprint state churn → SAME hash (we hash IDs only)
    if h(two_sprints) != h(two_sprints_state_changed):
        errs.append("sprint state churn must not affect the hash (IDs only)")

    # --- customer changes
    if h(base_no_sprint) == h(one_customer):
        errs.append("hash should change when adding a customer")
    if h(one_customer) == h(two_customers):
        errs.append("hash should change when adding a second customer")
    if h(two_customers) != h(customers_reordered):
        errs.append("customer reordering must not affect the hash (sorted)")

    # --- reported_by_customer
    if h(rbc_yes) == h(rbc_no):
        errs.append("hash should change when reported_by_customer flips Yes↔No")
    # Different Jira encodings of the same yes value should normalize to the same hash
    if not (h(rbc_yes) == h(rbc_yes_string) == h(rbc_yes_bool)):
        errs.append("dict / string / bool encodings of 'Yes' should hash the same")

    return errs


def scenario_a6_worklog_via_aggregate_time():
    """A6: Adding a worklog in Jira bumps `aggregatetimespent` server-side.
    Since `time_spent_secs` is in the hash, the issue re-stages and the
    reviewer sees the new worklog comment in raw_payload."""
    from app.config import get_jira_settings
    from app.services.staging_service import compute_payload_hash

    settings = get_jira_settings()
    base_fields = {
        "summary": "same",
        "status": {"name": "To Do"},
        "issuetype": {"name": "Story"},
        "assignee": None,
        "priority": None,
        "story_points": None,
        "description": None,
        "labels": [],
        "attachment": [],
    }

    # Before: 1h logged (one worklog)
    before = {
        "key": "VERIFY-1",
        "fields": {
            **base_fields,
            "aggregatetimespent": 3600,
            "worklog": {"total": 1, "worklogs": [
                {"id": "wl-1", "timeSpentSeconds": 3600, "comment": "initial setup"},
            ]},
        },
    }

    # After: 1h30m logged (a second worklog added). Jira recomputed
    # aggregatetimespent server-side, which is what staging hashes on.
    after = {
        "key": "VERIFY-1",
        "fields": {
            **base_fields,
            "aggregatetimespent": 5400,
            "worklog": {"total": 2, "worklogs": [
                {"id": "wl-1", "timeSpentSeconds": 3600, "comment": "initial setup"},
                {"id": "wl-2", "timeSpentSeconds": 1800, "comment": "fixed broken test"},
            ]},
        },
    }

    h_before = compute_payload_hash(before, settings)
    h_after = compute_payload_hash(after, settings)
    if h_before == h_after:
        return ["adding a worklog should change the hash via aggregatetimespent"]
    return []


def scenario_a7_worklog_persist():
    """A7: persist_issue stores worklogs (with comment_text) on promote."""
    from app.config import get_jira_settings
    from app.services.sync_service import persist_issue
    from app.models import Issue, Worklog, User
    from sqlalchemy import delete

    db = SessionLocal()
    errs: list[str] = []
    try:
        # Cleanup any prior verify rows
        db.execute(text("DELETE FROM worklogs WHERE jira_worklog_id LIKE 'VERIFY-WL-%'"))
        db.execute(text("DELETE FROM issues WHERE jira_key = 'VERIFY-WL-ISSUE'"))
        db.execute(text("DELETE FROM users WHERE jira_account_id = 'verify-author'"))
        db.commit()

        issue_payload = make_issue(
            "VERIFY-WL-ISSUE",
            **{
                "aggregatetimespent": 5400,
                "worklog": {
                    "total": 2,
                    "maxResults": 20,
                    "worklogs": [
                        {
                            "id": "VERIFY-WL-1",
                            "author": {"accountId": "verify-author", "displayName": "Tester"},
                            "started": "2026-05-08T09:00:00Z",
                            "timeSpentSeconds": 3600,
                            "comment": {
                                "type": "doc",
                                "content": [{"type": "paragraph", "content": [
                                    {"type": "text", "text": "debugged the build pipeline"}
                                ]}],
                            },
                            "created": "2026-05-08T10:00:00Z",
                            "updated": "2026-05-08T10:00:00Z",
                        },
                        {
                            "id": "VERIFY-WL-2",
                            "author": {"accountId": "verify-author", "displayName": "Tester"},
                            "started": "2026-05-08T13:00:00Z",
                            "timeSpentSeconds": 1800,
                            "comment": "code review notes",  # plain string variant
                            "created": "2026-05-08T14:00:00Z",
                        },
                    ],
                },
            },
        )

        persist_issue(db, issue_payload, get_jira_settings())
        db.commit()

        issue = db.execute(
            select(Issue).where(Issue.jira_key == "VERIFY-WL-ISSUE")
        ).scalar_one_or_none()
        if issue is None:
            errs.append("issue not persisted")
            return errs

        worklogs = (
            db.execute(
                select(Worklog).where(Worklog.issue_id == issue.id).order_by(Worklog.jira_worklog_id)
            )
            .scalars()
            .all()
        )
        if len(worklogs) != 2:
            errs.append(f"expected 2 worklogs, got {len(worklogs)}")
            return errs

        wl1, wl2 = worklogs
        if wl1.time_spent_secs != 3600:
            errs.append(f"wl1 time_spent_secs: {wl1.time_spent_secs}")
        if wl1.comment_text != "debugged the build pipeline":
            errs.append(
                f"wl1 comment_text mismatch: {wl1.comment_text!r}"
            )
        if not isinstance(wl1.comment_adf, dict):
            errs.append(f"wl1 comment_adf should be dict, got {type(wl1.comment_adf).__name__}")
        if wl2.time_spent_secs != 1800:
            errs.append(f"wl2 time_spent_secs: {wl2.time_spent_secs}")
        if wl2.comment_text != "code review notes":
            errs.append(f"wl2 comment_text mismatch: {wl2.comment_text!r}")
        if wl2.comment_adf is not None:
            errs.append(f"wl2 comment_adf should be None for plain string, got {wl2.comment_adf!r}")
        if wl1.author_id is None:
            errs.append("wl1 author_id should resolve via users upsert")
        if wl1.author_id != wl2.author_id:
            errs.append("both worklogs should share the same author_id")

    finally:
        # Cleanup — must delete FK-dependent rows first.
        db.execute(text(
            "DELETE FROM issue_ai_scores WHERE issue_id IN "
            "(SELECT id FROM issues WHERE jira_key = 'VERIFY-WL-ISSUE')"
        ))
        db.execute(text(
            "DELETE FROM issue_metrics WHERE issue_id IN "
            "(SELECT id FROM issues WHERE jira_key = 'VERIFY-WL-ISSUE')"
        ))
        db.execute(text("DELETE FROM worklogs WHERE jira_worklog_id LIKE 'VERIFY-WL-%'"))
        db.execute(text("DELETE FROM issues WHERE jira_key = 'VERIFY-WL-ISSUE'"))
        db.execute(text("DELETE FROM users WHERE jira_account_id = 'verify-author'"))
        db.commit()
        db.close()
    return errs


def scenario_b5():
    """B5: All optional fields null → still stages cleanly."""
    issue = make_issue(
        "VERIFY-1",
        assignee=None,
        priority=None,
        story_points=None,
        labels=[],
        attachment=[],
    )
    sid = run_sync_with_mock(MockJiraClient(issues=[issue]))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("len(staging)", len(s["staging"]), 1),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_b6():
    """B6: Unicode/emoji in summary, description, attachment filenames."""
    issue = make_issue(
        "VERIFY-1",
        summary="🚀 unicode é 中文 special",
        description={"type": "doc", "content": [{"type": "text", "text": "中文"}]},
        attachment=[{"filename": "implementation-plan-é.md"}],
        labels=["中文-tag"],
    )
    sid = run_sync_with_mock(MockJiraClient(issues=[issue]))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("len(staging)", len(s["staging"]), 1),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_c10():
    """C10: Empty Jira result set → success, no rows, all metrics zero."""
    sid = run_sync_with_mock(MockJiraClient(issues=[]))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("sync_state.issues_synced", s["sync_state"]["issues_synced"], 0),
        assert_eq(
            "phase.metrics",
            s["phases"][0]["metrics"],
            {"total": 0, "new": 0, "updated": 0, "unchanged": 0},
        ),
        assert_eq("len(staging)", len(s["staging"]), 0),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_d15():
    """D15: Issue payload with no `fields` key — should stage successfully
    (hash computed over None values, raw_payload preserved)."""
    issue = {"key": "VERIFY-1", "id": "id-1"}  # no 'fields'
    sid = run_sync_with_mock(MockJiraClient(issues=[issue], total=1))
    s = collect(sid)
    errs = []
    if s["sync_state"]["status"] != "success":
        errs.append(
            f"expected success, got {s['sync_state']['status']!r}: "
            f"{s['sync_state']['error_message']!r}"
        )
    if len(s["staging"]) != 1:
        errs.append(f"expected 1 staging row, got {len(s['staging'])}")
    return errs


def scenario_d17():
    """D17: Attachment dict missing `filename` key — hash still computes."""
    issue = make_issue(
        "VERIFY-1",
        attachment=[{"id": "att-noname"}, {"filename": "valid.txt"}],
    )
    sid = run_sync_with_mock(MockJiraClient(issues=[issue]))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("len(staging)", len(s["staging"]), 1),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_d18a():
    """D18a: Same jira_key with IDENTICAL content twice in one response.
    Second one is silently deduped via the in-memory hash cache that
    stage_issue updates after each insert. Sync succeeds with 1 staging row."""
    issue = make_issue("VERIFY-DUP")
    sid = run_sync_with_mock(MockJiraClient(issues=[issue, issue]))
    s = collect(sid)
    errs = []
    for e in [
        assert_eq("sync_state.status", s["sync_state"]["status"], "success"),
        assert_eq("sync_state.issues_synced", s["sync_state"]["issues_synced"], 2),
        assert_eq("len(staging)", len(s["staging"]), 1),
        # phase.metrics counts: 1 new (1st insert), 1 unchanged (2nd dedup'd)
        assert_eq(
            "phase.metrics",
            s["phases"][0]["metrics"],
            {"total": 2, "new": 1, "updated": 0, "unchanged": 1},
        ),
    ]:
        if e:
            errs.append(e)
    return errs


def scenario_d18b():
    """D18b: Same jira_key with DIFFERENT content twice in one response.
    Second one classifies as 'updated' but hits the unique
    (sync_state_id, jira_key) constraint → sync ends in error."""
    a = make_issue("VERIFY-DUP", summary="version A")
    b = make_issue("VERIFY-DUP", summary="version B")
    sid = run_sync_with_mock(MockJiraClient(issues=[a, b]))
    s = collect(sid)
    errs = []
    if s["sync_state"]["status"] != "error":
        errs.append(
            f"expected sync_state.status='error', got {s['sync_state']['status']!r}"
        )
    if s["phases"] and s["phases"][0]["status"] != "error":
        errs.append(
            f"expected phase.status='error', got {s['phases'][0]['status']!r}"
        )
    err_msg = (s["sync_state"]["error_message"] or "").lower()
    if "duplicate" not in err_msg and "unique" not in err_msg:
        errs.append(f"expected unique/duplicate error, got: {err_msg!r}")
    return errs


def scenario_e19():
    """E19: Jira returns 401 on count call → run fails cleanly."""
    fake_req = httpx.Request("GET", "http://x/")
    fake_resp = httpx.Response(401, request=fake_req)
    err = httpx.HTTPStatusError("401", request=fake_req, response=fake_resp)
    sid = run_sync_with_mock(MockJiraClient(count_error=err))
    s = collect(sid)
    errs = []
    if s["sync_state"]["status"] != "error":
        errs.append(f"expected error, got {s['sync_state']['status']!r}")
    if not s["sync_state"]["error_message"]:
        errs.append("error_message empty")
    return errs


def scenario_g29():
    """G29: Stuck-run reaper.
    - Insert a fake sync_state stuck in 'running' (started_at older than threshold,
      no phases yet) → reaper should mark it as 'error' and create a failed_records row.
    - Insert another in 'running' WITHIN the threshold → reaper must NOT touch it.
    - Insert one with a recent heartbeat phase → reaper must NOT touch it.
    """
    from datetime import timedelta
    from app.models import FailedRecord
    from app.services.reaper_service import reap_stuck_runs

    db = SessionLocal()
    errs: list[str] = []
    try:
        now = datetime.now(timezone.utc)

        # 1) Stuck: started 30 min ago, no phases
        stuck = SyncState(
            status=SyncState.STATUS_RUNNING,
            triggered_by="verify-flow1",
        )
        db.add(stuck)
        db.flush()
        db.execute(
            text("UPDATE sync_state SET started_at = :ts WHERE id = :id"),
            {"ts": now - timedelta(minutes=30), "id": stuck.id},
        )

        # 2) Healthy (recent): started 2 min ago, no phases
        healthy_recent = SyncState(
            status=SyncState.STATUS_RUNNING,
            triggered_by="verify-flow1",
        )
        db.add(healthy_recent)
        db.flush()
        db.execute(
            text("UPDATE sync_state SET started_at = :ts WHERE id = :id"),
            {"ts": now - timedelta(minutes=2), "id": healthy_recent.id},
        )

        # 3) Healthy (heartbeating): started 30 min ago BUT phase heartbeat 1 min ago
        heartbeating = SyncState(
            status=SyncState.STATUS_RUNNING,
            triggered_by="verify-flow1",
        )
        db.add(heartbeating)
        db.flush()
        db.execute(
            text("UPDATE sync_state SET started_at = :ts WHERE id = :id"),
            {"ts": now - timedelta(minutes=30), "id": heartbeating.id},
        )
        phase = SyncPhase(
            sync_state_id=heartbeating.id,
            phase=SyncPhase.PHASE_SYNCING,
            status=SyncPhase.STATUS_RUNNING,
            started_at=now - timedelta(minutes=30),
            heartbeat_at=now - timedelta(minutes=1),
        )
        db.add(phase)
        db.commit()

        stuck_id = stuck.id
        healthy_id = healthy_recent.id
        heartbeating_id = heartbeating.id

        # Run the reaper with default 10-minute threshold
        result = reap_stuck_runs(db, threshold_minutes=10)

        if result["reaped_count"] != 1:
            errs.append(f"expected reaped_count=1, got {result['reaped_count']}")
        if result["reaped_ids"] != [stuck_id]:
            errs.append(
                f"expected reaped_ids=[{stuck_id}], got {result['reaped_ids']}"
            )

        # Verify the stuck row is now 'error'
        db.expire_all()
        stuck_after = db.get(SyncState, stuck_id)
        if stuck_after.status != "error":
            errs.append(
                f"stuck run {stuck_id} status: expected 'error', got {stuck_after.status!r}"
            )
        if not stuck_after.error_message or "reaped" not in stuck_after.error_message.lower():
            errs.append(
                f"stuck run error_message missing 'reaped': {stuck_after.error_message!r}"
            )
        if stuck_after.finished_at is None:
            errs.append("stuck run finished_at not set")

        # Verify the recent and heartbeating rows are unchanged
        recent_after = db.get(SyncState, healthy_id)
        if recent_after.status != "running":
            errs.append(
                f"healthy_recent {healthy_id} should still be 'running', "
                f"got {recent_after.status!r}"
            )
        beat_after = db.get(SyncState, heartbeating_id)
        if beat_after.status != "running":
            errs.append(
                f"heartbeating {heartbeating_id} should still be 'running', "
                f"got {beat_after.status!r}"
            )

        # Verify a failed_records row was created
        fr_count = db.execute(
            select(FailedRecord).where(FailedRecord.sync_state_id == stuck_id)
        ).scalars().all()
        if len(fr_count) != 1:
            errs.append(f"expected 1 failed_records row for {stuck_id}, got {len(fr_count)}")

        # Idempotency: running again should reap nothing
        result2 = reap_stuck_runs(db, threshold_minutes=10)
        if result2["reaped_count"] != 0:
            errs.append(f"second reap run should be idempotent, got {result2['reaped_count']}")

    finally:
        # Cleanup the still-running test rows so subsequent runs aren't blocked
        db.execute(
            text("UPDATE sync_state SET status = 'error', finished_at = now() "
                 "WHERE triggered_by = 'verify-flow1' AND status = 'running'")
        )
        db.commit()
        db.close()
    return errs


def scenario_e20():
    """E20: Network drops mid-pagination. With <50 issues no commit happens
    inside the loop, so the entire transaction rolls back → 0 staging rows.
    sync_state and phase should both end in 'error'."""
    issues = [make_issue(f"VERIFY-{i}") for i in range(1, 6)]
    sid = run_sync_with_mock(MockJiraClient(issues=issues, search_error_after=2))
    s = collect(sid)
    errs = []
    if s["sync_state"]["status"] != "error":
        errs.append(
            f"expected sync_state.status='error', got {s['sync_state']['status']!r}"
        )
    if s["phases"] and s["phases"][0]["status"] != "error":
        errs.append(
            f"expected phase.status='error', got {s['phases'][0]['status']!r}"
        )
    # Document actual behaviour rather than assert a specific count
    print(f"  observed: {len(s['staging'])} staging rows survived rollback")
    return errs


# ---- main ------------------------------------------------------------------


def main():
    scenarios = [
        ("A1: single populated issue", scenario_a1),
        ("A2: multiple issues", scenario_a2),
        ("A3: distinct hashes for distinct content", scenario_a3),
        ("A4: estimated/actual hours influence the hash", scenario_a4_hours_in_hash),
        ("A5: sprint / customer / reported_by_customer", scenario_a5_sprint_customer_reported),
        ("A6: worklog add bumps hash via aggregatetimespent", scenario_a6_worklog_via_aggregate_time),
        ("A7: persist_issue stores worklogs with ADF + plain comments", scenario_a7_worklog_persist),
        ("B5: minimal/null fields", scenario_b5),
        ("B6: unicode and emoji", scenario_b6),
        ("C10: empty Jira result", scenario_c10),
        ("D15: payload with no 'fields' key", scenario_d15),
        ("D17: attachment without 'filename'", scenario_d17),
        ("D18a: duplicate jira_key, identical content (deduped)", scenario_d18a),
        ("D18b: duplicate jira_key, different content (constraint)", scenario_d18b),
        ("E19: bad credentials (401)", scenario_e19),
        ("E20: network drop mid-pagination", scenario_e20),
        ("G29: stuck-run reaper", scenario_g29),
    ]

    passed = []
    failed = []
    for name, fn in scenarios:
        if check(name, fn):
            passed.append(name)
        else:
            failed.append(name)

    db = SessionLocal()
    try:
        reset_verify_data(db)
    finally:
        db.close()

    print(f"\n{'=' * 60}")
    print(f"Summary: {len(passed)} passed, {len(failed)} failed")
    for n in failed:
        print(f"  FAIL  {n}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
