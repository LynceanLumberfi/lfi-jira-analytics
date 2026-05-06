from __future__ import annotations

import logging
from html.parser import HTMLParser

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_jira_settings
from app.services.jira_client import JiraClient
from app.services.scoring_service import ELIGIBLE_SCORING_STATUSES, MIN_STORY_POINTS_FOR_SCORING

logger = logging.getLogger(__name__)

_PLAN_PATTERN = "%implementation%"
_TEXT_EXTENSIONS = (".md", ".markdown", ".txt", ".html", ".htm")


def extract_plan_descriptions(
    db: Session, sync_state_id: int | None = None
) -> dict[str, int]:
    """Overwrite `issues.description` with extracted text from any attachment
    whose filename contains "implementation-plan" (latest by created_at).
    Limited to .md/.txt/.html bodies. Failures logged + counted, never raised.

    Caching guard: an attachment whose `extracted_at` is set has already been
    downloaded and applied; skip it on subsequent runs. The guard invalidates
    automatically when a *new* plan attachment (different `jira_attachment_id`)
    appears with a later `created_at` — the DISTINCT ON picks it up and its
    `extracted_at` is NULL. To force re-extraction, clear `extracted_at` to NULL.

    When sync_state_id is provided, opens and manages an 'extracting' phase row."""

    from app.services.phase_service import open_phase, close_phase, tick
    from app.models.sync_phase import SyncPhase

    rows = db.execute(
        text(
            """
            SELECT DISTINCT ON (a.issue_id)
                   a.id AS att_id, a.issue_id, a.filename,
                   a.content_url, a.extracted_at
            FROM attachments a
            JOIN issues i ON i.id = a.issue_id
            WHERE i.issue_type = 'Story'
              AND coalesce(i.summary, '') !~* '^\\[\\s*qa(\\s|\\]|:|-|$)'
              AND (i.story_points IS NULL OR i.story_points > :min_sp)
              AND i.status = ANY(:statuses)
              AND a.filename ILIKE :pattern
              AND a.content_url IS NOT NULL
            ORDER BY a.issue_id, a.created_at DESC NULLS LAST
            """
        ),
        {
            "pattern": _PLAN_PATTERN,
            "min_sp": MIN_STORY_POINTS_FOR_SCORING,
            "statuses": list(ELIGIBLE_SCORING_STATUSES),
        },
    ).all()

    supported = [
        row for row in rows
        if row.filename and row.filename.lower().endswith(_TEXT_EXTENSIONS)
    ]
    skipped_unsupported = len(rows) - len(supported)
    targets = [row for row in supported if row.extracted_at is None]
    skipped_cached = len(supported) - len(targets)

    def _build_stats(extracted: int, failed: int) -> dict[str, int]:
        return {
            "checked": len(rows),
            "extracted": extracted,
            "failed": failed,
            "skipped": skipped_unsupported,
            "skipped_cached": skipped_cached,
        }

    if not targets:
        stats = _build_stats(0, 0)
        if sync_state_id is not None:
            p = open_phase(db, sync_state_id, SyncPhase.PHASE_EXTRACTING)
            p.items_total = 0
            db.commit()
            close_phase(db, p, metrics=stats)
        return stats

    phase: SyncPhase | None = None
    if sync_state_id is not None:
        phase = open_phase(db, sync_state_id, SyncPhase.PHASE_EXTRACTING)
        phase.items_total = len(targets)
        db.commit()

    settings = get_jira_settings()
    extracted = 0
    failed = 0
    processed = 0

    with JiraClient(settings) as client:
        for row in targets:
            try:
                raw = client.download_attachment(row.content_url)
                body = _decode_attachment(row.filename, raw)
                if not body:
                    processed += 1
                    if phase:
                        tick(db, phase, processed=processed)
                    continue
                db.execute(
                    text("UPDATE issues SET description = :body WHERE id = :id"),
                    {"body": body, "id": row.issue_id},
                )
                db.execute(
                    text(
                        "UPDATE attachments SET extracted_at = now() WHERE id = :id"
                    ),
                    {"id": row.att_id},
                )
                db.commit()
                extracted += 1
            except Exception:  # noqa: BLE001 — never block sanitize for one bad file
                logger.exception(
                    "extract failed issue_id=%s filename=%s",
                    row.issue_id,
                    row.filename,
                )
                failed += 1

            processed += 1
            if phase:
                tick(db, phase, processed=processed)

    logger.info(
        "extract: %d candidates, %d extracted, %d failed, "
        "%d skipped (unsupported ext), %d skipped (cached)",
        len(rows),
        extracted,
        failed,
        skipped_unsupported,
        skipped_cached,
    )

    stats = _build_stats(extracted, failed)
    if phase:
        close_phase(db, phase, metrics=stats)

    return stats


def _decode_attachment(filename: str, raw: bytes) -> str | None:
    text_str = raw.decode("utf-8", errors="replace")
    if filename.lower().endswith((".html", ".htm")):
        return _strip_html(text_str)
    return text_str.strip() or None


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self.parts.append(data.strip())


def _strip_html(html_str: str) -> str | None:
    extractor = _TextExtractor()
    extractor.feed(html_str)
    text_str = "\n".join(extractor.parts).strip()
    return text_str or None
