"""AI scoring pipeline. Reads pending Story-type issues from `issue_ai_scores`,
invokes the `jira-analyzer` Claude Code agent via the `claude` CLI subprocess,
parses the JSON response, and writes scores back to the same row.

No Anthropic API key is required — the subprocess uses your Claude Code session.

The agent definition lives at `<project_root>/.claude/agents/jira-analyzer.md`
and reads the fingerprint files at `backend/resources/fingerprints/`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Issue, IssueAIScore
from app.services.failure_service import record_failure

logger = logging.getLogger(__name__)


_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PROJECT_ROOT = _BACKEND_DIR.parent
_AGENT_FILE = _PROJECT_ROOT / ".claude" / "agents" / "jira-analyzer.md"
_DEFAULT_MODEL = os.environ.get("CLAUDE_MODEL")  # None -> let claude CLI pick
_DEFAULT_TIMEOUT = int(os.environ.get("SCORING_TIMEOUT_SECS", "600"))
_SCORED_ISSUE_TYPES = {"story"}
_STALE_IN_PROGRESS_MINUTES = 60

# Stories with story_points <= this threshold are too small to be worth an AI
# scoring call — they're excluded at claim time and `sanitize_service` deletes
# their issue_ai_scores rows so they never become pending. NULL story_points
# remain eligible (the agent's T1 tier handles unestimated stories).
MIN_STORY_POINTS_FOR_SCORING = 0.25

# Only Stories in one of these workflow statuses are eligible for scoring.
# Sanitize deletes rows for any other status so analytics only reflects
# completed work; NULL status is not eligible.
ELIGIBLE_SCORING_STATUSES: tuple[str, ...] = ("Done", "Deployed")

# Pattern-match for subscription rate-limit signals from the `claude` CLI.
# We don't have an API key, so we don't get HTTP 429 — instead the CLI exits
# non-zero with a message in stderr (or returns `is_error` in JSON). On a
# Claude Pro / Max subscription, exceeding the 5-hour message cap mid-batch
# is the most likely failure mode.
_RATE_LIMIT_PATTERN = re.compile(
    r"(usage limit|rate[\s\-]?limit|too many requests|quota|try again in)",
    re.IGNORECASE,
)


class ScoringRateLimitedError(RuntimeError):
    """The `claude` CLI reported a usage / rate limit. The batch should stop
    and remaining `in_progress` rows should be released back to `pending`."""


def _looks_rate_limited(text: str | None) -> bool:
    if not text:
        return False
    return bool(_RATE_LIMIT_PATTERN.search(text))


# ---------- public types ----------


@dataclass
class ScoreSummary:
    attempted: int = 0
    scored: int = 0
    no_description: int = 0
    failed: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    total_cost_usd: float = 0.0


# ---------- agent file ----------


def _strip_frontmatter(content: str) -> tuple[str, str]:
    stripped = content.lstrip()
    if not stripped.startswith("---"):
        return "", content
    end = stripped.find("\n---", 3)
    if end == -1:
        return "", content
    return stripped[3:end].strip(), stripped[end + 4:].lstrip()


def _parse_tools_from_frontmatter(frontmatter: str) -> list[str]:
    tools: list[str] = []
    in_tools = False
    for line in frontmatter.splitlines():
        if line.strip().startswith("tools:"):
            in_tools = True
            continue
        if in_tools:
            stripped = line.strip()
            if stripped.startswith("- "):
                tools.append(stripped[2:].strip())
            elif stripped and not stripped.startswith("#"):
                break
    return tools


def _parse_model_from_frontmatter(frontmatter: str) -> str | None:
    for line in frontmatter.splitlines():
        s = line.strip()
        if s.startswith("model:"):
            return s.split(":", 1)[1].strip().strip('"').strip("'")
    return None


def _load_agent() -> tuple[str, list[str], str | None]:
    """Return (instructions_body, allowed_tools, model)."""
    if not _AGENT_FILE.exists():
        raise FileNotFoundError(f"Agent file not found: {_AGENT_FILE}")
    raw = _AGENT_FILE.read_text(encoding="utf-8")
    frontmatter, body = _strip_frontmatter(raw)
    return body, _parse_tools_from_frontmatter(frontmatter), _parse_model_from_frontmatter(frontmatter)


# ---------- claude CLI invocation ----------


@dataclass
class _CliResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    total_cost_usd: float = 0.0


def _invoke_claude(
    *,
    agent_body: str,
    allowed_tools: list[str],
    user_prompt: str,
    model: str | None,
    timeout: int,
) -> _CliResult:
    full_prompt = f"{agent_body}\n\n---\n\n{user_prompt}"
    cmd = ["claude", "-p", full_prompt, "--output-format", "json"]
    if model:
        cmd.extend(["--model", model])
    if allowed_tools:
        cmd.extend(["--allowedTools", ",".join(allowed_tools)])

    logger.debug("invoking claude CLI (model=%s, tools=%s)", model or "default", allowed_tools)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(_PROJECT_ROOT),
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "'claude' CLI not found on PATH. Install Claude Code first."
        ) from exc

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        stdout = (proc.stdout or "").strip()
        combined = f"{stderr}\n{stdout}"
        if _looks_rate_limited(combined):
            raise ScoringRateLimitedError(
                f"claude CLI hit a usage / rate limit: {stderr[:500] or stdout[:500]}"
            )
        raise RuntimeError(
            f"claude CLI exited {proc.returncode}: {stderr[:500] or stdout[:500]}"
        )

    return _parse_cli_output(proc.stdout)


def _parse_cli_output(stdout: str) -> _CliResult:
    stripped = stdout.strip()
    if not stripped:
        raise ValueError("claude CLI returned empty output")
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ValueError(f"claude CLI output is not JSON: {stripped[:200]!r}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"claude CLI output is not an object: {type(data).__name__}")

    if data.get("is_error"):
        err_text = str(data.get("error") or data.get("result") or "unknown")
        if _looks_rate_limited(err_text):
            raise ScoringRateLimitedError(
                f"claude CLI hit a usage / rate limit: {err_text[:500]}"
            )
        raise RuntimeError(f"agent reported error: {err_text}")

    text = data.get("result") or data.get("text") or ""
    if not isinstance(text, str):
        text = str(text)

    usage = data.get("usage") or {}
    return _CliResult(
        text=text,
        input_tokens=int(usage.get("input_tokens", 0) or 0),
        output_tokens=int(usage.get("output_tokens", 0) or 0),
        cache_creation_input_tokens=int(usage.get("cache_creation_input_tokens", 0) or 0),
        cache_read_input_tokens=int(usage.get("cache_read_input_tokens", 0) or 0),
        total_cost_usd=float(data.get("total_cost_usd", 0.0) or 0.0),
    )


# ---------- response parsing ----------


_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


_ALLOWED_SKILL_NAMES = {"BE_Skill", "FE_Skill", "APP_Skill"}


def _parse_score_json(text: str) -> dict[str, Any]:
    match = _JSON_BLOCK.search(text)
    if match is None:
        raise ValueError(f"No JSON object in agent response: {text[:200]!r}")
    obj = json.loads(match.group(0))
    for key in ("quality_score", "ai_score"):
        if key not in obj:
            raise ValueError(f"Missing key {key!r} in response: {obj}")
        if not isinstance(obj[key], (int, float)):
            raise ValueError(f"{key} must be numeric: {obj[key]!r}")
        if not 0 <= obj[key] <= 5:
            raise ValueError(f"{key} out of range 0–5: {obj[key]!r}")
    if "skill_name" in obj:
        skill = obj["skill_name"]
        if skill is not None and skill not in _ALLOWED_SKILL_NAMES:
            raise ValueError(
                f"skill_name must be null or one of {sorted(_ALLOWED_SKILL_NAMES)}: {skill!r}"
            )
    else:
        obj["skill_name"] = None
    return obj


# ---------- DB selection / writeback ----------


def _reap_stale_in_progress(
    db: Session, *, threshold_minutes: int = _STALE_IN_PROGRESS_MINUTES
) -> int:
    """Reset rows stuck in `in_progress` back to `pending`.

    Process kills mid-claude-call leave the row claimed forever; this is the
    cheap recovery (no separate reaper service, no heartbeat). Runs once at
    the top of `score_pending`. We don't have an `in_progress_at` timestamp,
    so the heuristic is: an `in_progress` row whose joined `issues.synced_at`
    is older than `threshold_minutes` is considered stale. In practice the
    backend lifespan starts cleanly after a restart, so any leftover claim is
    older than the next sync touching the same issue.
    """
    reaped = db.execute(
        text(
            """
            UPDATE issue_ai_scores
               SET scoring_status = 'pending'
             WHERE scoring_status = 'in_progress'
               AND scored_at IS NULL
               AND issue_id IN (
                   SELECT i.id FROM issues i
                    WHERE i.synced_at < now() - make_interval(mins => :mins)
               )
            """
        ),
        {"mins": threshold_minutes},
    ).rowcount or 0
    if reaped:
        db.commit()
        logger.warning("scoring reaper: reset %d stale in_progress rows", reaped)
    return reaped


def _claim_pending(db: Session, limit: int) -> list[tuple[Issue, IssueAIScore]]:
    """Atomically claim up to `limit` pending Story-type rows by flipping them
    to `in_progress` in a single SELECT FOR UPDATE SKIP LOCKED + UPDATE…
    RETURNING. Two workers running concurrently get disjoint sets."""
    claimed_ids = [
        row[0]
        for row in db.execute(
            text(
                """
                UPDATE issue_ai_scores
                   SET scoring_status = 'in_progress'
                 WHERE id IN (
                     SELECT s.id
                       FROM issue_ai_scores s
                       JOIN issues i ON i.id = s.issue_id
                       LEFT JOIN LATERAL (
                           SELECT sp.end_date
                             FROM issue_sprints iss
                             JOIN sprints sp ON sp.id = iss.sprint_id
                            WHERE iss.issue_id = i.id AND sp.end_date IS NOT NULL
                            ORDER BY sp.end_date DESC
                            LIMIT 1
                       ) ls ON TRUE
                      WHERE s.scoring_status = 'pending'
                        AND lower(coalesce(i.issue_type, '')) = ANY(:types)
                        AND coalesce(i.summary, '') !~* '^\\[\\s*qa(\\s|\\]|:|-|$)'
                        AND (i.story_points IS NULL OR i.story_points > :min_sp)
                        AND i.status = ANY(:statuses)
                      ORDER BY ls.end_date DESC NULLS LAST,
                               i.updated_at DESC NULLS LAST,
                               i.id DESC
                      LIMIT :limit
                      FOR UPDATE OF s SKIP LOCKED
                 )
                RETURNING id
                """
            ),
            {
                "limit": limit,
                "types": list(_SCORED_ISSUE_TYPES),
                "min_sp": MIN_STORY_POINTS_FOR_SCORING,
                "statuses": list(ELIGIBLE_SCORING_STATUSES),
            },
        ).all()
    ]
    db.commit()
    if not claimed_ids:
        return []
    # Re-fetch ordered by latest sprint end_date so the in-batch processing
    # order matches the claim order (newest sprint first).
    rows = db.execute(
        text(
            """
            SELECT i.id AS issue_id, s.id AS score_id, ls.end_date AS sprint_end
              FROM issue_ai_scores s
              JOIN issues i ON i.id = s.issue_id
              LEFT JOIN LATERAL (
                  SELECT sp.end_date
                    FROM issue_sprints iss
                    JOIN sprints sp ON sp.id = iss.sprint_id
                   WHERE iss.issue_id = i.id AND sp.end_date IS NOT NULL
                   ORDER BY sp.end_date DESC
                   LIMIT 1
              ) ls ON TRUE
             WHERE s.id = ANY(:ids)
             ORDER BY ls.end_date DESC NULLS LAST,
                      i.updated_at DESC NULLS LAST,
                      i.id DESC
            """
        ),
        {"ids": claimed_ids},
    ).all()
    ordered_score_ids = [r.score_id for r in rows]
    issues_by_id = {
        i.id: i for i in db.execute(select(Issue).where(Issue.id.in_([r.issue_id for r in rows]))).scalars()
    }
    scores_by_id = {
        s.id: s for s in db.execute(select(IssueAIScore).where(IssueAIScore.id.in_(ordered_score_ids))).scalars()
    }
    return [
        (issues_by_id[r.issue_id], scores_by_id[r.score_id])
        for r in rows
        if r.issue_id in issues_by_id and r.score_id in scores_by_id
    ]


def _release_claims(db: Session, score_rows: list[IssueAIScore]) -> None:
    """Revert an in-progress claim back to pending. Used by the dry-run path."""
    ids = [r.id for r in score_rows]
    if not ids:
        return
    db.execute(
        text(
            "UPDATE issue_ai_scores SET scoring_status='pending' "
            "WHERE id = ANY(:ids) AND scoring_status='in_progress'"
        ),
        {"ids": ids},
    )
    db.commit()


def _description_hash(text: str | None) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _has_description(text: str | None) -> bool:
    return bool(text and text.strip())


def _build_user_prompt(issue: Issue) -> str:
    plain = (issue.description or "").strip()
    payload = {
        "issue_key": issue.jira_key,
        "issue_type": issue.issue_type,
        "summary": issue.summary,
        "story_points": float(issue.story_points) if issue.story_points is not None else None,
        "has_description": _has_description(plain),
        "description_plain": plain,
        # description_raw matches description_plain because we persist plain text only
        # on issues; raw ADF lives in description_adf if present but is not used by
        # the fingerprint rules in this codebase.
        "description_raw": plain,
    }
    return (
        "Score the following Jira issue. Read the fingerprint files first, "
        "then return only the JSON object specified in the agent instructions.\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )


def _write_score(
    *,
    score_row: IssueAIScore,
    parsed: dict[str, Any],
    description: str | None,
    model: str | None,
    cli_result: _CliResult,
    raw_text: str,
) -> None:
    score_row.description_hash = _description_hash(description)
    score_row.description_quality_score = Decimal(str(parsed["quality_score"]))
    ai_score_int = int(parsed["ai_score"])
    score_row.ai_score = ai_score_int
    score_row.ai_plan_detected = ai_score_int >= 3
    skill = parsed.get("skill_name")
    score_row.skill_name = skill
    score_row.skill_usage_detected = skill is not None
    notes = []
    if parsed.get("quality_reason"):
        notes.append(f"quality: {parsed['quality_reason']}")
    if parsed.get("ai_reason"):
        notes.append(f"ai: {parsed['ai_reason']}")
    score_row.scoring_notes = " | ".join(notes) or None
    score_row.scoring_status = "completed"
    score_row.model_used = model or "claude-cli"
    score_row.scored_at = datetime.now(timezone.utc)
    # Schema has no dedicated cache_creation_tokens column; fold into input_tokens.
    score_row.input_tokens = cli_result.input_tokens + cli_result.cache_creation_input_tokens
    score_row.output_tokens = cli_result.output_tokens
    score_row.cache_read_tokens = cli_result.cache_read_input_tokens
    score_row.total_cost_usd = Decimal(str(cli_result.total_cost_usd))
    score_row.raw_response = {
        "parsed": parsed,
        "raw_text": raw_text[:8000],
        "ai_score_numeric": ai_score_int,
        "total_cost_usd": cli_result.total_cost_usd,
    }
    score_row.error_message = None


def _mark_no_description(*, score_row: IssueAIScore, description: str | None) -> None:
    score_row.description_hash = _description_hash(description)
    score_row.description_quality_score = Decimal("0.0")
    score_row.ai_score = 0
    score_row.ai_plan_detected = False
    score_row.skill_name = None
    score_row.skill_usage_detected = False
    score_row.scoring_notes = "quality: No description. | ai: No description."
    score_row.scoring_status = "completed"
    score_row.model_used = None
    score_row.scored_at = datetime.now(timezone.utc)
    score_row.input_tokens = 0
    score_row.output_tokens = 0
    score_row.cache_read_tokens = 0
    score_row.total_cost_usd = Decimal("0")
    score_row.raw_response = {"reason": "no_description"}
    score_row.error_message = None


# ---------- public entry point ----------


RESCORE_MODEL = "claude-sonnet-4-6"


def score_single(db: Session, issue: Issue, *, timeout: int | None = None) -> IssueAIScore:
    """Synchronously score a single issue. Bypasses batch eligibility filters
    and the scoring_lock. Always uses RESCORE_MODEL so batch defaults are untouched.
    Creates the IssueAIScore row if missing. Returns the updated row. Raises on
    failure — caller maps exceptions to HTTP errors."""
    # Atomically flip any non-in_progress status to in_progress (per-issue lock).
    updated_id = db.execute(
        text(
            """
            UPDATE issue_ai_scores
               SET scoring_status = 'in_progress'
             WHERE issue_id = :issue_id
               AND scoring_status != 'in_progress'
            RETURNING id
            """
        ),
        {"issue_id": issue.id},
    ).scalar_one_or_none()
    db.commit()

    if updated_id is None:
        existing = db.query(IssueAIScore).filter(IssueAIScore.issue_id == issue.id).one_or_none()
        if existing is not None:
            raise RuntimeError(f"Issue {issue.jira_key} is already being scored")
        score_row = IssueAIScore(issue_id=issue.id, scoring_status="in_progress")
        db.add(score_row)
        db.commit()
        db.refresh(score_row)
    else:
        score_row = db.get(IssueAIScore, updated_id)

    try:
        if not _has_description(issue.description):
            _mark_no_description(score_row=score_row, description=issue.description)
            db.commit()
            return score_row

        agent_body, allowed_tools, _ = _load_agent()
        timeout_secs = timeout or _DEFAULT_TIMEOUT
        user_prompt = _build_user_prompt(issue)
        cli_result = _invoke_claude(
            agent_body=agent_body,
            allowed_tools=allowed_tools,
            user_prompt=user_prompt,
            model=RESCORE_MODEL,
            timeout=timeout_secs,
        )
        parsed = _parse_score_json(cli_result.text)
        _write_score(
            score_row=score_row,
            parsed=parsed,
            description=issue.description,
            model=RESCORE_MODEL,
            cli_result=cli_result,
            raw_text=cli_result.text,
        )
        db.commit()
        return score_row
    except ScoringRateLimitedError as exc:
        db.rollback()
        score_row = db.get(IssueAIScore, score_row.id)
        score_row.scoring_status = "failed"
        score_row.error_message = f"{type(exc).__name__}: {exc}"[:4000]
        db.commit()
        raise
    except Exception as exc:
        logger.exception("single rescore failed jira_key=%s", issue.jira_key)
        db.rollback()
        score_row = db.get(IssueAIScore, score_row.id)
        score_row.scoring_status = "failed"
        score_row.error_message = f"{type(exc).__name__}: {exc}"[:4000]
        db.commit()
        record_failure(
            db,
            phase="score",
            entity="issue",
            title=f"Rescore failed: {issue.jira_key}",
            exc=exc,
            jira_ref=issue.jira_key,
        )
        raise


def score_pending(
    db: Session,
    *,
    limit: int = 200,
    model: str | None = None,
    dry_run: bool = False,
    timeout: int | None = None,
    progress: Any = None,
    sync_state_id: int | None = None,
) -> ScoreSummary:
    """Score up to `limit` pending Story-type issues. One claude CLI call per
    issue. Failures are recorded in `failed_records` and flip
    `issue_ai_scores.scoring_status` to 'failed'.

    When `sync_state_id` is provided, opens a `scoring` phase row, ticks
    `items_processed` per row, and closes it with `{scored, failed, no_description}`
    metrics. The API endpoint creates a sync_state and passes its id so the
    UI can poll progress at `GET /api/sync/state/{id}`.
    """
    from app.models.sync_phase import SyncPhase
    from app.services.phase_service import close_phase, open_phase, tick

    summary = ScoreSummary()
    _reap_stale_in_progress(db)
    rows = _claim_pending(db, limit)
    if not rows:
        logger.info("scoring: no pending Story-type issues")
        if sync_state_id is not None:
            phase = open_phase(db, sync_state_id, SyncPhase.PHASE_SCORING)
            phase.items_total = 0
            db.commit()
            close_phase(db, phase, metrics={"scored": 0, "failed": 0, "no_description": 0})
        return summary

    agent_body, allowed_tools, agent_model = _load_agent()
    chosen_model = model or _DEFAULT_MODEL or agent_model
    timeout_secs = timeout or _DEFAULT_TIMEOUT

    phase = None
    if sync_state_id is not None:
        phase = open_phase(db, sync_state_id, SyncPhase.PHASE_SCORING)
        phase.items_total = len(rows)
        db.commit()

    if dry_run:
        for issue, _ in rows:
            summary.attempted += 1
            if not _has_description(issue.description):
                summary.no_description += 1
            if progress is not None:
                progress(issue, status="dry-run")
        # Release the in_progress claims so a real run can pick them up later.
        _release_claims(db, [s for _, s in rows])
        if phase is not None:
            close_phase(
                db,
                phase,
                metrics={"scored": 0, "failed": 0, "no_description": summary.no_description, "dry_run": True},
            )
        return summary

    from app.models.failed_record import FailedRecord

    processed = 0
    try:
        for idx, (issue, score_row) in enumerate(rows):
            summary.attempted += 1

            if not _has_description(issue.description):
                _mark_no_description(score_row=score_row, description=issue.description)
                db.commit()
                summary.no_description += 1
                summary.scored += 1
                if progress is not None:
                    progress(issue, status="no-description")
                processed += 1
                if phase is not None:
                    tick(db, phase, processed=processed)
                continue

            try:
                user_prompt = _build_user_prompt(issue)
                cli_result = _invoke_claude(
                    agent_body=agent_body,
                    allowed_tools=allowed_tools,
                    user_prompt=user_prompt,
                    model=chosen_model,
                    timeout=timeout_secs,
                )
                parsed = _parse_score_json(cli_result.text)
                _write_score(
                    score_row=score_row,
                    parsed=parsed,
                    description=issue.description,
                    model=chosen_model,
                    cli_result=cli_result,
                    raw_text=cli_result.text,
                )
                db.commit()
                summary.scored += 1
                summary.input_tokens += cli_result.input_tokens + cli_result.cache_creation_input_tokens
                summary.output_tokens += cli_result.output_tokens
                summary.cache_read_tokens += cli_result.cache_read_input_tokens
                summary.total_cost_usd += cli_result.total_cost_usd
                if progress is not None:
                    progress(issue, status="scored", parsed=parsed, cost=cli_result.total_cost_usd)
            except ScoringRateLimitedError as exc:
                # Subscription rate limit — record this row's failure, release
                # any still-claimed rows back to `pending`, and stop the batch.
                logger.warning(
                    "scoring: rate-limited mid-batch on jira_key=%s; aborting batch",
                    issue.jira_key,
                )
                db.rollback()
                score_row = db.get(IssueAIScore, score_row.id)
                if score_row is not None:
                    score_row.scoring_status = "failed"
                    score_row.error_message = f"{type(exc).__name__}: {exc}"[:4000]
                    db.commit()
                record_failure(
                    db,
                    phase="score",
                    entity="issue",
                    title=f"Score rate-limited: {issue.jira_key}",
                    exc=exc,
                    jira_ref=issue.jira_key,
                    error_code=FailedRecord.CODE_RATE_LIMITED,
                )
                summary.failed += 1
                if progress is not None:
                    progress(issue, status="failed", error=f"rate-limited: {exc}")
                remaining_claims = [s for _, s in rows[idx + 1:]]
                if remaining_claims:
                    _release_claims(db, remaining_claims)
                    logger.warning(
                        "scoring: released %d unattempted rows back to pending",
                        len(remaining_claims),
                    )
                processed += 1
                if phase is not None:
                    tick(db, phase, processed=processed)
                break
            except Exception as exc:  # noqa: BLE001 — record any other failure
                logger.exception("score failed jira_key=%s", issue.jira_key)
                db.rollback()
                score_row = db.get(IssueAIScore, score_row.id)
                if score_row is not None:
                    score_row.scoring_status = "failed"
                    score_row.error_message = f"{type(exc).__name__}: {exc}"[:4000]
                    db.commit()
                record_failure(
                    db,
                    phase="score",
                    entity="issue",
                    title=f"Score failed: {issue.jira_key}",
                    exc=exc,
                    jira_ref=issue.jira_key,
                )
                summary.failed += 1
                if progress is not None:
                    progress(issue, status="failed", error=str(exc))

            processed += 1
            if phase is not None:
                tick(db, phase, processed=processed)
    finally:
        if phase is not None:
            close_phase(
                db,
                phase,
                metrics={
                    "scored": summary.scored,
                    "failed": summary.failed,
                    "no_description": summary.no_description,
                },
            )

    return summary
