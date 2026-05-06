from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class JiraSettings:
    base_url: str
    email: str
    api_token: str
    project_key: str | None
    field_sprint: str
    field_story_points: str
    field_team: str
    field_reported_by_customer: str
    field_customer: str
    field_prod_release_date: str
    field_epic_link: str


def _from_env() -> JiraSettings:
    return JiraSettings(
        base_url=os.environ["JIRA_BASE_URL"].rstrip("/"),
        email=os.environ["JIRA_EMAIL"],
        api_token=os.environ["JIRA_API_TOKEN"],
        project_key=os.environ.get("JIRA_PROJECT_KEY") or None,
        field_sprint=os.environ.get("JIRA_FIELD_SPRINT", "customfield_10020"),
        field_story_points=os.environ.get("JIRA_FIELD_STORY_POINTS", "customfield_10016"),
        field_team=os.environ.get("JIRA_FIELD_TEAM", "customfield_10001"),
        field_reported_by_customer=os.environ.get(
            "JIRA_FIELD_REPORTED_BY_CUSTOMER", "customfield_10100"
        ),
        field_customer=os.environ.get("JIRA_FIELD_CUSTOMER", "customfield_10101"),
        field_prod_release_date=os.environ.get(
            "JIRA_FIELD_PROD_RELEASE_DATE", "customfield_10102"
        ),
        field_epic_link=os.environ.get("JIRA_FIELD_EPIC_LINK", "customfield_10014"),
    )


def _from_db_row(cfg: dict) -> JiraSettings:
    return JiraSettings(
        base_url=cfg["base_url"].rstrip("/"),
        email=cfg["email"],
        api_token=cfg["api_token"],
        project_key=cfg.get("project_key") or None,
        field_sprint=cfg.get("field_sprint", "customfield_10020"),
        field_story_points=cfg.get("field_story_points", "customfield_10016"),
        field_team=cfg.get("field_team", "customfield_10001"),
        field_reported_by_customer=cfg.get("field_reported_by_customer", "customfield_10100"),
        field_customer=cfg.get("field_customer", "customfield_10101"),
        field_prod_release_date=cfg.get("field_prod_release_date", "customfield_10102"),
        field_epic_link=cfg.get("field_epic_link", "customfield_10014"),
    )


def get_jira_settings(db=None) -> JiraSettings:
    """Return Jira settings: active DB integration first, env vars as fallback.

    Pass an existing SQLAlchemy Session as `db` to reuse it; omit to let this
    function open and close its own session (used by background tasks).
    """
    # Lazy imports avoid circular dependencies at module load time.
    try:
        from app.db import SessionLocal
        from app.models.integration import Integration

        own_db = db is None
        _db = SessionLocal() if own_db else db
        try:
            row = (
                _db.query(Integration)
                .filter(Integration.kind == "jira", Integration.is_active.is_(True))
                .order_by(Integration.id.desc())
                .first()
            )
            if row and row.config and row.config.get("api_token"):
                return _from_db_row(row.config)
        finally:
            if own_db:
                _db.close()
    except Exception:
        # DB not yet available (e.g. migrations pending, test env) — fall through.
        pass

    return _from_env()
