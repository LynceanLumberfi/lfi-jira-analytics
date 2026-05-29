"""Backfill the `module` and `vendor` columns on existing test_case_result rows.

Usage (from project root):
    .jira-analytics/bin/python backend/cli/backfill_test_modules.py
    .jira-analytics/bin/python backend/cli/backfill_test_modules.py --only-null
    .jira-analytics/bin/python backend/cli/backfill_test_modules.py --dry-run

Reads each row's identity fields and the parent run's suite, runs the
module classifier, and writes back `module`/`vendor` in batches.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import click
from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

_PROJECT_ROOT = _BACKEND_DIR.parent
load_dotenv(_PROJECT_ROOT / ".env")

from sqlalchemy import select, text, update  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models.test_case_result import TestCaseResult  # noqa: E402
from app.models.test_run import TestRun  # noqa: E402
from app.services.test_module_classifier import classify  # noqa: E402


@click.command()
@click.option("--only-null", is_flag=True, help="Only rows where module IS NULL.")
@click.option("--batch-size", default=2000, type=int, show_default=True)
@click.option("--dry-run", is_flag=True, help="Classify but don't write.")
def main(only_null: bool, batch_size: int, dry_run: bool) -> None:
    counter: Counter[str] = Counter()
    vendor_counter: Counter[str] = Counter()
    updated = 0

    with SessionLocal() as session:
        # Fetch the joined data we need: case identity + run.suite.
        # Stream in batches with id-keyed pagination so memory stays bounded.
        last_id = 0
        while True:
            q = (
                select(
                    TestCaseResult.id,
                    TestCaseResult.kind,
                    TestCaseResult.class_fqn,
                    TestCaseResult.test_file,
                    TestCaseResult.package_name,
                    TestRun.suite,
                )
                .join(TestRun, TestRun.id == TestCaseResult.run_id)
                .where(TestCaseResult.id > last_id)
                .order_by(TestCaseResult.id)
                .limit(batch_size)
            )
            if only_null:
                q = q.where(TestCaseResult.module.is_(None))
            rows = session.execute(q).all()
            if not rows:
                break

            updates: list[dict] = []
            for r in rows:
                module, vendor = classify(
                    kind=r.kind,
                    class_fqn=r.class_fqn,
                    test_file=r.test_file,
                    package_name=r.package_name,
                    suite=r.suite,
                )
                counter[module] += 1
                if vendor:
                    vendor_counter[vendor] += 1
                updates.append({"id": r.id, "module": module, "vendor": vendor})

            last_id = rows[-1].id
            updated += len(updates)

            if not dry_run:
                session.execute(
                    text(
                        "UPDATE test_case_result SET module = :module, vendor = :vendor "
                        "WHERE id = :id"
                    ),
                    updates,
                )
                session.commit()

            click.echo(f"  processed up to id={last_id} (this batch: {len(updates)})")

    click.echo("---")
    click.echo(f"{'(dry-run) ' if dry_run else ''}rows classified: {updated}")
    click.echo("modules:")
    for module, n in counter.most_common():
        click.echo(f"  {module:<24} {n:>8}")
    if vendor_counter:
        click.echo("vendors:")
        for vendor, n in vendor_counter.most_common():
            click.echo(f"  {vendor:<24} {n:>8}")


if __name__ == "__main__":
    main()
