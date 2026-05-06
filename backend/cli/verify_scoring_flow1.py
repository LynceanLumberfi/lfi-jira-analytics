"""Verification harness for the scoring CLI / service (Step 4).

Each scenario:
  1. Wipes any prior `VERIFY-SC1-*` rows across issues, ai_scores, failed_records.
  2. Seeds Issue + `issue_ai_scores` rows with `scoring_status='pending'`.
  3. Patches `scoring_service._load_agent` (so the test doesn't depend on the
     real agent markdown's frontmatter) and `scoring_service.subprocess.run`
     to return a canned `CompletedProcess` (or raise a canned exception).
  4. Calls `score_pending(db, ...)`.
  5. Asserts the row state, summary counts, and (where relevant) the
     `failed_records` audit trail.

Uses jira_keys prefixed `VERIFY-SC1-` and `triggered_by='verify-scoring-flow1'`
(the latter for any reaper / state rows we exercise).

Run: ../.jira-analytics/bin/python backend/cli/verify_scoring_flow1.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import traceback
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

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
from app.models import Issue, IssueAIScore  # noqa: E402
from app.services import scoring_service  # noqa: E402
from app.services.scoring_service import (  # noqa: E402
    ScoringRateLimitedError,
    score_pending,
)


KEY_PREFIX = "VERIFY-SC1-"
TRIGGERED_BY = "verify-scoring-flow1"


# ---- subprocess / agent mocks ---------------------------------------------


class FakeCompletedProcess:
    """Minimal stand-in for subprocess.CompletedProcess that _invoke_claude reads."""

    def __init__(self, *, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def make_cli_json(
    *,
    quality_score: float | int = 4.0,
    ai_score: int = 3,
    skill_name: str | None = "BE_Skill",
    quality_reason: str = "Clean structure with numbered steps.",
    ai_reason: str = "Plain prose with no LLM artifacts.",
    input_tokens: int = 1500,
    output_tokens: int = 300,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 500,
    total_cost_usd: float = 0.0034,
    is_error: bool = False,
    error_text: str | None = None,
) -> str:
    """Build a JSON string mimicking the claude CLI's `--output-format json` output."""
    result_payload = {
        "quality_score": quality_score,
        "ai_score": ai_score,
        "skill_name": skill_name,
        "quality_reason": quality_reason,
        "ai_reason": ai_reason,
    }
    body: dict = {
        "is_error": is_error,
        "result": json.dumps(result_payload) if not is_error else (error_text or "agent error"),
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_creation_input_tokens": cache_creation_input_tokens,
            "cache_read_input_tokens": cache_read_input_tokens,
        },
        "total_cost_usd": total_cost_usd,
    }
    if is_error:
        body["error"] = error_text or "agent error"
    return json.dumps(body)


@contextmanager
def patch_subprocess_run(fake_run):
    """Monkeypatch the subprocess.run used by scoring_service._invoke_claude."""
    original = scoring_service.subprocess.run
    scoring_service.subprocess.run = fake_run
    try:
        yield
    finally:
        scoring_service.subprocess.run = original


@contextmanager
def patch_load_agent(
    *, body: str = "agent body", tools: list[str] | None = None, model: str | None = None
):
    """Stub _load_agent so the harness doesn't depend on the real agent markdown."""
    original = scoring_service._load_agent
    scoring_service._load_agent = lambda: (body, tools or [], model)
    try:
        yield
    finally:
        scoring_service._load_agent = original


def make_fake_run(json_string: str, *, returncode: int = 0, stderr: str = ""):
    """Return a `subprocess.run` replacement that always returns the canned response."""

    def _run(*_args, **_kwargs):
        return FakeCompletedProcess(returncode=returncode, stdout=json_string, stderr=stderr)

    return _run


def make_counting_fake_run(json_string: str):
    """Like make_fake_run but tracks how many times it was called."""
    state = {"calls": 0}

    def _run(*_args, **_kwargs):
        state["calls"] += 1
        return FakeCompletedProcess(returncode=0, stdout=json_string)

    _run.state = state  # type: ignore[attr-defined]
    return _run


def make_rate_limited_run(*, raise_on_call: int = 1):
    """Return a `subprocess.run` replacement that returns a rate-limit error on
    the Nth call (1-indexed) and successful JSON on every other call."""
    state = {"calls": 0}

    def _run(*_args, **_kwargs):
        state["calls"] += 1
        if state["calls"] == raise_on_call:
            return FakeCompletedProcess(
                returncode=1,
                stdout="",
                stderr="Claude usage limit reached. Try again in 4 hours.",
            )
        return FakeCompletedProcess(returncode=0, stdout=make_cli_json())

    _run.state = state  # type: ignore[attr-defined]
    return _run


def make_timeout_run(timeout_secs: int = 600):
    """Return a `subprocess.run` replacement that raises TimeoutExpired."""

    def _run(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd=["claude"], timeout=timeout_secs)

    return _run


def make_file_not_found_run():
    """Return a `subprocess.run` replacement that raises FileNotFoundError
    (simulates `claude` not being on PATH)."""

    def _run(*_args, **_kwargs):
        raise FileNotFoundError(2, "No such file or directory: 'claude'")

    return _run


# ---- DB helpers ------------------------------------------------------------


def make_pending_story(
    jira_key: str,
    *,
    description: str | None = "Implement the dashboard query for team metrics.",
    issue_type: str = "Story",
) -> tuple[int, int]:
    """Insert an Issue + a pending IssueAIScore row. Returns (issue_id, score_id)."""
    db = SessionLocal()
    try:
        issue = Issue(
            jira_key=jira_key,
            project="VERIFY",
            issue_type=issue_type,
            summary=f"summary for {jira_key}",
            description=description,
        )
        db.add(issue)
        db.commit()
        db.refresh(issue)
        db.execute(
            text(
                "INSERT INTO issue_ai_scores (issue_id, scoring_status) "
                "VALUES (:i, 'pending') RETURNING id"
            ),
            {"i": issue.id},
        )
        db.commit()
        score_id = db.execute(
            text("SELECT id FROM issue_ai_scores WHERE issue_id = :i"),
            {"i": issue.id},
        ).scalar_one()
        return issue.id, int(score_id)
    finally:
        db.close()


def set_score_status(issue_id: int, status: str) -> None:
    """Directly mutate scoring_status for setup of preconditions."""
    db = SessionLocal()
    try:
        db.execute(
            text(
                "UPDATE issue_ai_scores SET scoring_status = :s WHERE issue_id = :i"
            ),
            {"s": status, "i": issue_id},
        )
        db.commit()
    finally:
        db.close()


def get_score(issue_id: int) -> dict | None:
    db = SessionLocal()
    try:
        row = db.execute(
            text(
                """
                SELECT scoring_status, description_hash, description_quality_score,
                       ai_score, ai_plan_detected, skill_name, skill_usage_detected,
                       scoring_notes, model_used, scored_at,
                       input_tokens, output_tokens, cache_read_tokens,
                       total_cost_usd, error_message, raw_response
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


def reset_verify_data() -> None:
    db = SessionLocal()
    try:
        ids_subq = f"SELECT id FROM issues WHERE jira_key LIKE '{KEY_PREFIX}%'"
        db.execute(text(f"DELETE FROM issue_ai_scores WHERE issue_id IN ({ids_subq})"))
        db.execute(text(f"DELETE FROM issue_metrics WHERE issue_id IN ({ids_subq})"))
        db.execute(
            text(
                f"DELETE FROM failed_records WHERE jira_ref LIKE :p "
                f"OR sync_state_id IN (SELECT id FROM sync_state WHERE triggered_by = :tb)"
            ),
            {"p": f"{KEY_PREFIX}%", "tb": TRIGGERED_BY},
        )
        db.execute(text(f"DELETE FROM issues WHERE jira_key LIKE :p"), {"p": f"{KEY_PREFIX}%"})
        db.execute(text(f"DELETE FROM sync_state WHERE triggered_by = :tb"), {"tb": TRIGGERED_BY})
        db.commit()
    finally:
        db.close()


def run_score(**kwargs) -> object:
    db = SessionLocal()
    try:
        return score_pending(db, **kwargs)
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


def scenario_a1_no_pending():
    """A1: No pending rows → no-op summary; no CLI call."""
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)
    return [e for e in [
        assert_eq("attempted", summary.attempted, 0),
        assert_eq("scored", summary.scored, 0),
        assert_eq("failed", summary.failed, 0),
        assert_eq("no CLI calls", fake_run.state["calls"], 0),
    ] if e]


def scenario_a2_single_story_happy_path():
    """A2: Single Story with description → CLI call → completed; all fields populated."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}A2", description="hello world plan")
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("attempted", summary.attempted, 1),
        assert_eq("scored", summary.scored, 1),
        assert_eq("CLI called once", fake_run.state["calls"], 1),
        assert_eq("status", sc["scoring_status"], "completed"),
        assert_eq("ai_score column", sc["ai_score"], 3),
        assert_eq("ai_plan_detected", sc["ai_plan_detected"], True),
        assert_eq("skill_name", sc["skill_name"], "BE_Skill"),
        assert_eq("skill_usage_detected", sc["skill_usage_detected"], True),
        assert_eq("scored_at set", sc["scored_at"] is not None, True),
        assert_eq("total_cost_usd set",
                  sc["total_cost_usd"] is not None and float(sc["total_cost_usd"]) > 0, True),
        assert_eq("input_tokens (input+cache_creation)",
                  sc["input_tokens"], 1500),
        assert_eq("output_tokens", sc["output_tokens"], 300),
        assert_eq("cache_read_tokens", sc["cache_read_tokens"], 500),
    ] if e]


def scenario_b1_null_description():
    """B1: Story with NULL description → short-circuit, no CLI call, completed/zeros."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}B1", description=None)
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("no_description count", summary.no_description, 1),
        assert_eq("no CLI calls", fake_run.state["calls"], 0),
        assert_eq("status", sc["scoring_status"], "completed"),
        assert_eq("ai_score", sc["ai_score"], 0),
        assert_eq("ai_plan_detected", sc["ai_plan_detected"], False),
        assert_eq("skill_name", sc["skill_name"], None),
        assert_eq("input_tokens=0", sc["input_tokens"], 0),
        assert_eq("output_tokens=0", sc["output_tokens"], 0),
        assert_eq("total_cost_usd=0", float(sc["total_cost_usd"]), 0.0),
    ] if e]


def scenario_b2_whitespace_description():
    """B2: Story with whitespace-only description → same as B1."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}B2", description="   \n  ")
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("no_description count", summary.no_description, 1),
        assert_eq("no CLI calls", fake_run.state["calls"], 0),
        assert_eq("status", sc["scoring_status"], "completed"),
    ] if e]


def scenario_c1_high_ai_score_flips_plan_detected():
    """C1: ai_score=5 → ai_plan_detected=True."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}C1", description="d")
    with patch_load_agent(), patch_subprocess_run(
        make_fake_run(make_cli_json(ai_score=5))
    ):
        run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("ai_score", sc["ai_score"], 5),
        assert_eq("ai_plan_detected", sc["ai_plan_detected"], True),
    ] if e]


def scenario_c2_low_ai_score():
    """C2: ai_score=1 → ai_plan_detected=False."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}C2", description="d")
    with patch_load_agent(), patch_subprocess_run(
        make_fake_run(make_cli_json(ai_score=1))
    ):
        run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("ai_score", sc["ai_score"], 1),
        assert_eq("ai_plan_detected", sc["ai_plan_detected"], False),
    ] if e]


def scenario_c3_null_skill_name():
    """C3: skill_name=null → skill_usage_detected=False."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}C3", description="d")
    with patch_load_agent(), patch_subprocess_run(
        make_fake_run(make_cli_json(skill_name=None))
    ):
        run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("skill_name", sc["skill_name"], None),
        assert_eq("skill_usage_detected", sc["skill_usage_detected"], False),
        assert_eq("status", sc["scoring_status"], "completed"),
    ] if e]


def _scenario_parse_failure(jira_key: str, json_string: str):
    """Shared body for D-group parse-failure scenarios."""
    iid, _ = make_pending_story(jira_key, description="d")
    with patch_load_agent(), patch_subprocess_run(
        make_fake_run(json_string)
    ):
        summary = run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("failed count", summary.failed, 1),
        assert_eq("scored count", summary.scored, 0),
        assert_eq("status", sc["scoring_status"], "failed"),
        assert_eq("error_message set", bool(sc["error_message"]), True),
        assert_eq("failed_records row created",
                  count("failed_records", "jira_ref = :k", {"k": jira_key}), 1),
    ] if e]


def scenario_d1_missing_quality_key():
    """D1: response JSON missing `quality_score` → row failed."""
    body = json.dumps(
        {"is_error": False,
         "result": json.dumps({"ai_score": 3, "skill_name": None}),
         "usage": {"input_tokens": 0, "output_tokens": 0},
         "total_cost_usd": 0}
    )
    return _scenario_parse_failure(f"{KEY_PREFIX}D1", body)


def scenario_d2_quality_out_of_range():
    """D2: quality_score=7 (outside 0-5) → row failed."""
    return _scenario_parse_failure(
        f"{KEY_PREFIX}D2", make_cli_json(quality_score=7)
    )


def scenario_d3_ai_score_wrong_type():
    """D3: ai_score as a string ("3" not 3) → row failed."""
    body = json.dumps(
        {"is_error": False,
         "result": json.dumps({"quality_score": 4, "ai_score": "3"}),
         "usage": {"input_tokens": 0, "output_tokens": 0},
         "total_cost_usd": 0}
    )
    return _scenario_parse_failure(f"{KEY_PREFIX}D3", body)


def scenario_d4_invalid_skill_name():
    """D4: skill_name='Foo' (not in allowed set) → row failed."""
    return _scenario_parse_failure(
        f"{KEY_PREFIX}D4", make_cli_json(skill_name="Foo")
    )


def scenario_d5_no_json_in_response():
    """D5: agent emits plain prose with no JSON object → row failed (regex finds nothing)."""
    body = json.dumps(
        {"is_error": False,
         "result": "I cannot score this issue right now.",
         "usage": {"input_tokens": 0, "output_tokens": 0},
         "total_cost_usd": 0}
    )
    return _scenario_parse_failure(f"{KEY_PREFIX}D5", body)


def scenario_e1_cli_not_found():
    """E1: `claude` not on PATH → FileNotFoundError → RuntimeError → row failed."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}E1", description="d")
    with patch_load_agent(), patch_subprocess_run(make_file_not_found_run()):
        summary = run_score(limit=10)
    sc = get_score(iid)
    return [e for e in [
        assert_eq("failed count", summary.failed, 1),
        assert_eq("status", sc["scoring_status"], "failed"),
        assert_eq("error_message mentions claude CLI",
                  ("claude" in (sc["error_message"] or "").lower()), True),
    ] if e]


def scenario_e2_cli_nonzero_exit_non_rate_limit():
    """E2: CLI exits non-zero with a generic error → row failed; not classified as RATE_LIMITED."""
    from app.models import FailedRecord

    jira_key = f"{KEY_PREFIX}E2"
    iid, _ = make_pending_story(jira_key, description="d")
    fake_run = lambda *a, **kw: FakeCompletedProcess(  # noqa: E731
        returncode=1, stdout="", stderr="some unrelated agent crash, exit 1"
    )
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)
    sc = get_score(iid)
    err_code = (
        SessionLocal()
        .execute(text("SELECT error_code FROM failed_records WHERE jira_ref = :k"), {"k": jira_key})
        .scalar_one()
    )
    return [e for e in [
        assert_eq("failed count", summary.failed, 1),
        assert_eq("status", sc["scoring_status"], "failed"),
        assert_eq("error_code != RATE_LIMITED", err_code != FailedRecord.CODE_RATE_LIMITED, True),
    ] if e]


def scenario_e3_timeout():
    """E3: subprocess.TimeoutExpired → row failed with error_code=TIMEOUT in failed_records."""
    from app.models import FailedRecord

    jira_key = f"{KEY_PREFIX}E3"
    iid, _ = make_pending_story(jira_key, description="d")
    with patch_load_agent(), patch_subprocess_run(make_timeout_run()):
        summary = run_score(limit=10)
    sc = get_score(iid)
    err_code = (
        SessionLocal()
        .execute(text("SELECT error_code FROM failed_records WHERE jira_ref = :k"), {"k": jira_key})
        .scalar_one()
    )
    return [e for e in [
        assert_eq("failed", summary.failed, 1),
        assert_eq("status", sc["scoring_status"], "failed"),
        assert_eq("error_code=TIMEOUT", err_code, FailedRecord.CODE_TIMEOUT),
    ] if e]


def scenario_e4_rate_limit_bail_first_call():
    """E4: rate-limit on the first claude call → row 1 fails, rows 2/3 returned to
    `pending`, batch bails. failed_records.error_code=RATE_LIMITED."""
    from app.models import FailedRecord

    keys = [f"{KEY_PREFIX}E4-{n}" for n in range(1, 4)]
    issue_ids = [make_pending_story(k, description=f"d-{k}")[0] for k in keys]

    fake_run = make_rate_limited_run(raise_on_call=1)
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)

    statuses = {iid: get_score(iid)["scoring_status"] for iid in issue_ids}
    err_code = (
        SessionLocal()
        .execute(text("SELECT error_code FROM failed_records WHERE jira_ref = :k"), {"k": keys[0]})
        .scalar_one_or_none()
    )
    return [e for e in [
        assert_eq("attempted", summary.attempted, 1),
        assert_eq("failed", summary.failed, 1),
        assert_eq("CLI called only once", fake_run.state["calls"], 1),
        assert_eq("row 1 → failed", statuses[issue_ids[0]], "failed"),
        assert_eq("row 2 → pending (released)", statuses[issue_ids[1]], "pending"),
        assert_eq("row 3 → pending (released)", statuses[issue_ids[2]], "pending"),
        assert_eq("error_code=RATE_LIMITED", err_code, FailedRecord.CODE_RATE_LIMITED),
    ] if e]


def scenario_e5_rate_limit_bail_second_call():
    """E5: first claude call succeeds; second is rate-limited → 1 completed, 1 failed,
    row 3 returned to `pending`."""
    keys = [f"{KEY_PREFIX}E5-{n}" for n in range(1, 4)]
    issue_ids = [make_pending_story(k, description=f"d-{k}")[0] for k in keys]
    fake_run = make_rate_limited_run(raise_on_call=2)
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10)
    statuses = {iid: get_score(iid)["scoring_status"] for iid in issue_ids}
    return [e for e in [
        assert_eq("scored", summary.scored, 1),
        assert_eq("failed", summary.failed, 1),
        assert_eq("attempted", summary.attempted, 2),
        assert_eq("CLI calls", fake_run.state["calls"], 2),
        assert_eq("row 1 → completed", statuses[issue_ids[0]], "completed"),
        assert_eq("row 2 → failed", statuses[issue_ids[1]], "failed"),
        assert_eq("row 3 → pending (released)", statuses[issue_ids[2]], "pending"),
    ] if e]


def scenario_g1_limit_honored():
    """G1: 5 pending, limit=2 → 2 scored; remaining 3 stay pending."""
    keys = [f"{KEY_PREFIX}G1-{n}" for n in range(1, 6)]
    issue_ids = [make_pending_story(k, description=f"d-{k}")[0] for k in keys]
    with patch_load_agent(), patch_subprocess_run(make_fake_run(make_cli_json())):
        summary = run_score(limit=2)
    pending_remaining = count(
        "issue_ai_scores",
        "scoring_status = 'pending' AND issue_id = ANY(:ids)",
        {"ids": issue_ids},
    )
    return [e for e in [
        assert_eq("scored", summary.scored, 2),
        assert_eq("remaining pending", pending_remaining, 3),
    ] if e]


def scenario_g2_order_by_issue_id():
    """G2: Multiple pending Stories → claim+score in `issues.id` order."""
    keys = [f"{KEY_PREFIX}G2-{n}" for n in (3, 1, 2)]  # arbitrary insert order
    issue_ids = [make_pending_story(k, description=f"d-{k}")[0] for k in keys]

    seen_keys: list[str] = []

    def fake_run(*_args, **_kwargs):
        # Reconstruct the jira_key from the prompt to verify ordering
        prompt = _kwargs.get("input") or ""
        # _invoke_claude doesn't pass input= to subprocess.run; we instead
        # rely on capturing the order via DB state after the run.
        return FakeCompletedProcess(returncode=0, stdout=make_cli_json())

    with patch_load_agent(), patch_subprocess_run(fake_run):
        run_score(limit=10)

    # All three should be completed.
    statuses = [get_score(iid)["scoring_status"] for iid in issue_ids]

    # Verify the *claim* picked rows in id-ascending order by checking
    # scored_at increases with issue id.
    scored_ats = [
        (iid, get_score(iid)["scored_at"]) for iid in sorted(issue_ids)
    ]
    monotonic = all(
        scored_ats[i][1] <= scored_ats[i + 1][1]
        for i in range(len(scored_ats) - 1)
    )

    return [e for e in [
        assert_eq("all completed", statuses, ["completed"] * 3),
        assert_eq("scored_at non-decreasing with issue.id", monotonic, True),
    ] if e]


def scenario_g3_non_story_types_ignored():
    """G3: Bug / Epic / Task pending rows are NOT claimed (only Stories scored)."""
    iid_story, _ = make_pending_story(f"{KEY_PREFIX}G3-story", description="d")
    iid_bug, _ = make_pending_story(f"{KEY_PREFIX}G3-bug", description="d", issue_type="Bug")
    iid_epic, _ = make_pending_story(f"{KEY_PREFIX}G3-epic", description="d", issue_type="Epic")
    iid_task, _ = make_pending_story(f"{KEY_PREFIX}G3-task", description="d", issue_type="Task")
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=50)
    return [e for e in [
        assert_eq("scored count = 1 (only Story)", summary.scored, 1),
        assert_eq("CLI called once", fake_run.state["calls"], 1),
        assert_eq("Story → completed", get_score(iid_story)["scoring_status"], "completed"),
        assert_eq("Bug → pending", get_score(iid_bug)["scoring_status"], "pending"),
        assert_eq("Epic → pending", get_score(iid_epic)["scoring_status"], "pending"),
        assert_eq("Task → pending", get_score(iid_task)["scoring_status"], "pending"),
    ] if e]


def scenario_h1_model_precedence_cli_arg_wins():
    """H1: model resolution — explicit `model=` arg wins over env over agent frontmatter."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}H1", description="d")
    seen_models: list[str | None] = []
    real_run = scoring_service.subprocess.run

    def fake_run(cmd, *_args, **_kwargs):
        # cmd is the argv list. Find the --model arg if present.
        m = None
        if "--model" in cmd:
            m = cmd[cmd.index("--model") + 1]
        seen_models.append(m)
        return FakeCompletedProcess(returncode=0, stdout=make_cli_json())

    # Reset env so we can manipulate it cleanly.
    prior_env = os.environ.pop("CLAUDE_MODEL", None)
    prior_default = scoring_service._DEFAULT_MODEL
    scoring_service._DEFAULT_MODEL = None  # simulate no env
    try:
        # 1) Agent frontmatter only → that's what the CLI gets
        with patch_load_agent(model="agent-frontmatter-model"), patch_subprocess_run(fake_run):
            run_score(limit=10)
        set_score_status(iid, "pending")  # reset for next call
        # 2) Env set → env wins over frontmatter
        scoring_service._DEFAULT_MODEL = "env-model"
        with patch_load_agent(model="agent-frontmatter-model"), patch_subprocess_run(fake_run):
            run_score(limit=10)
        set_score_status(iid, "pending")
        # 3) Explicit arg → arg wins over both
        with patch_load_agent(model="agent-frontmatter-model"), patch_subprocess_run(fake_run):
            run_score(limit=10, model="cli-arg-model")
    finally:
        scoring_service._DEFAULT_MODEL = prior_default
        if prior_env is not None:
            os.environ["CLAUDE_MODEL"] = prior_env
        scoring_service.subprocess.run = real_run

    return [e for e in [
        assert_eq("3 invocations", len(seen_models), 3),
        assert_eq("(1) frontmatter only", seen_models[0], "agent-frontmatter-model"),
        assert_eq("(2) env overrides frontmatter", seen_models[1], "env-model"),
        assert_eq("(3) explicit arg overrides env", seen_models[2], "cli-arg-model"),
    ] if e]


def scenario_i1_dry_run_no_writes_no_calls():
    """I1: dry_run=True → no CLI calls, no DB writes; rows stay `pending`."""
    keys = [f"{KEY_PREFIX}I1-{n}" for n in (1, 2)]
    issue_ids = [make_pending_story(k, description=f"d-{k}")[0] for k in keys]
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10, dry_run=True)
    statuses = [get_score(iid)["scoring_status"] for iid in issue_ids]
    return [e for e in [
        assert_eq("attempted", summary.attempted, 2),
        assert_eq("scored", summary.scored, 0),
        assert_eq("no CLI calls", fake_run.state["calls"], 0),
        assert_eq("both rows still pending", statuses, ["pending", "pending"]),
    ] if e]


def scenario_i2_dry_run_counts_no_description():
    """I2: dry_run with one Story without description + one with → no_description counted."""
    iid_nd, _ = make_pending_story(f"{KEY_PREFIX}I2-nd", description=None)
    iid_ok, _ = make_pending_story(f"{KEY_PREFIX}I2-ok", description="has it")
    fake_run = make_counting_fake_run(make_cli_json())
    with patch_load_agent(), patch_subprocess_run(fake_run):
        summary = run_score(limit=10, dry_run=True)
    return [e for e in [
        assert_eq("attempted", summary.attempted, 2),
        assert_eq("no_description", summary.no_description, 1),
        assert_eq("no CLI calls", fake_run.state["calls"], 0),
        assert_eq("ok-row stays pending", get_score(iid_ok)["scoring_status"], "pending"),
        assert_eq("nd-row stays pending", get_score(iid_nd)["scoring_status"], "pending"),
    ] if e]


def scenario_k1_phase_tracking():
    """K1: When `sync_state_id` is provided, score_pending opens a `scoring`
    phase row, ticks per row, and closes it with `{scored, failed, no_description}`."""
    from app.models import SyncState
    from app.services.scoring_service import score_pending

    keys = [f"{KEY_PREFIX}K1-{n}" for n in range(1, 3)]
    issue_ids = [make_pending_story(k, description=f"d-{k}")[0] for k in keys]

    db = SessionLocal()
    try:
        state = SyncState(triggered_by=TRIGGERED_BY, status=SyncState.STATUS_RUNNING)
        db.add(state); db.commit(); db.refresh(state)
        sid = state.id
    finally:
        db.close()

    with patch_load_agent(), patch_subprocess_run(make_fake_run(make_cli_json())):
        db = SessionLocal()
        try:
            score_pending(db, limit=10, sync_state_id=sid)
        finally:
            db.close()

    db = SessionLocal()
    try:
        phase = db.execute(
            text(
                "SELECT phase, status, items_total, items_processed, metrics "
                "FROM sync_phases WHERE sync_state_id = :s AND phase = 'scoring'"
            ),
            {"s": sid},
        ).one_or_none()
    finally:
        db.close()
    if phase is None:
        return ["scoring phase row not created"]
    p, status, total, processed, metrics = phase
    return [e for e in [
        assert_eq("phase name", p, "scoring"),
        assert_eq("status", status, "success"),
        assert_eq("items_total", total, 2),
        assert_eq("items_processed", processed, 2),
        assert_eq("metrics.scored", (metrics or {}).get("scored"), 2),
        assert_eq("metrics.failed", (metrics or {}).get("failed"), 0),
    ] if e]


def scenario_j1_reaper_resets_stale_in_progress():
    """J1: A row stuck in `in_progress` whose joined issue.synced_at is older than
    the 60-min threshold is reset back to `pending` at the top of score_pending."""
    iid, _ = make_pending_story(f"{KEY_PREFIX}J1", description="d")
    # Force the row to in_progress AND backdate the issue's synced_at past the threshold.
    db = SessionLocal()
    try:
        db.execute(
            text("UPDATE issue_ai_scores SET scoring_status = 'in_progress' WHERE issue_id = :i"),
            {"i": iid},
        )
        db.execute(
            text("UPDATE issues SET synced_at = now() - interval '2 hours' WHERE id = :i"),
            {"i": iid},
        )
        db.commit()
    finally:
        db.close()

    # Call score_pending — the reaper should reset, the claim should pick it up,
    # the happy path should complete it.
    with patch_load_agent(), patch_subprocess_run(make_fake_run(make_cli_json())):
        summary = run_score(limit=10)

    sc = get_score(iid)
    return [e for e in [
        assert_eq("scored", summary.scored, 1),
        assert_eq("final status", sc["scoring_status"], "completed"),
    ] if e]


# ---- main ------------------------------------------------------------------


def _abort_if_stray_pending_stories() -> None:
    """The scoring claim is global (no prefix filter — that's the point of the
    test). Any pending Story-typed `issue_ai_scores` row sitting around in the
    DB outside the VERIFY-SC1 prefix will be picked up by `_claim_pending` and
    pollute scenarios that assert counts. Bail loudly so the operator can
    clean up rather than chasing a flaky test."""
    db = SessionLocal()
    try:
        rows = db.execute(
            text(
                """
                SELECT i.jira_key
                  FROM issue_ai_scores s
                  JOIN issues i ON i.id = s.issue_id
                 WHERE s.scoring_status IN ('pending', 'in_progress')
                   AND lower(coalesce(i.issue_type, '')) = 'story'
                   AND i.jira_key NOT LIKE :p
                """
            ),
            {"p": f"{KEY_PREFIX}%"},
        ).all()
    finally:
        db.close()
    if rows:
        keys = ", ".join(r[0] for r in rows)
        print(
            "\nABORT: stray pending/in_progress Story ai_score rows in the DB:\n"
            f"  {keys}\n"
            "These would be claimed by the global `_claim_pending` and pollute "
            "scenario assertions (e.g. G1 limit-honored). Clean them up and re-run:\n"
            "  DELETE FROM issue_ai_scores WHERE issue_id IN (SELECT id FROM issues "
            "WHERE jira_key IN (...)); -- or fix the source\n",
            file=sys.stderr,
        )
        sys.exit(2)


def main():
    _abort_if_stray_pending_stories()
    scenarios = [
        ("A1: no pending rows → no-op, no CLI call", scenario_a1_no_pending),
        ("A2: single Story happy path → completed + all fields populated", scenario_a2_single_story_happy_path),
        ("B1: NULL description → short-circuit completed, no CLI call", scenario_b1_null_description),
        ("B2: whitespace-only description → short-circuit", scenario_b2_whitespace_description),
        ("C1: ai_score=5 → ai_plan_detected=True", scenario_c1_high_ai_score_flips_plan_detected),
        ("C2: ai_score=1 → ai_plan_detected=False", scenario_c2_low_ai_score),
        ("C3: skill_name=null → skill_usage_detected=False", scenario_c3_null_skill_name),
        ("D1: response missing quality_score key → failed", scenario_d1_missing_quality_key),
        ("D2: quality_score out of 0-5 range → failed", scenario_d2_quality_out_of_range),
        ("D3: ai_score wrong type (string) → failed", scenario_d3_ai_score_wrong_type),
        ("D4: invalid skill_name → failed", scenario_d4_invalid_skill_name),
        ("D5: response with no JSON object → failed", scenario_d5_no_json_in_response),
        ("E1: claude CLI not on PATH → failed", scenario_e1_cli_not_found),
        ("E2: CLI nonzero exit (non-rate-limit) → failed, not RATE_LIMITED", scenario_e2_cli_nonzero_exit_non_rate_limit),
        ("E3: TimeoutExpired → failed_records.error_code=TIMEOUT", scenario_e3_timeout),
        ("E4: rate-limit on first call → bail, remaining released", scenario_e4_rate_limit_bail_first_call),
        ("E5: rate-limit on second call → 1 completed, 1 failed, rest released", scenario_e5_rate_limit_bail_second_call),
        ("G1: limit=2 honored, remaining 3 stay pending", scenario_g1_limit_honored),
        ("G2: claim orders by issues.id ascending", scenario_g2_order_by_issue_id),
        ("G3: Bug/Epic/Task ignored (Stories only)", scenario_g3_non_story_types_ignored),
        ("H1: model precedence (cli arg > env > agent frontmatter)", scenario_h1_model_precedence_cli_arg_wins),
        ("I1: dry-run → no DB writes, no CLI calls, rows stay pending", scenario_i1_dry_run_no_writes_no_calls),
        ("I2: dry-run counts no_description correctly", scenario_i2_dry_run_counts_no_description),
        ("K1: sync_state_id → scoring phase recorded with metrics", scenario_k1_phase_tracking),
        ("J1: stale in_progress reset by reaper before claim", scenario_j1_reaper_resets_stale_in_progress),
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
