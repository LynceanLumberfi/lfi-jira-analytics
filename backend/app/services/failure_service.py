from __future__ import annotations

import logging
import subprocess
import traceback
from typing import Any

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.failed_record import FailedRecord

logger = logging.getLogger(__name__)


# ---------- exception classification ----------


def classify(exc: BaseException) -> str:
    """Map an exception to a FailedRecord error_code."""
    if isinstance(exc, IntegrityError):
        msg = str(exc.orig) if exc.orig is not None else str(exc)
        if "unique" in msg.lower():
            return FailedRecord.CODE_CONFLICT_UNIQUE
        if "foreign key" in msg.lower():
            return FailedRecord.CODE_DEPENDENCY
        return FailedRecord.CODE_CONFLICT_FIELDS

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 429:
            return FailedRecord.CODE_RATE_LIMITED
        if status >= 500:
            return FailedRecord.CODE_NETWORK
        return FailedRecord.CODE_VALIDATION

    if isinstance(exc, subprocess.TimeoutExpired):
        return FailedRecord.CODE_TIMEOUT

    if isinstance(exc, httpx.TimeoutException):
        return FailedRecord.CODE_TIMEOUT

    if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)):
        return FailedRecord.CODE_NETWORK

    if isinstance(exc, (ValueError, TypeError, KeyError)):
        return FailedRecord.CODE_VALIDATION

    return FailedRecord.CODE_UNKNOWN


# ---------- fix-step suggestions ----------


_FIX_STEPS: dict[str, list[str]] = {
    FailedRecord.CODE_DEPENDENCY: [
        "Check that the parent/linked record was synced first.",
        "Re-run sync to backfill missing dependencies.",
        "If the dependency was deleted in Jira, mark this record as skipped.",
    ],
    FailedRecord.CODE_CONFLICT_UNIQUE: [
        "Another record already exists with this unique value.",
        "Manually merge or remap to the existing record.",
        "If the duplicate is stale, delete it before retrying.",
    ],
    FailedRecord.CODE_CONFLICT_FIELDS: [
        "Field-level constraint failed (foreign key, NOT NULL, type).",
        "Check the raw payload for missing required fields.",
        "Update the field mapping if the schema changed.",
    ],
    FailedRecord.CODE_VALIDATION: [
        "Payload failed local validation.",
        "Inspect raw_response for the offending field.",
        "Fix the upstream value in Jira and re-sync.",
    ],
    FailedRecord.CODE_RATE_LIMITED: [
        "Jira rate-limited the request.",
        "Wait and retry, or lower the page size in JiraClient.",
        "If persistent, contact Jira admin to raise quota.",
    ],
    FailedRecord.CODE_NETWORK: [
        "Network error reaching Jira or the database.",
        "Check connectivity and retry.",
        "If recurring, inspect logs for transport errors.",
    ],
    FailedRecord.CODE_TIMEOUT: [
        "Operation timed out before completing.",
        "If this is scoring: increase SCORING_TIMEOUT_SECS or check that the claude CLI is responsive.",
        "If this is sync/promote: check Jira API latency and the network path.",
    ],
    FailedRecord.CODE_UNKNOWN: [
        "Unclassified error.",
        "Inspect detail and raw_response for the underlying cause.",
        "Retry once; escalate if it recurs.",
    ],
}


def _fix_steps_for(error_code: str) -> list[str]:
    return _FIX_STEPS.get(error_code, _FIX_STEPS[FailedRecord.CODE_UNKNOWN])


# ---------- public API ----------


def record_failure(
    db: Session,
    *,
    phase: str,
    entity: str,
    title: str,
    exc: BaseException | None = None,
    sync_state_id: int | None = None,
    staging_id: int | None = None,
    jira_ref: str | None = None,
    error_code: str | None = None,
    detail: str | None = None,
    raw_response: dict[str, Any] | None = None,
    commit: bool = True,
) -> FailedRecord:
    """Persist a failure row. Caller picks the values that matter; the rest
    is inferred from the exception. Safe to invoke from `except` branches.
    """
    code = error_code or (classify(exc) if exc is not None else FailedRecord.CODE_UNKNOWN)

    if detail is None and exc is not None:
        tb = traceback.format_exc()
        detail = f"{type(exc).__name__}: {exc}\n\n{tb}"
    if detail is not None:
        detail = detail[:4000]

    row = FailedRecord(
        sync_state_id=sync_state_id,
        staging_id=staging_id,
        phase=phase,
        entity=entity,
        jira_ref=jira_ref,
        title=title[:255] if title else "(unspecified failure)",
        detail=detail,
        error_code=code,
        fix_steps=_fix_steps_for(code),
        raw_response=raw_response,
    )
    db.add(row)
    if commit:
        try:
            db.commit()
            db.refresh(row)
        except Exception:
            logger.exception("record_failure commit failed; rolling back")
            db.rollback()
    else:
        db.flush()
    return row
