from __future__ import annotations

import hashlib
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.attachment_extractor import extract_plan_descriptions
from app.services.scoring_service import ELIGIBLE_SCORING_STATUSES, MIN_STORY_POINTS_FOR_SCORING

logger = logging.getLogger(__name__)

ALLOWED_ISSUE_TYPES: tuple[str, ...] = ("Story",)


def run_sanitize(db: Session, sync_state_id: int | None = None) -> dict[str, Any]:
    """Sanitize step:

    1. Overwrite `issues.description` with the extracted text from any attachment
       whose filename contains "implementation-plan" (latest per issue,
       .md/.txt/.html only).
    2. Reconcile `issue_ai_scores` with the (now-finalized) descriptions: insert
       `pending` rows for Stories without one, invalidate Stories whose description
       hash changed, leave unchanged Stories completely untouched, and delete rows
       whose joined issue is no longer of an allowed type (orphan cleanup).

    When sync_state_id is provided, each sub-step is tracked as a pipeline phase
    row in `sync_phases` for UI progress visibility.
    """

    extract_stats = extract_plan_descriptions(db, sync_state_id=sync_state_id)
    inserted, rescored, unchanged, orphaned = _upsert_scoring_rows(
        db, sync_state_id=sync_state_id
    )
    return {
        "stories_marked_pending": inserted,
        "stories_rescored": rescored,
        "stories_unchanged": unchanged,
        "orphaned_deleted": orphaned,
        "descriptions_extracted": extract_stats["extracted"],
        "descriptions_failed": extract_stats["failed"],
        "extraction_candidates": extract_stats["checked"],
        "extraction_skipped_unsupported": extract_stats["skipped"],
        "extraction_skipped_cached": extract_stats["skipped_cached"],
        "allowed_issue_types": list(ALLOWED_ISSUE_TYPES),
    }


def _upsert_scoring_rows(
    db: Session, sync_state_id: int | None = None
) -> tuple[int, int, int, int]:
    from app.models.sync_phase import SyncPhase
    from app.services.phase_service import close_phase, open_phase

    phase = None
    if sync_state_id is not None:
        phase = open_phase(db, sync_state_id, SyncPhase.PHASE_RECONCILING)

    # Orphan cleanup: delete issue_ai_scores rows whose issue is no longer of
    # an allowed type (e.g. a Story that became a Bug), whose summary is tagged
    # [QA] (test-pass tickets), whose story_points fall at or below the scoring
    # threshold, or whose status is not in the eligible-for-scoring set. Done
    # before the SELECT so it doesn't pollute the unchanged/rescored counts.
    orphaned_deleted = db.execute(
        text(
            """
            DELETE FROM issue_ai_scores
            WHERE issue_id IN (
                SELECT s.issue_id
                FROM issue_ai_scores s
                JOIN issues i ON i.id = s.issue_id
                WHERE NOT (i.issue_type = ANY(:allowed))
                   OR coalesce(i.summary, '') ~* '^\\[\\s*qa(\\s|\\]|:|-|$)'
                   OR (i.story_points IS NOT NULL AND i.story_points <= :min_sp)
                   OR i.status IS NULL
                   OR NOT (i.status = ANY(:statuses))
            )
            """
        ),
        {
            "allowed": list(ALLOWED_ISSUE_TYPES),
            "min_sp": MIN_STORY_POINTS_FOR_SCORING,
            "statuses": list(ELIGIBLE_SCORING_STATUSES),
        },
    ).rowcount or 0

    rows = db.execute(
        text(
            """
            SELECT i.id,
                   i.description,
                   s.description_hash,
                   (s.id IS NOT NULL) AS row_exists
            FROM issues i
            LEFT JOIN issue_ai_scores s ON s.issue_id = i.id
            WHERE i.issue_type = ANY(:allowed)
              AND coalesce(i.summary, '') !~* '^\\[\\s*qa(\\s|\\]|:|-|$)'
              AND (i.story_points IS NULL OR i.story_points > :min_sp)
              AND i.status = ANY(:statuses)
            """
        ),
        {
            "allowed": list(ALLOWED_ISSUE_TYPES),
            "min_sp": MIN_STORY_POINTS_FOR_SCORING,
            "statuses": list(ELIGIBLE_SCORING_STATUSES),
        },
    ).all()

    if phase:
        phase.items_total = len(rows)
        db.commit()

    new_inserts: list[dict[str, Any]] = []
    rescored: list[dict[str, Any]] = []
    unchanged = 0

    for issue_id, description, existing_hash, row_exists in rows:
        new_hash = _description_hash(description)
        if not row_exists:
            new_inserts.append({"issue_id": issue_id, "hash": new_hash})
        elif existing_hash != new_hash:
            rescored.append({"issue_id": issue_id, "hash": new_hash})
        else:
            unchanged += 1

    if new_inserts:
        db.execute(
            text(
                """
                INSERT INTO issue_ai_scores (issue_id, scoring_status, description_hash)
                VALUES (:issue_id, 'pending', :hash)
                """
            ),
            new_inserts,
        )

    if rescored:
        db.execute(
            text(
                """
                UPDATE issue_ai_scores SET
                    scoring_status = 'pending',
                    description_hash = :hash,
                    description_quality_score = NULL,
                    ai_score = NULL,
                    total_cost_usd = NULL,
                    ai_plan_detected = NULL,
                    skill_usage_detected = NULL,
                    skill_name = NULL,
                    complexity_estimate = NULL,
                    scoring_notes = NULL,
                    model_used = NULL,
                    scored_at = NULL,
                    error_message = NULL,
                    raw_response = NULL
                WHERE issue_id = :issue_id
                """
            ),
            rescored,
        )

    db.commit()

    metrics = {
        "new_pending": len(new_inserts),
        "rescored": len(rescored),
        "unchanged": unchanged,
        "orphaned_deleted": orphaned_deleted,
    }
    logger.info(
        "sanitize: %d new pending, %d rescored, %d unchanged, %d orphaned",
        len(new_inserts),
        len(rescored),
        unchanged,
        orphaned_deleted,
    )
    if phase:
        phase.items_processed = len(rows)
        close_phase(db, phase, metrics=metrics)

    return len(new_inserts), len(rescored), unchanged, orphaned_deleted


def _description_hash(description: str | None) -> str:
    return hashlib.sha256((description or "").encode("utf-8")).hexdigest()
