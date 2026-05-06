"""Verification harness for sanitize (both passes).

Each scenario:
  1. Wipes any prior `VERIFY-S1-*` rows.
  2. Inserts issues + attachments + (optional) prior `issue_ai_scores` rows
     directly — we are not re-verifying the staging or promote paths here.
  3. Patches `attachment_extractor.JiraClient` with a `MockJiraClient` that
     returns canned bytes per content_url (or raises a canned exception).
  4. Calls `run_sanitize(db)` (or with `sync_state_id` for phase tests).
  5. Asserts both passes' side effects.

Uses jira_keys prefixed `VERIFY-S1-`, jira_attachment_ids `VERIFY-S1-ATT-*`,
and triggered_by='verify-sanitize-flow1' for the optional sync_state row.

Run: ../.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py
"""
from __future__ import annotations

import os
import sys
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone

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

from app.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Attachment,
    Issue,
    SyncPhase,
    SyncState,
)
from app.services import attachment_extractor  # noqa: E402
from app.services.sanitize_service import run_sanitize  # noqa: E402


KEY_PREFIX = "VERIFY-S1-"
ATT_PREFIX = "VERIFY-S1-ATT-"
TRIGGERED_BY = "verify-sanitize-flow1"


# ---- mock JiraClient -------------------------------------------------------


class MockJiraClient:
    """Returns canned bytes per content_url. Map values can be:
      - bytes → returned as-is
      - Exception (instance) → raised
    """

    def __init__(self, downloads: dict[str, bytes | Exception] | None = None):
        self.downloads = downloads or {}
        self.calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        pass

    def download_attachment(self, url: str) -> bytes:
        self.calls.append(url)
        if url not in self.downloads:
            raise RuntimeError(f"MockJiraClient: no canned response for {url!r}")
        v = self.downloads[url]
        if isinstance(v, Exception):
            raise v
        return v


@contextmanager
def patch_jira_client(mock: MockJiraClient):
    original = attachment_extractor.JiraClient
    attachment_extractor.JiraClient = lambda *_a, **_kw: mock
    try:
        yield mock
    finally:
        attachment_extractor.JiraClient = original


# ---- DB helpers ------------------------------------------------------------


def make_issue(
    jira_key: str,
    *,
    issue_type: str = "Story",
    description: str | None = None,
) -> int:
    db = SessionLocal()
    try:
        issue = Issue(
            jira_key=jira_key,
            project=jira_key.split("-", 1)[0],
            issue_type=issue_type,
            summary=f"summary for {jira_key}",
            description=description,
        )
        db.add(issue)
        db.commit()
        return issue.id
    finally:
        db.close()


def add_attachment(
    issue_id: int,
    *,
    att_id: str,
    filename: str,
    content_url: str | None = None,
    created_at: datetime | None = None,
) -> None:
    db = SessionLocal()
    try:
        att = Attachment(
            issue_id=issue_id,
            jira_attachment_id=att_id,
            filename=filename,
            content_url=content_url
            or f"https://verify.example/{att_id}/{filename}",
            created_at=created_at or datetime(2026, 5, 8, 10, 0, tzinfo=timezone.utc),
        )
        db.add(att)
        db.commit()
    finally:
        db.close()


def insert_ai_score(
    issue_id: int,
    *,
    description_hash: str,
    status: str = "pending",
    scored_outputs: bool = False,
) -> None:
    """Direct SQL insert so we can pre-populate scored fields cleanly."""
    db = SessionLocal()
    try:
        params = {
            "issue_id": issue_id,
            "status": status,
            "hash": description_hash,
        }
        if scored_outputs:
            db.execute(
                text(
                    """
                    INSERT INTO issue_ai_scores (
                        issue_id, scoring_status, description_hash,
                        description_quality_score, ai_plan_detected,
                        skill_usage_detected, skill_name, complexity_estimate,
                        scoring_notes, model_used, scored_at
                    )
                    VALUES (
                        :issue_id, :status, :hash,
                        4.5, true, true, 'Python', 'M',
                        'looks fine', 'claude-opus-4-7', now()
                    )
                    """
                ),
                params,
            )
        else:
            db.execute(
                text(
                    """
                    INSERT INTO issue_ai_scores (
                        issue_id, scoring_status, description_hash
                    )
                    VALUES (:issue_id, :status, :hash)
                    """
                ),
                params,
            )
        db.commit()
    finally:
        db.close()


def get_description(issue_id: int) -> str | None:
    db = SessionLocal()
    try:
        return db.execute(
            text("SELECT description FROM issues WHERE id = :i"), {"i": issue_id}
        ).scalar_one_or_none()
    finally:
        db.close()


def get_ai_score(issue_id: int) -> dict | None:
    db = SessionLocal()
    try:
        row = db.execute(
            text(
                """
                SELECT scoring_status, description_hash,
                       description_quality_score, ai_plan_detected,
                       skill_name, model_used, scored_at
                FROM issue_ai_scores WHERE issue_id = :i
                """
            ),
            {"i": issue_id},
        ).one_or_none()
        if row is None:
            return None
        return dict(row._mapping)
    finally:
        db.close()


def make_sync_state() -> int:
    db = SessionLocal()
    try:
        state = SyncState(triggered_by=TRIGGERED_BY, status=SyncState.STATUS_RUNNING)
        db.add(state)
        db.commit()
        return state.id
    finally:
        db.close()


def get_phases(sync_state_id: int) -> list[dict]:
    db = SessionLocal()
    try:
        phases = db.execute(
            select(SyncPhase).where(SyncPhase.sync_state_id == sync_state_id)
        ).scalars().all()
        return [
            {
                "phase": p.phase,
                "status": p.status,
                "items_total": p.items_total,
                "items_processed": p.items_processed,
                "metrics": p.metrics,
            }
            for p in phases
        ]
    finally:
        db.close()


def reset_verify_data() -> None:
    db = SessionLocal()
    try:
        ids_subq = f"SELECT id FROM issues WHERE jira_key LIKE '{KEY_PREFIX}%'"
        db.execute(text(f"DELETE FROM issue_ai_scores WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM attachments WHERE issue_id IN ({ids_subq})"))
        db.execute(text("DELETE FROM issues WHERE jira_key LIKE :p"), {"p": f"{KEY_PREFIX}%"})
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


def run_sanitize_with_mock(
    mock: MockJiraClient | None = None,
    *,
    sync_state_id: int | None = None,
) -> dict:
    """Run sanitize with patched JiraClient. If mock is None, no plan attachments
    are expected to be downloaded — we still patch in case there are stragglers."""
    mock = mock or MockJiraClient()
    db = SessionLocal()
    try:
        with patch_jira_client(mock):
            return run_sanitize(db, sync_state_id=sync_state_id)
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


# ---- helpers ---------------------------------------------------------------

import hashlib


def desc_hash(s: str | None) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


# ---- scenarios -------------------------------------------------------------


def scenario_a1_empty():
    """A1: No stories, no attachments → both passes return zeros."""
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("extracted", result["descriptions_extracted"], 0),
        assert_eq("failed", result["descriptions_failed"], 0),
        assert_eq("checked", result["extraction_candidates"], 0),
        assert_eq("skipped", result["extraction_skipped_unsupported"], 0),
        assert_eq("new pending", result["stories_marked_pending"], 0),
        assert_eq("rescored", result["stories_rescored"], 0),
        assert_eq("unchanged", result["stories_unchanged"], 0),
        assert_eq("orphaned", result["orphaned_deleted"], 0),
    ] if e]


def scenario_a2_story_no_attachments():
    """A2: Story with no attachments → no extraction, description preserved."""
    iid = make_issue(f"{KEY_PREFIX}A2", description="from promote")
    result = run_sanitize_with_mock()
    desc = get_description(iid)
    return [e for e in [
        assert_eq("description preserved", desc, "from promote"),
        assert_eq("checked", result["extraction_candidates"], 0),
        assert_eq("new pending", result["stories_marked_pending"], 1),
    ] if e]


def scenario_a3_no_match():
    """A3: Story with attachments but none match → no extraction."""
    iid = make_issue(f"{KEY_PREFIX}A3", description="from promote")
    add_attachment(iid, att_id=f"{ATT_PREFIX}A3-1", filename="screenshot.png")
    add_attachment(iid, att_id=f"{ATT_PREFIX}A3-2", filename="design-doc.md")
    result = run_sanitize_with_mock()
    desc = get_description(iid)
    return [e for e in [
        assert_eq("description preserved", desc, "from promote"),
        assert_eq("checked", result["extraction_candidates"], 0),
    ] if e]


def _extraction_fixture(filename: str, body: bytes) -> tuple[int, MockJiraClient]:
    iid = make_issue(f"{KEY_PREFIX}EXT", description="old")
    url = f"https://verify.example/{filename}"
    add_attachment(iid, att_id=f"{ATT_PREFIX}EXT-1", filename=filename, content_url=url)
    return iid, MockJiraClient({url: body})


def scenario_b1_md():
    """B1: .md plan attachment → description overwritten."""
    iid, mock = _extraction_fixture("implementation-plan.md", b"# plan\n\nstep 1\nstep 2")
    result = run_sanitize_with_mock(mock)
    desc = get_description(iid)
    return [e for e in [
        assert_eq("extracted", result["descriptions_extracted"], 1),
        assert_eq("description", desc, "# plan\n\nstep 1\nstep 2"),
    ] if e]


def scenario_b2_txt():
    """B2: .txt plan attachment → extracts."""
    iid, mock = _extraction_fixture("implementation-plan.txt", b"plain text plan")
    run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("description", get_description(iid), "plain text plan"),
    ] if e]


def scenario_b3_html():
    """B3: .html plan attachment → HTML stripped; <script>/<style> excluded."""
    body = (
        b"<html><head><style>p{color:red}</style></head>"
        b"<body><p>real content</p>"
        b"<script>alert('xss')</script>"
        b"<p>more content</p></body></html>"
    )
    iid, mock = _extraction_fixture("implementation-plan.html", body)
    run_sanitize_with_mock(mock)
    desc = get_description(iid) or ""
    errs = []
    if "real content" not in desc:
        errs.append(f"expected 'real content' in stripped HTML, got {desc!r}")
    if "more content" not in desc:
        errs.append(f"expected 'more content' in stripped HTML, got {desc!r}")
    if "alert" in desc:
        errs.append(f"<script> body should be excluded, got {desc!r}")
    if "color:red" in desc:
        errs.append(f"<style> body should be excluded, got {desc!r}")
    return errs


def scenario_b4_markdown():
    """B4: .markdown extension also extracts."""
    iid, mock = _extraction_fixture("implementation-plan.markdown", b"markdown body")
    run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("description", get_description(iid), "markdown body"),
    ] if e]


def scenario_b5_htm():
    """B5: .htm extension also extracts (HTML path)."""
    iid, mock = _extraction_fixture("implementation-plan.htm", b"<p>htm body</p>")
    run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("description", get_description(iid), "htm body"),
    ] if e]


def scenario_b6_pdf_skipped():
    """B6: .pdf plan attachment → counted as skipped, description preserved."""
    iid = make_issue(f"{KEY_PREFIX}B6", description="from promote")
    add_attachment(iid, att_id=f"{ATT_PREFIX}B6", filename="implementation-plan.pdf")
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("checked", result["extraction_candidates"], 1),
        assert_eq("skipped", result["extraction_skipped_unsupported"], 1),
        assert_eq("extracted", result["descriptions_extracted"], 0),
        assert_eq("description preserved", get_description(iid), "from promote"),
    ] if e]


def scenario_b7_case_insensitive():
    """B7: Filename case differences → still matched (ILIKE)."""
    iid, mock = _extraction_fixture("Implementation-Plan.md", b"case match")
    run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("description", get_description(iid), "case match"),
    ] if e]


def scenario_b8_substring():
    """B8: Filename embedding the substring → matches."""
    iid, mock = _extraction_fixture("v2-implementation-plan-final.md", b"final plan")
    run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("description", get_description(iid), "final plan"),
    ] if e]


def scenario_c1_latest_wins():
    """C1: Two plan attachments, different created_at → latest wins."""
    iid = make_issue(f"{KEY_PREFIX}C1", description="from promote")
    older_url = "https://verify.example/older"
    newer_url = "https://verify.example/newer"
    add_attachment(
        iid, att_id=f"{ATT_PREFIX}C1-old", filename="implementation-plan.md",
        content_url=older_url,
        created_at=datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc),
    )
    add_attachment(
        iid, att_id=f"{ATT_PREFIX}C1-new", filename="implementation-plan.md",
        content_url=newer_url,
        created_at=datetime(2026, 5, 8, 10, 0, tzinfo=timezone.utc),
    )
    mock = MockJiraClient({older_url: b"OLDER", newer_url: b"NEWER"})
    run_sanitize_with_mock(mock)
    errs = [
        assert_eq("description = newer body", get_description(iid), "NEWER"),
    ]
    if older_url in mock.calls:
        errs.append("older attachment should NOT be downloaded (DISTINCT ON picks latest)")
    return [e for e in errs if e]


def scenario_d1_bug_ignored():
    """D1: Bug with plan attachment → not extracted (Stories only)."""
    iid = make_issue(f"{KEY_PREFIX}D1", issue_type="Bug", description="bug body")
    add_attachment(iid, att_id=f"{ATT_PREFIX}D1", filename="implementation-plan.md")
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("checked", result["extraction_candidates"], 0),
        assert_eq("description preserved", get_description(iid), "bug body"),
        assert_eq("no ai_score row created", get_ai_score(iid), None),
    ] if e]


def scenario_d2_epic_ignored():
    """D2: Epic with plan attachment → not extracted, no ai_score row."""
    iid = make_issue(f"{KEY_PREFIX}D2", issue_type="Epic")
    add_attachment(iid, att_id=f"{ATT_PREFIX}D2", filename="implementation-plan.md")
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("checked", result["extraction_candidates"], 0),
        assert_eq("no ai_score row", get_ai_score(iid), None),
    ] if e]


def scenario_e1_download_failure_isolation():
    """E1: One Story's download fails (network), another succeeds → second still extracts."""
    a_iid = make_issue(f"{KEY_PREFIX}E1a", description="A old")
    b_iid = make_issue(f"{KEY_PREFIX}E1b", description="B old")
    a_url = "https://verify.example/E1a"
    b_url = "https://verify.example/E1b"
    add_attachment(a_iid, att_id=f"{ATT_PREFIX}E1a", filename="implementation-plan.md", content_url=a_url)
    add_attachment(b_iid, att_id=f"{ATT_PREFIX}E1b", filename="implementation-plan.md", content_url=b_url)

    mock = MockJiraClient({
        a_url: ConnectionError("simulated network drop"),
        b_url: b"B new",
    })
    result = run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("extracted", result["descriptions_extracted"], 1),
        assert_eq("failed", result["descriptions_failed"], 1),
        assert_eq("A description preserved", get_description(a_iid), "A old"),
        assert_eq("B description updated", get_description(b_iid), "B new"),
    ] if e]


def scenario_e2_binary_noise_via_replace():
    """E2: Binary noise in a .txt → still extracts via UTF-8 errors='replace'."""
    iid, mock = _extraction_fixture("implementation-plan.txt", b"good\xff\xfemore")
    run_sanitize_with_mock(mock)
    desc = get_description(iid) or ""
    if "good" not in desc or "more" not in desc:
        return [f"expected fragments preserved with replacement chars, got {desc!r}"]
    return []


def scenario_g1_first_time_with_description():
    """G1: First-time reconcile — Story with description gets one new pending row."""
    iid = make_issue(f"{KEY_PREFIX}G1", description="hello")
    result = run_sanitize_with_mock()
    score = get_ai_score(iid)
    return [e for e in [
        assert_eq("new pending", result["stories_marked_pending"], 1),
        assert_eq("status", score["scoring_status"], "pending"),
        assert_eq("hash", score["description_hash"], desc_hash("hello")),
    ] if e]


def scenario_g2_first_time_null_description():
    """G2: First-time reconcile — Story with NULL description hashes empty string."""
    iid = make_issue(f"{KEY_PREFIX}G2", description=None)
    run_sanitize_with_mock()
    score = get_ai_score(iid)
    return [e for e in [
        assert_eq("hash = SHA-256('')", score["description_hash"], desc_hash("")),
    ] if e]


def scenario_g4_only_stories_get_rows():
    """G4: Bug / Task / Epic do not get issue_ai_scores rows."""
    s_iid = make_issue(f"{KEY_PREFIX}G4-S", issue_type="Story")
    b_iid = make_issue(f"{KEY_PREFIX}G4-B", issue_type="Bug")
    e_iid = make_issue(f"{KEY_PREFIX}G4-E", issue_type="Epic")
    t_iid = make_issue(f"{KEY_PREFIX}G4-T", issue_type="Task")
    run_sanitize_with_mock()
    return [e for e in [
        assert_eq("Story has score row", get_ai_score(s_iid) is not None, True),
        assert_eq("Bug has no score row", get_ai_score(b_iid), None),
        assert_eq("Epic has no score row", get_ai_score(e_iid), None),
        assert_eq("Task has no score row", get_ai_score(t_iid), None),
    ] if e]


def scenario_h1_unchanged():
    """H1: Re-sanitize, description hash matches existing → unchanged, status preserved."""
    iid = make_issue(f"{KEY_PREFIX}H1", description="stable")
    insert_ai_score(iid, description_hash=desc_hash("stable"), status="pending")
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("unchanged", result["stories_unchanged"], 1),
        assert_eq("new pending", result["stories_marked_pending"], 0),
        assert_eq("rescored", result["stories_rescored"], 0),
    ] if e]


def scenario_h2_rescored():
    """H2: Description changed since last sanitize → row reset to pending, scoring fields nulled."""
    iid = make_issue(f"{KEY_PREFIX}H2", description="new content")
    # Pre-existing scored row with a different hash
    insert_ai_score(
        iid,
        description_hash=desc_hash("old content"),
        status="completed",
        scored_outputs=True,
    )
    result = run_sanitize_with_mock()
    score = get_ai_score(iid)
    return [e for e in [
        assert_eq("rescored", result["stories_rescored"], 1),
        assert_eq("status", score["scoring_status"], "pending"),
        assert_eq("hash refreshed", score["description_hash"], desc_hash("new content")),
        assert_eq("description_quality_score nulled", score["description_quality_score"], None),
        assert_eq("ai_plan_detected nulled", score["ai_plan_detected"], None),
        assert_eq("skill_name nulled", score["skill_name"], None),
        assert_eq("model_used nulled", score["model_used"], None),
        assert_eq("scored_at nulled", score["scored_at"], None),
    ] if e]


def scenario_h3_completed_unchanged():
    """H3: Already completed, hash still matches → status='completed' preserved."""
    iid = make_issue(f"{KEY_PREFIX}H3", description="frozen")
    insert_ai_score(
        iid,
        description_hash=desc_hash("frozen"),
        status="completed",
        scored_outputs=True,
    )
    result = run_sanitize_with_mock()
    score = get_ai_score(iid)
    return [e for e in [
        assert_eq("unchanged", result["stories_unchanged"], 1),
        assert_eq("status preserved", score["scoring_status"], "completed"),
        assert_eq("scored_at preserved (not None)", score["scored_at"] is not None, True),
        assert_eq("skill_name preserved", score["skill_name"], "Python"),
    ] if e]


def scenario_h4_pass1_rewrites_then_pass2_resets():
    """H4: A completed Story whose plan attachment changed → Pass 1 rewrites
    description → Pass 2 sees hash change → row reset to pending."""
    iid = make_issue(f"{KEY_PREFIX}H4", description="STALE")
    insert_ai_score(
        iid,
        description_hash=desc_hash("STALE"),
        status="completed",
        scored_outputs=True,
    )
    url = "https://verify.example/H4"
    add_attachment(iid, att_id=f"{ATT_PREFIX}H4", filename="implementation-plan.md", content_url=url)
    mock = MockJiraClient({url: b"FRESH plan body"})
    result = run_sanitize_with_mock(mock)
    score = get_ai_score(iid)
    return [e for e in [
        assert_eq("description overwritten by Pass 1", get_description(iid), "FRESH plan body"),
        assert_eq("rescored count", result["stories_rescored"], 1),
        assert_eq("status reset", score["scoring_status"], "pending"),
        assert_eq("hash refreshed", score["description_hash"], desc_hash("FRESH plan body")),
        assert_eq("scored_at nulled", score["scored_at"], None),
        assert_eq("description_quality_score nulled", score["description_quality_score"], None),
    ] if e]


def scenario_h_orphan_deletion():
    """H-orphan: A pre-existing issue_ai_scores row whose issue is no longer
    a Story → row deleted, counted as orphaned_deleted."""
    iid = make_issue(f"{KEY_PREFIX}HORPH", issue_type="Bug", description="now a bug")
    insert_ai_score(iid, description_hash=desc_hash("when it was a story"), status="completed", scored_outputs=True)
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("orphaned_deleted", result["orphaned_deleted"], 1),
        assert_eq("ai_score row gone", get_ai_score(iid), None),
        assert_eq("Story counts unaffected: new pending", result["stories_marked_pending"], 0),
        assert_eq("unchanged", result["stories_unchanged"], 0),
    ] if e]


def scenario_i1_mixed_counts():
    """I1: One run with one new + one unchanged + one rescored Story → counts correct."""
    new_iid = make_issue(f"{KEY_PREFIX}I1-new", description="new desc")
    unchanged_iid = make_issue(f"{KEY_PREFIX}I1-unchanged", description="unchanged desc")
    insert_ai_score(unchanged_iid, description_hash=desc_hash("unchanged desc"), status="pending")
    rescored_iid = make_issue(f"{KEY_PREFIX}I1-rescored", description="updated desc")
    insert_ai_score(rescored_iid, description_hash=desc_hash("old desc"), status="completed", scored_outputs=True)
    result = run_sanitize_with_mock()
    return [e for e in [
        assert_eq("new pending", result["stories_marked_pending"], 1),
        assert_eq("unchanged", result["stories_unchanged"], 1),
        assert_eq("rescored", result["stories_rescored"], 1),
        assert_eq("orphaned", result["orphaned_deleted"], 0),
    ] if e]


def scenario_j1_phase_rows_with_sync_state():
    """J1: When sync_state_id is provided, both phase rows are recorded."""
    sid = make_sync_state()
    iid = make_issue(f"{KEY_PREFIX}J1", description="phase test")
    url = "https://verify.example/J1"
    add_attachment(iid, att_id=f"{ATT_PREFIX}J1", filename="implementation-plan.md", content_url=url)
    mock = MockJiraClient({url: b"phase body"})

    db = SessionLocal()
    try:
        with patch_jira_client(mock):
            run_sanitize(db, sync_state_id=sid)
    finally:
        db.close()

    phases = get_phases(sid)
    phase_names = sorted(p["phase"] for p in phases)
    extracting = next((p for p in phases if p["phase"] == "extracting"), None)
    reconciling = next((p for p in phases if p["phase"] == "reconciling"), None)
    errs = [
        assert_eq("phase names", phase_names, ["extracting", "reconciling"]),
    ]
    if extracting is None:
        errs.append("missing 'extracting' phase row")
    else:
        errs += [
            assert_eq("extracting.status", extracting["status"], "success"),
            assert_eq("extracting.metrics.extracted", (extracting["metrics"] or {}).get("extracted"), 1),
        ]
    if reconciling is None:
        errs.append("missing 'reconciling' phase row")
    else:
        errs += [
            assert_eq("reconciling.status", reconciling["status"], "success"),
            assert_eq("reconciling.metrics.new_pending", (reconciling["metrics"] or {}).get("new_pending"), 1),
        ]
    return [e for e in errs if e]


def scenario_j2_no_phase_rows_without_sync_state():
    """J2: Without sync_state_id, no phase rows are created."""
    iid = make_issue(f"{KEY_PREFIX}J2", description="no phase")
    add_attachment(iid, att_id=f"{ATT_PREFIX}J2", filename="implementation-plan.md")
    # Mock returns nothing relevant — extraction will fail (no canned URL),
    # but that's fine; we only care about phase rows here.
    mock = MockJiraClient()
    run_sanitize_with_mock(mock)
    db = SessionLocal()
    try:
        cnt = db.execute(
            text(
                "SELECT COUNT(*) FROM sync_phases WHERE sync_state_id IN "
                "(SELECT id FROM sync_state WHERE triggered_by = :tb)"
            ),
            {"tb": TRIGGERED_BY},
        ).scalar_one()
    finally:
        db.close()
    return [assert_eq("no phase rows", cnt, 0)] if cnt else []


# ---- Group M: Pass 1 caching guard + Flow-2 idempotence -------------------


def scenario_m1_cache_guard_prevents_redownload():
    """M1: After a successful extraction, a second sanitize must NOT re-download.
    The mock's call list size stays at 1; result reports `extraction_skipped_cached=1`."""
    iid = make_issue(f"{KEY_PREFIX}M1", description="from promote")
    url = "https://verify.example/M1"
    add_attachment(iid, att_id=f"{ATT_PREFIX}M1", filename="implementation-plan.md", content_url=url)

    mock = MockJiraClient({url: b"plan body v1"})
    first = run_sanitize_with_mock(mock)
    second = run_sanitize_with_mock(mock)

    db = SessionLocal()
    try:
        att_extracted_at = db.execute(
            text("SELECT extracted_at FROM attachments WHERE jira_attachment_id = :a"),
            {"a": f"{ATT_PREFIX}M1"},
        ).scalar_one()
    finally:
        db.close()

    return [e for e in [
        assert_eq("first run extracted", first["descriptions_extracted"], 1),
        assert_eq("first run not cached", first["extraction_skipped_cached"], 0),
        assert_eq("second run extracted=0", second["descriptions_extracted"], 0),
        assert_eq("second run skipped_cached=1", second["extraction_skipped_cached"], 1),
        assert_eq("download called only once", len(mock.calls), 1),
        assert_eq("description after both runs", get_description(iid), "plan body v1"),
        assert_eq("attachment.extracted_at populated", att_extracted_at is not None, True),
    ] if e]


def scenario_m2_cache_invalidates_on_newer_attachment():
    """M2: After first sanitize, a *newer* plan attachment is uploaded → second
    sanitize re-downloads the new one (different att id, extracted_at NULL),
    description is overwritten with the new content."""
    iid = make_issue(f"{KEY_PREFIX}M2", description="from promote")
    old_url = "https://verify.example/M2-old"
    new_url = "https://verify.example/M2-new"
    add_attachment(
        iid,
        att_id=f"{ATT_PREFIX}M2-old",
        filename="implementation-plan.md",
        content_url=old_url,
        created_at=datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc),
    )

    mock = MockJiraClient({old_url: b"OLD", new_url: b"NEW"})
    run_sanitize_with_mock(mock)
    # New plan attachment uploaded later
    add_attachment(
        iid,
        att_id=f"{ATT_PREFIX}M2-new",
        filename="implementation-plan.md",
        content_url=new_url,
        created_at=datetime(2026, 5, 8, 10, 0, tzinfo=timezone.utc),
    )
    second = run_sanitize_with_mock(mock)

    return [e for e in [
        assert_eq("description = NEW after second run", get_description(iid), "NEW"),
        assert_eq("second run extracted=1", second["descriptions_extracted"], 1),
        assert_eq("second run skipped_cached=0", second["extraction_skipped_cached"], 0),
        assert_eq("downloads (old then new)", mock.calls, [old_url, new_url]),
    ] if e]


def scenario_m3_full_noop_resanitize():
    """M3: Two consecutive sanitizes with no changes anywhere → second run is a
    full no-op: zero downloads, zero ai_score writes, all unchanged."""
    s1 = make_issue(f"{KEY_PREFIX}M3-1", description="alpha")
    s2 = make_issue(f"{KEY_PREFIX}M3-2", description="beta")
    url = "https://verify.example/M3"
    add_attachment(s1, att_id=f"{ATT_PREFIX}M3", filename="implementation-plan.md", content_url=url)
    mock = MockJiraClient({url: b"plan-driven content"})

    first = run_sanitize_with_mock(mock)
    calls_after_first = list(mock.calls)
    second = run_sanitize_with_mock(mock)

    return [e for e in [
        assert_eq("first: extracted=1", first["descriptions_extracted"], 1),
        assert_eq("first: new pending=2", first["stories_marked_pending"], 2),
        assert_eq("second: no extraction", second["descriptions_extracted"], 0),
        assert_eq("second: skipped_cached=1", second["extraction_skipped_cached"], 1),
        assert_eq("second: stories_unchanged=2", second["stories_unchanged"], 2),
        assert_eq("second: stories_marked_pending=0", second["stories_marked_pending"], 0),
        assert_eq("second: stories_rescored=0", second["stories_rescored"], 0),
        assert_eq("no extra downloads on second run", mock.calls, calls_after_first),
    ] if e]


def scenario_m4_stickiness_when_attachment_removed():
    """M4: Plan attachment renamed away from `implementation-plan*` between
    sanitizes → second run has nothing to extract; description from first
    sanitize is preserved (Pass 1 leaves it alone)."""
    iid = make_issue(f"{KEY_PREFIX}M4", description="from promote")
    url = "https://verify.example/M4"
    att_id = f"{ATT_PREFIX}M4"
    add_attachment(iid, att_id=att_id, filename="implementation-plan.md", content_url=url)
    mock = MockJiraClient({url: b"sticky content"})
    run_sanitize_with_mock(mock)

    # Operator renames file in Jira; on next sync our row is updated to a
    # filename that no longer matches the pattern.
    db = SessionLocal()
    try:
        db.execute(
            text("UPDATE attachments SET filename = :f WHERE jira_attachment_id = :a"),
            {"f": "renamed-doc.md", "a": att_id},
        )
        db.commit()
    finally:
        db.close()

    second = run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("description preserved (sticky)", get_description(iid), "sticky content"),
        assert_eq("second: candidates=0", second["extraction_candidates"], 0),
        assert_eq("second: extracted=0", second["descriptions_extracted"], 0),
        assert_eq("second: stories_unchanged=1", second["stories_unchanged"], 1),
        assert_eq("download called only once total", len(mock.calls), 1),
    ] if e]


def scenario_m5_force_reextract_by_clearing_extracted_at():
    """M5: Operator override — clearing `extracted_at` to NULL forces a
    re-download on the next sanitize."""
    iid = make_issue(f"{KEY_PREFIX}M5", description="from promote")
    url = "https://verify.example/M5"
    att_id = f"{ATT_PREFIX}M5"
    add_attachment(iid, att_id=att_id, filename="implementation-plan.md", content_url=url)
    mock = MockJiraClient({url: b"first body"})
    run_sanitize_with_mock(mock)

    # Operator clears extracted_at; mock returns NEW body now
    db = SessionLocal()
    try:
        db.execute(
            text("UPDATE attachments SET extracted_at = NULL WHERE jira_attachment_id = :a"),
            {"a": att_id},
        )
        db.commit()
    finally:
        db.close()
    mock.downloads[url] = b"refreshed body"

    second = run_sanitize_with_mock(mock)
    return [e for e in [
        assert_eq("second: extracted=1", second["descriptions_extracted"], 1),
        assert_eq("second: skipped_cached=0", second["extraction_skipped_cached"], 0),
        assert_eq("description refreshed", get_description(iid), "refreshed body"),
        assert_eq("download called twice", len(mock.calls), 2),
    ] if e]


# ---- main ------------------------------------------------------------------


def main():
    scenarios = [
        ("A1: empty DB, both passes no-op", scenario_a1_empty),
        ("A2: Story with no attachments", scenario_a2_story_no_attachments),
        ("A3: Story with non-matching attachments", scenario_a3_no_match),
        ("B1: .md plan attachment → extracts", scenario_b1_md),
        ("B2: .txt plan attachment → extracts", scenario_b2_txt),
        ("B3: .html plan attachment → script/style stripped", scenario_b3_html),
        ("B4: .markdown extension supported", scenario_b4_markdown),
        ("B5: .htm extension supported", scenario_b5_htm),
        ("B6: .pdf plan attachment → skipped, description preserved", scenario_b6_pdf_skipped),
        ("B7: filename case-insensitive (ILIKE)", scenario_b7_case_insensitive),
        ("B8: 'implementation-plan' as substring", scenario_b8_substring),
        ("C1: latest plan attachment wins (DISTINCT ON)", scenario_c1_latest_wins),
        ("D1: Bug ignored (only Stories extract)", scenario_d1_bug_ignored),
        ("D2: Epic ignored", scenario_d2_epic_ignored),
        ("E1: download failure on one issue, other still extracts", scenario_e1_download_failure_isolation),
        ("E2: binary noise via UTF-8 errors='replace'", scenario_e2_binary_noise_via_replace),
        ("G1: first-time reconcile, Story with description", scenario_g1_first_time_with_description),
        ("G2: first-time reconcile, Story with NULL description", scenario_g2_first_time_null_description),
        ("G4: only Stories get issue_ai_scores rows", scenario_g4_only_stories_get_rows),
        ("H1: re-sanitize, hash unchanged → unchanged", scenario_h1_unchanged),
        ("H2: re-sanitize, hash changed → rescored, fields nulled", scenario_h2_rescored),
        ("H3: completed Story, hash unchanged → status preserved", scenario_h3_completed_unchanged),
        ("H4: Pass 1 rewrites desc → Pass 2 resets to pending", scenario_h4_pass1_rewrites_then_pass2_resets),
        ("H-orphan: Story-turned-Bug → ai_score row deleted", scenario_h_orphan_deletion),
        ("I1: mixed batch — counts correct", scenario_i1_mixed_counts),
        ("J1: sync_state_id → extracting + reconciling phase rows", scenario_j1_phase_rows_with_sync_state),
        ("J2: no sync_state_id → no phase rows", scenario_j2_no_phase_rows_without_sync_state),
        ("M1: cache guard prevents re-download on second run", scenario_m1_cache_guard_prevents_redownload),
        ("M2: cache invalidates when newer plan attachment shows up", scenario_m2_cache_invalidates_on_newer_attachment),
        ("M3: full no-op re-sanitize (idempotent stable state)", scenario_m3_full_noop_resanitize),
        ("M4: stickiness — plan attachment renamed away leaves description intact", scenario_m4_stickiness_when_attachment_removed),
        ("M5: force re-extract by clearing extracted_at", scenario_m5_force_reextract_by_clearing_extracted_at),
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
