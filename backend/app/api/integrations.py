from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import JiraSettings, get_jira_settings
from app.db import get_db
from app.models.integration import Integration
from app.services.jira_client import JiraClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

_FIELD_DEFAULTS = {
    "field_sprint": "customfield_10020",
    "field_story_points": "customfield_10016",
    "field_team": "customfield_10001",
    "field_reported_by_customer": "customfield_10100",
    "field_customer": "customfield_10101",
    "field_prod_release_date": "customfield_10102",
    "field_epic_link": "customfield_10014",
}


class JiraIntegrationConfig(BaseModel):
    id: int | None = None
    source: str  # "db" | "env"
    name: str
    base_url: str
    email: str
    api_token: str | None  # full token if source == "db"; None if source == "env"
    api_token_masked: str
    project_key: str | None
    field_sprint: str
    field_story_points: str
    field_team: str
    field_reported_by_customer: str
    field_customer: str
    field_prod_release_date: str
    field_epic_link: str


class JiraConfigIn(BaseModel):
    name: str = "Jira"
    base_url: str
    email: str
    api_token: str
    project_key: str | None = None
    field_sprint: str = _FIELD_DEFAULTS["field_sprint"]
    field_story_points: str = _FIELD_DEFAULTS["field_story_points"]
    field_team: str = _FIELD_DEFAULTS["field_team"]
    field_reported_by_customer: str = _FIELD_DEFAULTS["field_reported_by_customer"]
    field_customer: str = _FIELD_DEFAULTS["field_customer"]
    field_prod_release_date: str = _FIELD_DEFAULTS["field_prod_release_date"]
    field_epic_link: str = _FIELD_DEFAULTS["field_epic_link"]


class JiraConnectionTest(BaseModel):
    ok: bool
    account: dict | None = None
    error: str | None = None


class JiraTestRequest(BaseModel):
    base_url: str | None = None
    email: str | None = None
    api_token: str | None = None


def _mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 4:
        return "*" * len(token)
    return f"…{token[-4:]}"


def _row_to_config(row: Integration) -> JiraIntegrationConfig:
    cfg = row.config or {}
    token = cfg.get("api_token", "")
    return JiraIntegrationConfig(
        id=row.id,
        source="db",
        name=row.name,
        base_url=cfg.get("base_url", ""),
        email=cfg.get("email", ""),
        api_token=token,
        api_token_masked=_mask_token(token),
        project_key=cfg.get("project_key"),
        field_sprint=cfg.get("field_sprint", _FIELD_DEFAULTS["field_sprint"]),
        field_story_points=cfg.get("field_story_points", _FIELD_DEFAULTS["field_story_points"]),
        field_team=cfg.get("field_team", _FIELD_DEFAULTS["field_team"]),
        field_reported_by_customer=cfg.get("field_reported_by_customer", _FIELD_DEFAULTS["field_reported_by_customer"]),
        field_customer=cfg.get("field_customer", _FIELD_DEFAULTS["field_customer"]),
        field_prod_release_date=cfg.get("field_prod_release_date", _FIELD_DEFAULTS["field_prod_release_date"]),
        field_epic_link=cfg.get("field_epic_link", _FIELD_DEFAULTS["field_epic_link"]),
    )


def _active_jira_row(db: Session) -> Integration | None:
    return (
        db.query(Integration)
        .filter(Integration.kind == "jira", Integration.is_active.is_(True))
        .order_by(Integration.id.desc())
        .first()
    )


def _empty_config() -> JiraIntegrationConfig:
    return JiraIntegrationConfig(
        id=None,
        source="none",
        name="Jira",
        base_url="",
        email="",
        api_token=None,
        api_token_masked="",
        project_key=None,
        **_FIELD_DEFAULTS,
    )


@router.get("/jira", response_model=JiraIntegrationConfig)
def get_jira_config(db: Session = Depends(get_db)) -> JiraIntegrationConfig:
    """Return the active Jira config. DB-first; env fallback; empty config if unconfigured."""
    row = _active_jira_row(db)
    if row:
        return _row_to_config(row)

    # Env fallback — silently return empty config if env vars are absent so
    # the UI can show an editable form rather than an error page.
    try:
        settings = get_jira_settings()
    except KeyError:
        return _empty_config()

    return JiraIntegrationConfig(
        id=None,
        source="env",
        name="Jira",
        base_url=settings.base_url,
        email=settings.email,
        api_token=None,  # never expose env token through the API
        api_token_masked=_mask_token(settings.api_token),
        project_key=settings.project_key,
        field_sprint=settings.field_sprint,
        field_story_points=settings.field_story_points,
        field_team=settings.field_team,
        field_reported_by_customer=settings.field_reported_by_customer,
        field_customer=settings.field_customer,
        field_prod_release_date=settings.field_prod_release_date,
        field_epic_link=settings.field_epic_link,
    )


@router.post("/jira", response_model=JiraIntegrationConfig)
def save_jira_config(
    payload: JiraConfigIn,
    db: Session = Depends(get_db),
) -> JiraIntegrationConfig:
    """Upsert the active Jira integration config into the database."""
    config_data = {
        "base_url": payload.base_url.rstrip("/"),
        "email": payload.email,
        "api_token": payload.api_token,
        "project_key": payload.project_key,
        "field_sprint": payload.field_sprint,
        "field_story_points": payload.field_story_points,
        "field_team": payload.field_team,
        "field_reported_by_customer": payload.field_reported_by_customer,
        "field_customer": payload.field_customer,
        "field_prod_release_date": payload.field_prod_release_date,
        "field_epic_link": payload.field_epic_link,
    }
    row = _active_jira_row(db)
    if row:
        row.name = payload.name
        row.config = config_data
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = Integration(kind="jira", name=payload.name, is_active=True, config=config_data)
        db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_config(row)


@router.post("/jira/test", response_model=JiraConnectionTest)
def test_jira_connection(
    payload: JiraTestRequest = Body(default_factory=JiraTestRequest),
    db: Session = Depends(get_db),
) -> JiraConnectionTest:
    """Test Jira connectivity.

    If base_url + email + api_token are all provided in the request body, those
    credentials are tested directly (useful for testing before saving). Otherwise
    the saved DB config (or env fallback) is used.
    """
    if payload.base_url and payload.email and payload.api_token:
        settings = JiraSettings(
            base_url=payload.base_url.rstrip("/"),
            email=payload.email,
            api_token=payload.api_token,
            project_key=None,
            field_sprint=_FIELD_DEFAULTS["field_sprint"],
            field_story_points=_FIELD_DEFAULTS["field_story_points"],
            field_team=_FIELD_DEFAULTS["field_team"],
            field_reported_by_customer=_FIELD_DEFAULTS["field_reported_by_customer"],
            field_customer=_FIELD_DEFAULTS["field_customer"],
            field_prod_release_date=_FIELD_DEFAULTS["field_prod_release_date"],
            field_epic_link=_FIELD_DEFAULTS["field_epic_link"],
        )
    else:
        try:
            settings = get_jira_settings(db)
        except KeyError as exc:
            return JiraConnectionTest(
                ok=False,
                error=f"Missing required Jira config: {exc.args[0]}",
            )

    try:
        with JiraClient(settings) as client:
            account = client.test_connection()
        return JiraConnectionTest(ok=True, account=account)
    except httpx.HTTPStatusError as exc:
        return JiraConnectionTest(
            ok=False,
            error=f"Jira returned {exc.response.status_code}: {exc.response.reason_phrase}",
        )
    except httpx.HTTPError as exc:
        return JiraConnectionTest(ok=False, error=f"Network error: {exc}")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Jira connection test failed")
        return JiraConnectionTest(ok=False, error=f"{type(exc).__name__}: {exc}")
