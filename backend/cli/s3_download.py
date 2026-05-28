"""S3 download CLI. Lists or downloads objects from an S3 bucket to local disk.

Credentials come from .env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
AWS_REGION), loaded the same way as the Jira credentials.

Usage (from project root):
    .jira-analytics/bin/python backend/cli/s3_download.py --bucket my-bucket --prefix reports/ --list
    .jira-analytics/bin/python backend/cli/s3_download.py --bucket my-bucket --prefix reports/
    .jira-analytics/bin/python backend/cli/s3_download.py --bucket my-bucket --prefix reports/ --dest data/custom
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

from app.config import get_s3_settings  # noqa: E402
from app.services.s3_service import download_prefix, list_objects  # noqa: E402


def _human(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{value:.1f}TB"


@click.command()
@click.option("--bucket", default=None, help="S3 bucket (defaults to S3_BUCKET env)")
@click.option("--prefix", default="", help="Key prefix/folder to download (default: whole bucket)")
@click.option(
    "--dest",
    default=None,
    type=click.Path(),
    help="Local destination dir (default: data/s3/<bucket>, relative to project root)",
)
@click.option("--region", default=None, help="Override AWS_REGION")
@click.option("--list", "list_only", is_flag=True, help="List matching keys, do not download")
def main(
    bucket: str | None,
    prefix: str,
    dest: str | None,
    region: str | None,
    list_only: bool,
) -> None:
    settings = get_s3_settings()
    if region:
        settings = type(settings)(
            access_key_id=settings.access_key_id,
            secret_access_key=settings.secret_access_key,
            region=region,
            bucket=settings.bucket,
        )

    bucket = bucket or settings.bucket
    if not bucket:
        raise click.UsageError("No bucket given. Pass --bucket or set S3_BUCKET in .env.")

    if list_only:
        objects = list_objects(settings, bucket, prefix)
        total = 0
        for obj in objects:
            total += obj["size"]
            click.echo(f"  {_human(obj['size']):>9}  {obj['key']}")
        click.echo("---")
        click.echo(f"keys={len(objects)} total={_human(total)} bucket={bucket} prefix={prefix or '(all)'}")
        return

    dest_dir = Path(dest) if dest else (_PROJECT_ROOT / "data" / "s3" / bucket)
    click.echo(f"downloading s3://{bucket}/{prefix or ''} -> {dest_dir}")

    downloaded = 0
    total_bytes = 0

    def progress(key: str, size: int) -> None:
        nonlocal downloaded, total_bytes
        downloaded += 1
        total_bytes += size
        click.echo(f"  {_human(size):>9}  {key}")

    written = download_prefix(settings, bucket, prefix, dest_dir, progress=progress)

    click.echo("---")
    click.echo(f"downloaded={len(written)} total={_human(total_bytes)} dest={dest_dir}")
    if not written:
        click.echo("  (no objects matched the prefix)")


if __name__ == "__main__":
    main()
