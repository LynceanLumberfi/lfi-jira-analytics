"""AI scoring CLI. Reads pending Story-type issues from the database, scores
each by invoking the `jira-analyzer` Claude Code agent via the `claude` CLI
subprocess, then writes scores back to issue_ai_scores.

No Anthropic API key is required — the subprocess uses your Claude Code session.

Usage (from project root):
    .jira-analytics/bin/python backend/cli/score.py --limit 200
    .jira-analytics/bin/python backend/cli/score.py --dry-run
    .jira-analytics/bin/python backend/cli/score.py --model claude-haiku-4-5
    .jira-analytics/bin/python backend/cli/score.py --sprint-start 2026-05-12
"""
from __future__ import annotations

import logging
import sys
from datetime import date
from pathlib import Path

import click
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

_PROJECT_ROOT = _BACKEND_DIR.parent
load_dotenv(_PROJECT_ROOT / ".env")

from app.db import SessionLocal  # noqa: E402
from app.services.scoring_service import score_pending  # noqa: E402


@click.command()
@click.option("--limit", default=200, show_default=True, type=click.IntRange(1, 1000))
@click.option(
    "--model",
    default=None,
    help="Claude model id passed to the claude CLI; defaults to the agent's frontmatter or claude default",
)
@click.option("--dry-run", is_flag=True, help="Select pending issues but do not invoke claude")
@click.option("--timeout", default=None, type=int, help="Per-issue timeout in seconds (default 600)")
@click.option(
    "--sprint-start",
    "sprint_start",
    default=None,
    type=click.DateTime(formats=["%Y-%m-%d"]),
    help=(
        "Score only issues whose LATEST sprint starts on this date (UTC, YYYY-MM-DD). "
        "Each issue lives in exactly one bucket — safe to run multiple commands in "
        "parallel for different dates."
    ),
)
@click.option("-v", "--verbose", is_flag=True)
def main(
    limit: int,
    model: str | None,
    dry_run: bool,
    timeout: int | None,
    sprint_start,
    verbose: bool,
) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    def progress(issue, status: str, **kwargs) -> None:
        if status == "scored":
            parsed = kwargs.get("parsed") or {}
            cost = kwargs.get("cost") or 0.0
            skill = parsed.get("skill_name") or "—"
            click.echo(
                f"  {issue.jira_key:<14} q={parsed.get('quality_score')} "
                f"ai={parsed.get('ai_score')} skill={skill:<9} ${cost:.4f}"
            )
        elif status == "no-description":
            click.echo(f"  {issue.jira_key:<14} (no description)")
        elif status == "failed":
            click.echo(f"  {issue.jira_key:<14} FAILED: {kwargs.get('error', '')}", err=True)
        elif status == "dry-run":
            click.echo(f"  {issue.jira_key:<14} (dry-run, would score)")

    sprint_start_date: date | None = sprint_start.date() if sprint_start else None

    db = SessionLocal()
    try:
        sprint_clause = (
            f", sprint_start={sprint_start_date.isoformat()}" if sprint_start_date else ""
        )
        click.echo(
            f"scoring up to {limit} pending issues (model={model or 'agent default'}, "
            f"dry_run={dry_run}{sprint_clause})"
        )
        summary = score_pending(
            db,
            limit=limit,
            model=model,
            dry_run=dry_run,
            timeout=timeout,
            progress=progress,
            sprint_start_date=sprint_start_date,
        )
        if summary.attempted == 0 and sprint_start_date is not None:
            click.echo(
                f"  (no pending issues found in sprints starting {sprint_start_date.isoformat()})"
            )
    finally:
        db.close()

    click.echo("---")
    click.echo(f"attempted={summary.attempted}")
    click.echo(f"scored   ={summary.scored}")
    click.echo(f"no-desc  ={summary.no_description}")
    click.echo(f"failed   ={summary.failed}")
    if not dry_run and summary.scored - summary.no_description > 0:
        click.echo(
            f"tokens   in={summary.input_tokens} out={summary.output_tokens} "
            f"cache_read={summary.cache_read_tokens}"
        )
        click.echo(f"cost     ${summary.total_cost_usd:.4f}")

    if summary.failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
