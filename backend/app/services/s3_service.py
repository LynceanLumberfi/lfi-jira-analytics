"""S3 download helpers used by backend/cli/s3_download.py.

Thin wrapper over boto3: list keys under a prefix and download them to a local
directory, preserving the key's path structure.
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import boto3

from app.config import S3Settings


def _client(settings: S3Settings):
    return boto3.client(
        "s3",
        region_name=settings.region,
        aws_access_key_id=settings.access_key_id,
        aws_secret_access_key=settings.secret_access_key,
    )


def list_objects(settings: S3Settings, bucket: str, prefix: str = "") -> list[dict]:
    """Return all objects under prefix as dicts with 'key' and 'size'.

    Uses a paginator so buckets with more than 1000 keys are fully listed.
    Directory-marker keys (ending in '/') are skipped.
    """
    client = _client(settings)
    paginator = client.get_paginator("list_objects_v2")
    objects: list[dict] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue
            objects.append({
                "key": key,
                "size": obj["Size"],
                "last_modified": obj["LastModified"],
            })
    return objects


def download_prefix(
    settings: S3Settings,
    bucket: str,
    prefix: str,
    dest_dir: Path,
    progress: Callable[[str, int], None] | None = None,
) -> list[Path]:
    """Download every object under prefix into dest_dir, preserving key paths.

    Returns the list of local file paths written. `progress` is called with
    (key, size) after each successful download.
    """
    client = _client(settings)
    objects = list_objects(settings, bucket, prefix)
    written: list[Path] = []
    for obj in objects:
        key = obj["key"]
        local_path = dest_dir / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(bucket, key, str(local_path))
        written.append(local_path)
        if progress is not None:
            progress(key, obj["size"])
    return written


def download_keys(
    settings: S3Settings,
    bucket: str,
    keys: list[str],
    dest_dir: Path,
    progress: Callable[[str, int], None] | None = None,
) -> list[Path]:
    """Download a specific list of keys into dest_dir, preserving key paths.

    Unlike download_prefix, this skips the list step — the caller already
    decided which keys to fetch (typically after diffing against DB state).
    """
    client = _client(settings)
    written: list[Path] = []
    for key in keys:
        local_path = dest_dir / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(bucket, key, str(local_path))
        written.append(local_path)
        if progress is not None:
            size = local_path.stat().st_size
            progress(key, size)
    return written
