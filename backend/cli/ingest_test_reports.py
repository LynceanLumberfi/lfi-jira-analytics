"""Ingest downloaded Playwright + Surefire HTML reports into Postgres.

Usage (from project root):
    .jira-analytics/bin/python backend/cli/ingest_test_reports.py
    .jira-analytics/bin/python backend/cli/ingest_test_reports.py --days 30
    .jira-analytics/bin/python backend/cli/ingest_test_reports.py --dry-run
    .jira-analytics/bin/python backend/cli/ingest_test_reports.py --reingest
"""
from __future__ import annotations

import sys
from pathlib import Path

import click
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

_PROJECT_ROOT = _BACKEND_DIR.parent
load_dotenv(_PROJECT_ROOT / ".env")

from app.db import SessionLocal  # noqa: E402
from app.services.test_report_ingest import ingest_dir  # noqa: E402


@click.command()
@click.option(
    "--data-dir",
    default=None,
    type=click.Path(),
    help="Local directory holding downloaded reports (default: data/s3 relative to project root).",
)
@click.option("--days", default=10, type=int, help="How many days of files to ingest (filename date).")
@click.option("--dry-run", is_flag=True, help="Parse and count, but write nothing.")
@click.option(
    "--reingest",
    is_flag=True,
    help="Delete any existing run with the same source_path before re-inserting.",
)
@click.option("--verbose", "-v", is_flag=True, help="Print one line per file.")
def main(data_dir: str | None, days: int, dry_run: bool, reingest: bool, verbose: bool) -> None:
    base = Path(data_dir) if data_dir else (_PROJECT_ROOT / "data" / "s3")
    if not base.exists():
        raise click.UsageError(f"data dir does not exist: {base}")

    click.echo(f"ingesting from {base} (days={days}, dry_run={dry_run}, reingest={reingest})")

    def progress(event: str, source_path: str) -> None:
        if verbose:
            click.echo(f"  {event:<18} {source_path}")

    with SessionLocal() as session:
        result = ingest_dir(
            session,
            base,
            days=days,
            dry_run=dry_run,
            reingest=reingest,
            progress=progress,
        )

    click.echo("---")
    click.echo(f"runs inserted:       {result.runs_inserted}")
    click.echo(f"cases inserted:      {result.cases_inserted}")
    click.echo(f"skipped (existing):  {result.skipped_existing}")
    click.echo(f"skipped (>{days}d):     {result.skipped_out_of_window}")
    click.echo(f"errors:              {len(result.errors)}")
    for path, err in result.errors[:20]:
        click.echo(f"  ! {path}: {err}")
    if len(result.errors) > 20:
        click.echo(f"  ... and {len(result.errors) - 20} more")


if __name__ == "__main__":
    main()
