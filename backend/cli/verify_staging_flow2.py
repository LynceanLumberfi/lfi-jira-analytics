"""Verification harness for staging Flow 2 (re-sync against existing staging).

Exercises the Flow 2 invariant: at most one row per `jira_key` is in an
active state (`pending` or `approved`). When a re-sync brings a different
hash for an issue with an existing active row, the prior row is moved to
`superseded` and a new `pending` row is inserted — atomically.

Each scenario runs the real `sync_service.run_sync` two or three times in
sequence with a mocked JiraClient, then asserts the cross-run state.

Uses jira_keys prefixed with `VERIFY-F2-` and `triggered_by='verify-flow2'`.
Cleans up at the end.

Run: ../.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
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

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from datetime import datetime, timezone  # noqa: E402

from sqlalchemy import func, select, text  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import StagingIssue, SyncPhase, SyncState  # noqa: E402
from app.services import sync_service  # noqa: E402


KEY_PREFIX = "VERIFY-F2-"
TRIGGERED_BY = "verify-flow2"


def k(label: str) -> str:
    return f"{KEY_PREFIX}{label}"


# ---- mock JiraClient -------------------------------------------------------


class MockJiraClient:
    def __init__(self, issues=None, total=None):
        self.issues = list(issues or [])
        self.total = total if total is not None else len(self.issues)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        pass

    def get_issue_count(self, jql):
        return self.total

    def search_issues(self, jql, **_kwargs):
        for issue in self.issues:
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


def reset_data(db) -> None:
    db.execute(
        text(
            "DELETE FROM failed_records WHERE "
            "(jira_ref LIKE :p "
            "OR sync_state_id IN (SELECT id FROM sync_state WHERE triggered_by = :t))"
        ),
        {"p": KEY_PREFIX + "%", "t": TRIGGERED_BY},
    )
    db.execute(
        text("DELETE FROM staging_issues WHERE jira_key LIKE :p"),
        {"p": KEY_PREFIX + "%"},
    )
    db.execute(
        text(
            "DELETE FROM sync_phases WHERE sync_state_id IN "
            "(SELECT id FROM sync_state WHERE triggered_by = :t)"
        ),
        {"t": TRIGGERED_BY},
    )
    db.execute(
        text("DELETE FROM sync_state WHERE triggered_by = :t"),
        {"t": TRIGGERED_BY},
    )
    db.commit()


def run_sync(mock_client) -> int:
    db = SessionLocal()
    try:
        state = sync_service.create_pending_sync_state(
            db, since=None, triggered_by=TRIGGERED_BY
        )
        sid = state.id
    finally:
        db.close()

    with patch_jira_client(mock_client):
        sync_service.run_sync(SessionLocal, sid, requested_since=None)
    return sid


def staging_for(jira_key: str) -> list[dict]:
    """All rows for a jira_key, ordered by id ASC (oldest first)."""
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
                "sync_state_id": r.sync_state_id,
                "review_status": r.review_status,
                "change_type": r.change_type,
                "payload_hash": r.payload_hash,
                "superseded_at_set": r.superseded_at is not None,
                "promoted_at_set": r.promoted_at is not None,
            }
            for r in rows
        ]
    finally:
        db.close()


def count_active(jira_key: str) -> int:
    db = SessionLocal()
    try:
        return db.execute(
            select(func.count(StagingIssue.id)).where(
                StagingIssue.jira_key == jira_key,
                StagingIssue.review_status.in_(StagingIssue.ACTIVE_STATUSES),
            )
        ).scalar_one()
    finally:
        db.close()


def phase_metrics(sid: int) -> dict | None:
    db = SessionLocal()
    try:
        phase = db.execute(
            select(SyncPhase)
            .where(SyncPhase.sync_state_id == sid, SyncPhase.phase == "syncing")
            .limit(1)
        ).scalar_one_or_none()
        return phase.metrics if phase else None
    finally:
        db.close()


def set_status(jira_key: str, status: str) -> None:
    """Flip the latest staging row for a jira_key to a given review_status.
    Used to set up "prior row is approved/skipped/promoted/failed" preconditions
    before the next sync."""
    db = SessionLocal()
    try:
        latest = db.execute(
            select(StagingIssue)
            .where(StagingIssue.jira_key == jira_key)
            .order_by(StagingIssue.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest is None:
            raise RuntimeError(f"no staging row for {jira_key}")
        latest.review_status = status
        if status == StagingIssue.STATUS_PROMOTED:
            latest.promoted_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def assert_eq(label, actual, expected):
    if actual != expected:
        return f"{label}: expected {expected!r}, got {actual!r}"
    return None


def check(name: str, fn) -> bool:
    print(f"\n=== {name} ===")
    db = SessionLocal()
    try:
        reset_data(db)
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

# Group H — hash-gating across runs


def scenario_h1_no_change():
    """H1: re-sync with identical content → 0 new rows, all classified unchanged."""
    issues = [make_issue(k("a")), make_issue(k("b")), make_issue(k("c"))]
    run_sync(MockJiraClient(issues=issues))
    sid2 = run_sync(MockJiraClient(issues=issues))
    errs = []
    for label in ("a", "b", "c"):
        rows = staging_for(k(label))
        if len(rows) != 1:
            errs.append(f"{k(label)}: expected 1 row total, got {len(rows)}")
    e = assert_eq(
        "sync 2 metrics",
        phase_metrics(sid2),
        {"total": 3, "new": 0, "updated": 0, "unchanged": 3},
    )
    if e:
        errs.append(e)
    return errs


def scenario_h2_one_changed():
    """H2: re-sync with one issue's hash changed → 1 new 'updated' row."""
    v1 = [make_issue(k("a")), make_issue(k("b")), make_issue(k("c"))]
    v2 = [
        make_issue(k("a"), summary="changed"),
        make_issue(k("b")),
        make_issue(k("c")),
    ]
    run_sync(MockJiraClient(issues=v1))
    sid2 = run_sync(MockJiraClient(issues=v2))
    errs = []
    e = assert_eq(
        "sync 2 metrics",
        phase_metrics(sid2),
        {"total": 3, "new": 0, "updated": 1, "unchanged": 2},
    )
    if e:
        errs.append(e)
    rows_a = staging_for(k("a"))
    if len(rows_a) != 2:
        errs.append(f"{k('a')}: expected 2 rows, got {len(rows_a)}")
    elif rows_a[1]["change_type"] != "updated":
        errs.append(f"{k('a')} latest change_type: {rows_a[1]['change_type']!r}")
    for label in ("b", "c"):
        rows = staging_for(k(label))
        if len(rows) != 1:
            errs.append(f"{k(label)}: expected 1 row total, got {len(rows)}")
    return errs


def scenario_h3_brand_new_in_resync():
    """H3: re-sync with a brand-new issue not present in sync 1 → 1 'new' row."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"))]))
    sid2 = run_sync(MockJiraClient(issues=[make_issue(k("a")), make_issue(k("b"))]))
    errs = []
    e = assert_eq(
        "sync 2 metrics",
        phase_metrics(sid2),
        {"total": 2, "new": 1, "updated": 0, "unchanged": 1},
    )
    if e:
        errs.append(e)
    rows_b = staging_for(k("b"))
    if len(rows_b) != 1 or rows_b[0]["change_type"] != "new":
        errs.append(f"{k('b')}: expected 1 'new' row, got {rows_b}")
    return errs


def scenario_h4_mixed():
    """H4: mixed re-sync — 1 updated, 1 unchanged, 1 absent, 1 brand new."""
    v1 = [make_issue(k("a")), make_issue(k("b")), make_issue(k("c"))]
    v2 = [
        make_issue(k("a"), summary="changed"),
        make_issue(k("b")),
        # c absent (deleted from Jira's response window)
        make_issue(k("d")),  # brand new
    ]
    run_sync(MockJiraClient(issues=v1))
    sid2 = run_sync(MockJiraClient(issues=v2))
    errs = []
    e = assert_eq(
        "sync 2 metrics",
        phase_metrics(sid2),
        {"total": 3, "new": 1, "updated": 1, "unchanged": 1},
    )
    if e:
        errs.append(e)
    return errs


# Group I — prior staging row state × hash change


def scenario_i1_pending_unchanged():
    """I1: prior pending + same hash → no new row."""
    issue = make_issue(k("a"))
    run_sync(MockJiraClient(issues=[issue]))
    run_sync(MockJiraClient(issues=[issue]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 1:
        errs.append(f"expected 1 row, got {len(rows)}")
    elif rows[0]["review_status"] != "pending":
        errs.append(f"row status: {rows[0]['review_status']!r}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


def scenario_i2_pending_changed():
    """I2: prior pending + hash changed → old → superseded; new pending row."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 2:
        errs.append(f"expected 2 rows, got {len(rows)}")
        return errs
    old, new = rows
    if old["review_status"] != "superseded":
        errs.append(f"old row status: {old['review_status']!r}")
    if not old["superseded_at_set"]:
        errs.append("old row superseded_at not set")
    if new["review_status"] != "pending":
        errs.append(f"new row status: {new['review_status']!r}")
    if new["change_type"] != "updated":
        errs.append(f"new row change_type: {new['change_type']!r}")
    if old["payload_hash"] == new["payload_hash"]:
        errs.append("old/new hashes should differ")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


def scenario_i3_approved_unchanged():
    """I3: prior approved + same hash → no new row, still approved."""
    issue = make_issue(k("a"))
    run_sync(MockJiraClient(issues=[issue]))
    set_status(k("a"), StagingIssue.STATUS_APPROVED)
    run_sync(MockJiraClient(issues=[issue]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 1:
        errs.append(f"expected 1 row, got {len(rows)}")
    elif rows[0]["review_status"] != "approved":
        errs.append(f"row status: {rows[0]['review_status']!r}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


def scenario_i4_approved_changed():
    """I4: prior approved + hash changed → old → superseded; new pending.
    This is the key bug-class fix: the old approved row is no longer
    eligible for promotion with stale content."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    set_status(k("a"), StagingIssue.STATUS_APPROVED)
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 2:
        errs.append(f"expected 2 rows, got {len(rows)}")
        return errs
    old, new = rows
    if old["review_status"] != "superseded":
        errs.append(f"old (formerly approved) row status: {old['review_status']!r}")
    if not old["superseded_at_set"]:
        errs.append("old row superseded_at not set")
    if new["review_status"] != "pending":
        errs.append(f"new row status: {new['review_status']!r}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


def scenario_i5_skipped_unchanged():
    """I5: prior skipped + same hash → no new row, still skipped."""
    issue = make_issue(k("a"))
    run_sync(MockJiraClient(issues=[issue]))
    set_status(k("a"), StagingIssue.STATUS_SKIPPED)
    run_sync(MockJiraClient(issues=[issue]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 1:
        errs.append(f"expected 1 row, got {len(rows)}")
    elif rows[0]["review_status"] != "skipped":
        errs.append(f"row status: {rows[0]['review_status']!r}")
    if count_active(k("a")) != 0:
        errs.append(f"expected 0 active rows, got {count_active(k('a'))}")
    return errs


def scenario_i6_skipped_changed():
    """I6: prior skipped + hash changed → new pending row; prior row stays
    skipped (terminal — not superseded)."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    set_status(k("a"), StagingIssue.STATUS_SKIPPED)
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 2:
        errs.append(f"expected 2 rows, got {len(rows)}")
        return errs
    old, new = rows
    if old["review_status"] != "skipped":
        errs.append(f"old row should remain 'skipped', got {old['review_status']!r}")
    if old["superseded_at_set"]:
        errs.append("terminal 'skipped' row should not have superseded_at set")
    if new["review_status"] != "pending":
        errs.append(f"new row status: {new['review_status']!r}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


def scenario_i7_promoted_unchanged():
    """I7: prior promoted + same hash → no new row, still promoted."""
    issue = make_issue(k("a"))
    run_sync(MockJiraClient(issues=[issue]))
    set_status(k("a"), StagingIssue.STATUS_PROMOTED)
    run_sync(MockJiraClient(issues=[issue]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 1:
        errs.append(f"expected 1 row, got {len(rows)}")
    elif rows[0]["review_status"] != "promoted":
        errs.append(f"row status: {rows[0]['review_status']!r}")
    if count_active(k("a")) != 0:
        errs.append(f"expected 0 active rows, got {count_active(k('a'))}")
    return errs


def scenario_i8_promoted_changed():
    """I8: prior promoted + hash changed → new pending row (re-edit case);
    prior promoted row stays terminal."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    set_status(k("a"), StagingIssue.STATUS_PROMOTED)
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 2:
        errs.append(f"expected 2 rows, got {len(rows)}")
        return errs
    old, new = rows
    if old["review_status"] != "promoted":
        errs.append(f"old row should remain 'promoted', got {old['review_status']!r}")
    if old["superseded_at_set"]:
        errs.append("terminal 'promoted' row should not have superseded_at set")
    if new["review_status"] != "pending":
        errs.append(f"new row status: {new['review_status']!r}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


def scenario_i9_failed_changed():
    """I9: prior failed + hash changed → new pending row; prior failed stays."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    set_status(k("a"), StagingIssue.STATUS_FAILED)
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 2:
        errs.append(f"expected 2 rows, got {len(rows)}")
        return errs
    old, new = rows
    if old["review_status"] != "failed":
        errs.append(f"old row should remain 'failed', got {old['review_status']!r}")
    if old["superseded_at_set"]:
        errs.append("terminal 'failed' row should not have superseded_at set")
    if new["review_status"] != "pending":
        errs.append(f"new row status: {new['review_status']!r}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


# Group K — multi-run audit trail


def scenario_k1_three_distinct_versions():
    """K1: three syncs with three distinct hashes → 3 staging rows, only the
    latest is active; older two are superseded."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v3")]))
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 3:
        errs.append(f"expected 3 rows, got {len(rows)}")
        return errs
    statuses = [r["review_status"] for r in rows]
    if statuses != ["superseded", "superseded", "pending"]:
        errs.append(f"expected [superseded, superseded, pending], got {statuses}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    hashes = {r["payload_hash"] for r in rows}
    if len(hashes) != 3:
        errs.append(f"expected 3 distinct hashes, got {len(hashes)}")
    return errs


def scenario_k2_flap_back_to_original():
    """K2: hash sequence A → B → A. Third row shares hash with first but is
    NOT deduped — `latest_hashes` only compares against the current latest
    (B's hash), so reverting back to A's content inserts a fresh row."""
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v2")]))
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))  # back to v1
    rows = staging_for(k("a"))
    errs = []
    if len(rows) != 3:
        errs.append(f"expected 3 rows, got {len(rows)}")
        return errs
    if rows[0]["payload_hash"] != rows[2]["payload_hash"]:
        errs.append("flapped-back row should share hash with the original")
    if rows[1]["payload_hash"] == rows[0]["payload_hash"]:
        errs.append("middle row should have a distinct hash")
    statuses = [r["review_status"] for r in rows]
    if statuses != ["superseded", "superseded", "pending"]:
        errs.append(f"expected [superseded, superseded, pending], got {statuses}")
    if count_active(k("a")) != 1:
        errs.append(f"expected exactly 1 active row, got {count_active(k('a'))}")
    return errs


# Group L — operational edge cases


def scenario_l1_issue_disappears():
    """L1: issue exists in sync 1 but is missing from sync 2 (deleted in Jira
    or out of JQL window) → its prior staging row is left untouched as
    historical record. No supersede applied."""
    run_sync(MockJiraClient(issues=[make_issue(k("a")), make_issue(k("b"))]))
    sid2 = run_sync(MockJiraClient(issues=[make_issue(k("a"))]))  # b absent
    errs = []
    e = assert_eq(
        "sync 2 metrics (only counts what Jira returned)",
        phase_metrics(sid2),
        {"total": 1, "new": 0, "updated": 0, "unchanged": 1},
    )
    if e:
        errs.append(e)
    rows_b = staging_for(k("b"))
    if len(rows_b) != 1:
        errs.append(f"{k('b')}: expected 1 row preserved, got {len(rows_b)}")
    elif rows_b[0]["review_status"] != "pending":
        errs.append(
            f"{k('b')} should remain 'pending', got {rows_b[0]['review_status']!r}"
        )
    elif rows_b[0]["superseded_at_set"]:
        errs.append(f"{k('b')}: superseded_at should not be set on disappearance")
    return errs


# Group U — invariant enforcement (DB-level)


def scenario_u1_partial_unique_index():
    """U1: the partial unique index `uq_staging_active_jira_key` rejects a
    direct INSERT that would create a second active row for the same
    jira_key. This proves the invariant is enforced even if the
    application-layer supersede logic were bypassed."""
    from sqlalchemy.exc import IntegrityError

    # Set up: one pending row exists
    run_sync(MockJiraClient(issues=[make_issue(k("a"), summary="v1")]))

    db = SessionLocal()
    errs = []
    try:
        # Attempt a raw second active insert without going through stage_issue.
        # Should violate the partial unique index.
        try:
            db.execute(
                text(
                    "INSERT INTO staging_issues "
                    "(jira_key, sync_state_id, payload_hash, change_type, "
                    "raw_payload, review_status) "
                    "SELECT :k, sync_state_id, 'deadbeef', 'updated', "
                    "'{}'::jsonb, 'pending' "
                    "FROM staging_issues WHERE jira_key = :k LIMIT 1"
                ),
                {"k": k("a")},
            )
            db.commit()
            errs.append("expected IntegrityError on second active row, got success")
        except IntegrityError as exc:
            db.rollback()
            msg = str(exc).lower()
            if "uq_staging_active_jira_key" not in msg and "unique" not in msg:
                errs.append(f"unexpected error message: {msg!r}")
    finally:
        db.close()
    return errs


# ---- main ------------------------------------------------------------------


def main():
    scenarios = [
        ("H1: re-sync, no change → all unchanged", scenario_h1_no_change),
        ("H2: re-sync, one issue changed", scenario_h2_one_changed),
        ("H3: re-sync, brand-new issue introduced", scenario_h3_brand_new_in_resync),
        ("H4: re-sync, mixed new/updated/unchanged/absent", scenario_h4_mixed),
        ("I1: prior pending + same hash → no new row", scenario_i1_pending_unchanged),
        ("I2: prior pending + hash changed → supersede + new", scenario_i2_pending_changed),
        ("I3: prior approved + same hash → no new row", scenario_i3_approved_unchanged),
        ("I4: prior approved + hash changed → supersede + new", scenario_i4_approved_changed),
        ("I5: prior skipped + same hash → no new row", scenario_i5_skipped_unchanged),
        ("I6: prior skipped + hash changed → new pending, prior intact", scenario_i6_skipped_changed),
        ("I7: prior promoted + same hash → no new row", scenario_i7_promoted_unchanged),
        ("I8: prior promoted + hash changed → new pending, prior intact", scenario_i8_promoted_changed),
        ("I9: prior failed + hash changed → new pending, prior intact", scenario_i9_failed_changed),
        ("K1: three distinct versions → 3 rows, latest active", scenario_k1_three_distinct_versions),
        ("K2: flap A → B → A → 3 rows, hash[0]==hash[2]", scenario_k2_flap_back_to_original),
        ("L1: issue disappears from sync 2 → prior row preserved", scenario_l1_issue_disappears),
        ("U1: partial unique index rejects raw second-active insert", scenario_u1_partial_unique_index),
    ]

    passed: list[str] = []
    failed: list[str] = []
    for name, fn in scenarios:
        if check(name, fn):
            passed.append(name)
        else:
            failed.append(name)

    db = SessionLocal()
    try:
        reset_data(db)
    finally:
        db.close()

    print(f"\n{'=' * 60}")
    print(f"Summary: {len(passed)} passed, {len(failed)} failed")
    for n in failed:
        print(f"  FAIL  {n}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
