from __future__ import annotations

import logging
import time
from typing import Any, Iterator

import httpx

from app.config import JiraSettings

logger = logging.getLogger(__name__)

# Jira Cloud allows ~300 req/min per token. On a 429 we honour the
# Retry-After header when present, otherwise use exponential backoff.
_MAX_RETRIES = 4
_BACKOFF_BASE = 2.0  # seconds; doubles each attempt: 2 → 4 → 8 → 16


class JiraClient:
    """Thin synchronous wrapper around Jira Cloud REST v3."""

    def __init__(self, settings: JiraSettings, timeout_seconds: float = 30.0) -> None:
        self._settings = settings
        self._client = httpx.Client(
            base_url=settings.base_url,
            auth=(settings.email, settings.api_token),
            headers={"Accept": "application/json"},
            timeout=timeout_seconds,
        )

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """Send a request, retrying on 429 with backoff."""
        for attempt in range(_MAX_RETRIES + 1):
            response = self._client.request(method, url, **kwargs)
            if response.status_code != 429:
                response.raise_for_status()
                return response
            if attempt == _MAX_RETRIES:
                response.raise_for_status()  # exhaust retries → propagate
            retry_after = response.headers.get("Retry-After")
            wait = float(retry_after) if retry_after else _BACKOFF_BASE * (2 ** attempt)
            logger.warning("Jira 429 on %s %s — waiting %.1fs (attempt %d/%d)", method, url, wait, attempt + 1, _MAX_RETRIES)
            time.sleep(wait)
        raise RuntimeError("unreachable")

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "JiraClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def search_issues(
        self,
        jql: str,
        fields: list[str] | str = "*all",
        expand: str = "changelog,renderedFields",
        page_size: int = 100,
    ) -> Iterator[dict[str, Any]]:
        """Yield issues matching `jql`, paging via the cursor-based search.

        Uses `POST /rest/api/3/search/jql` — the endpoint that replaced
        `GET /rest/api/3/search` after Atlassian retired the old one in 2025.
        Pagination is by `nextPageToken` rather than `startAt`; no `total`
        field is returned in the response (use `get_issue_count` for an
        approximate pre-count for ETA).

        `fields` accepts the Jira sentinels `*all` / `*navigable`, a single
        comma-separated string (legacy callers), or a list of field names.
        """
        if isinstance(fields, str):
            if fields in ("*all", "*navigable"):
                fields_list = [fields]
            else:
                fields_list = [f.strip() for f in fields.split(",") if f.strip()]
        else:
            fields_list = list(fields)

        next_page_token: str | None = None
        while True:
            body: dict[str, Any] = {
                "jql": jql,
                "maxResults": page_size,
                "fields": fields_list,
                "expand": expand,
            }
            if next_page_token is not None:
                body["nextPageToken"] = next_page_token
            response = self._request("POST", "/rest/api/3/search/jql", json=body)
            payload = response.json()
            issues = payload.get("issues", []) or []
            for issue in issues:
                yield issue
            next_page_token = payload.get("nextPageToken")
            if not issues or payload.get("isLast") is True or next_page_token is None:
                return

    def test_connection(self) -> dict[str, Any]:
        """Ping `GET /rest/api/3/myself` to verify the configured credentials.

        Returns the authenticated account payload (accountId, displayName,
        emailAddress) on success. Raises httpx.HTTPStatusError on auth/network
        failure; the caller is expected to translate that to a user-facing
        message.
        """
        return self._request("GET", "/rest/api/3/myself").json()

    def get_issue_count(self, jql: str) -> int | None:
        """Approximate count for `jql` via `POST /rest/api/3/search/approximate-count`.

        The new search/jql endpoint no longer returns `total`, so we use this
        sibling endpoint to pre-fetch an `items_total` for the `syncing` phase
        progress bar. The count is approximate but stable across a sync run.
        """
        count = self._request(
            "POST", "/rest/api/3/search/approximate-count", json={"jql": jql}
        ).json().get("count")
        return int(count) if count is not None else None

    def download_attachment(self, url: str) -> bytes:
        """Fetch raw bytes from an attachment content URL (auth, follow redirects)."""

        return self._request("GET", url, follow_redirects=True).content

    def get_issue_worklogs(
        self, issue_key: str, page_size: int = 100
    ) -> list[dict[str, Any]]:
        """Fetch the full worklog list for `issue_key`.

        The inline `worklog` field on a search-issues response is capped at
        20 entries (`maxResults`); this endpoint pages until exhausted. Used
        by `_upsert_worklogs` whenever `total > len(inline)`.
        """
        all_worklogs: list[dict[str, Any]] = []
        start_at = 0
        while True:
            payload = self._request(
                "GET",
                f"/rest/api/3/issue/{issue_key}/worklog",
                params={"startAt": start_at, "maxResults": page_size},
            ).json()
            worklogs = payload.get("worklogs", []) or []
            all_worklogs.extend(worklogs)
            total = payload.get("total")
            received = start_at + len(worklogs)
            if not worklogs or (total is not None and received >= total):
                return all_worklogs
            start_at = received

    def get_issue_changelog(
        self, issue_key: str, page_size: int = 100
    ) -> list[dict[str, Any]]:
        """Fetch the full changelog history for `issue_key`.

        The inline `changelog.histories` from search/jql is capped at 40
        entries. For issues with longer history, this endpoint pages
        through the full set."""
        all_histories: list[dict[str, Any]] = []
        start_at = 0
        while True:
            payload = self._request(
                "GET",
                f"/rest/api/3/issue/{issue_key}/changelog",
                params={"startAt": start_at, "maxResults": page_size},
            ).json()
            values = payload.get("values", []) or []
            all_histories.extend(values)
            total = payload.get("total")
            is_last = payload.get("isLast")
            received = start_at + len(values)
            if not values or is_last is True or (total is not None and received >= total):
                return all_histories
            start_at = received
