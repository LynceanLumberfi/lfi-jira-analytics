"""Parsers for Playwright + Maven Surefire HTML reports.

Each `parse_*` returns `(run_dict, cases_list)` where `run_dict` has the
columns for `test_run` and each case dict has the columns for
`test_case_result`. Pure functions — no DB access.
"""
from __future__ import annotations

import base64
import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

from app.models.test_case_result import TestCaseResult
from app.models.test_run import TestRun
from app.services.test_module_classifier import classify as classify_module


# ---------------------------------------------------------------------------
# Filename parsing
# ---------------------------------------------------------------------------

_PLAYWRIGHT_PREFIX = "lumberfi-playwright-reports/"
_SUREFIRE_PREFIX = "lumberfi-automation-reports/"

# build-<num>-<suite?>-<YYYY-MM-DD>-<HHMMSS>.html
_FILENAME_RE = re.compile(
    r"^build-(?P<num>\d+)(?:-(?P<suite>[a-z0-9-]+?))?-(?P<date>\d{4}-\d{2}-\d{2})-(?P<time>\d{6})\.html$"
)


@dataclass
class FilenameInfo:
    kind: str
    bucket: str
    repo_path: str
    build_number: int
    suite: str | None
    started_at: datetime
    source_path: str


def parse_filename(path: str) -> FilenameInfo:
    """Extract metadata from a report path under `data/s3/`.

    `path` is the path relative to the `data/s3/` root (e.g.
    `lumberfi-playwright-reports/reports/Playwright/automation-suite/qa/build-555-smoke-2026-05-27-053055.html`).
    """
    parts = path.split("/")
    if path.startswith(_PLAYWRIGHT_PREFIX):
        kind = TestRun.KIND_PLAYWRIGHT
        bucket = "lumberfi-playwright-reports"
    elif path.startswith(_SUREFIRE_PREFIX):
        kind = TestRun.KIND_SUREFIRE
        bucket = "lumberfi-automation-reports"
    else:
        raise ValueError(f"Unknown bucket for path: {path}")

    # repo_path is everything between '<bucket>/reports/' and the filename.
    # e.g. 'Playwright/automation-suite/qa' or 'lumberfi/lumberfi-services/main'.
    try:
        reports_idx = parts.index("reports")
    except ValueError as exc:
        raise ValueError(f"No 'reports' segment in path: {path}") from exc
    repo_path = "/".join(parts[reports_idx + 1 : -1])
    filename = parts[-1]

    m = _FILENAME_RE.match(filename)
    if not m:
        raise ValueError(f"Unparseable report filename: {filename}")

    started_at = datetime.strptime(
        f"{m.group('date')} {m.group('time')}", "%Y-%m-%d %H%M%S"
    ).replace(tzinfo=timezone.utc)

    return FilenameInfo(
        kind=kind,
        bucket=bucket,
        repo_path=repo_path,
        build_number=int(m.group("num")),
        suite=m.group("suite") or None,
        started_at=started_at,
        source_path=path,
    )


# ---------------------------------------------------------------------------
# Playwright parser
# ---------------------------------------------------------------------------

_PLAYWRIGHT_BASE64_RE = re.compile(
    r'window\.playwrightReportBase64\s*=\s*"data:application/zip;base64,([^"]+)"'
)


def parse_playwright(local_path: Path, info: FilenameInfo) -> tuple[dict, list[dict]]:
    html = local_path.read_text()
    m = _PLAYWRIGHT_BASE64_RE.search(html)
    if not m:
        raise ValueError(f"No embedded report payload in {local_path}")
    zip_bytes = base64.b64decode(m.group(1))
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))

    summary = json.loads(zf.read("report.json"))
    stats = summary.get("stats") or {}
    started_at = _epoch_ms_to_dt(summary.get("startTime")) or info.started_at
    duration_ms = _to_int(summary.get("duration"))

    top_level_error = None
    errors = summary.get("errors") or []
    if errors and stats.get("total", 0) == 0:
        top_level_error = errors[0]

    expected = int(stats.get("expected", 0) or 0)
    unexpected = int(stats.get("unexpected", 0) or 0)
    flaky = int(stats.get("flaky", 0) or 0)
    skipped = int(stats.get("skipped", 0) or 0)
    total = int(stats.get("total", 0) or 0)
    success_rate = _safe_rate(expected + flaky, total)

    run_dict: dict[str, Any] = {
        "kind": info.kind,
        "bucket": info.bucket,
        "source_path": info.source_path,
        "build_number": info.build_number,
        "suite": info.suite,
        "repo_path": info.repo_path,
        "started_at": started_at,
        "run_date": started_at.date(),
        "duration_ms": duration_ms,
        "total": total,
        "passed": expected,
        "failed": unexpected,
        "skipped": skipped,
        "flaky": flaky,
        "errors": len(errors),
        "success_rate": success_rate,
        "ok": stats.get("ok"),
        "top_level_error": top_level_error,
    }

    cases: list[dict] = []
    # Per-file json files in the zip carry the full test detail. The 'files'
    # list in report.json holds a slimmer projection — we use the per-file
    # files for the source of truth.
    for name in zf.namelist():
        if name == "report.json":
            continue
        if not name.endswith(".json"):
            continue
        file_blob = json.loads(zf.read(name))
        for t in file_blob.get("tests", []):
            for r in t.get("results", []):
                cases.append(_playwright_case(t, r, info))

    return run_dict, cases


def _playwright_case(test: dict, result: dict, info: FilenameInfo) -> dict:
    location = test.get("location") or {}
    suite_path = " › ".join(test.get("path") or [])
    errors = result.get("errors") or []
    primary_error = errors[0] if errors else {}
    error_message = primary_error.get("message")
    error_stack = primary_error.get("stack")
    error_snippet = primary_error.get("snippet")

    attachments = result.get("attachments") or []
    attachment_names = [
        a.get("name") for a in attachments if a.get("name")
    ] or None

    status = result.get("status") or TestCaseResult.STATUS_PASSED
    outcome = test.get("outcome")

    module, vendor = classify_module(
        kind=info.kind,
        test_file=location.get("file"),
        suite=info.suite,
    )

    return {
        "kind": info.kind,
        "test_name": test.get("title") or "",
        "test_file": location.get("file"),
        "test_line": location.get("line"),
        "class_fqn": None,
        "package_name": None,
        "suite_path": suite_path or None,
        "project_name": test.get("projectName"),
        "tags": test.get("tags") or None,
        "status": status,
        "outcome": outcome,
        "ok": test.get("ok"),
        "retry": result.get("retry"),
        "started_at": _iso_to_dt(result.get("startTime")),
        "duration_ms": _to_int(result.get("duration")),
        "error_message": _trim(error_message),
        "error_stack": error_stack,
        "error_snippet": error_snippet,
        "step_count": len(result.get("steps") or []) or None,
        "attachment_names": attachment_names,
        "module": module,
        "vendor": vendor,
    }


# ---------------------------------------------------------------------------
# Surefire parser
# ---------------------------------------------------------------------------

_SUREFIRE_ICON_RE = re.compile(r"icon_(success|warning|error)_sml\.gif")
_TC_PREFIX = "TC_"


def parse_surefire(local_path: Path, info: FilenameInfo) -> tuple[dict, list[dict]]:
    html = local_path.read_text()
    soup = BeautifulSoup(html, "html.parser")

    summary = _surefire_summary(soup)
    total = summary["total"]
    errors = summary["errors"]
    failures = summary["failures"]
    skipped = summary["skipped"]
    passed = max(total - errors - failures - skipped, 0)
    duration_ms = int(round(summary["time"] * 1000)) if summary["time"] is not None else None
    success_rate = (
        Decimal(str(summary["success_rate"]))
        if summary["success_rate"] is not None
        else None
    )

    run_dict: dict[str, Any] = {
        "kind": info.kind,
        "bucket": info.bucket,
        "source_path": info.source_path,
        "build_number": info.build_number,
        "suite": info.suite,
        "repo_path": info.repo_path,
        "started_at": info.started_at,
        "run_date": info.started_at.date(),
        "duration_ms": duration_ms,
        "total": total,
        "passed": passed,
        "failed": failures,
        "skipped": skipped,
        "flaky": 0,
        "errors": errors,
        "success_rate": success_rate,
        "ok": (errors + failures) == 0,
        "top_level_error": None,
    }

    cases = _surefire_cases(soup, info)
    return run_dict, cases


def _surefire_summary(soup: BeautifulSoup) -> dict[str, Any]:
    """Pull the single-row summary table that follows the 'Summary' anchor."""
    anchor = soup.find("a", attrs={"name": "Summary"})
    if anchor is None:
        return {"total": 0, "errors": 0, "failures": 0, "skipped": 0, "time": None, "success_rate": None}
    table = anchor.find_next("table")
    if table is None:
        return {"total": 0, "errors": 0, "failures": 0, "skipped": 0, "time": None, "success_rate": None}
    rows = table.find_all("tr")
    # rows[0] is the header, rows[1] is the data row
    if len(rows) < 2:
        return {"total": 0, "errors": 0, "failures": 0, "skipped": 0, "time": None, "success_rate": None}
    cells = [td.get_text(strip=True) for td in rows[1].find_all("td")]
    # Columns: Tests, Errors, Failures, Skipped, Success Rate, Time
    return {
        "total": _to_int(cells[0]) or 0,
        "errors": _to_int(cells[1]) or 0,
        "failures": _to_int(cells[2]) or 0,
        "skipped": _to_int(cells[3]) or 0,
        "success_rate": _parse_percentage(cells[4]),
        "time": _to_float(cells[5]),
    }


def _surefire_cases(soup: BeautifulSoup, info: FilenameInfo) -> list[dict]:
    """Walk each per-class section under Test Cases and emit one row per test."""
    test_cases_anchor = soup.find("a", attrs={"name": "Test_Cases"})
    if test_cases_anchor is None:
        return []

    cases: list[dict] = []
    for h3 in test_cases_anchor.find_all_next("h3"):
        section = h3.parent  # the enclosing <div class="section">
        # The second <a name=…> after the h3 holds the fully-qualified class.
        class_fqn = _surefire_class_fqn(h3)
        if class_fqn is None:
            continue
        package_name = class_fqn.rsplit(".", 1)[0] if "." in class_fqn else None
        table = section.find("table") if section else h3.find_next("table")
        if table is None:
            continue
        cases.extend(_surefire_class_cases(table, class_fqn, package_name, info))

    return cases


def _surefire_class_fqn(h3: Tag) -> str | None:
    """The <h3> short-name tag is followed by `<a name="<FQN>"></a>`."""
    nxt = h3.find_next_sibling("a")
    if nxt is None or not nxt.has_attr("name"):
        return None
    return nxt["name"]


def _surefire_class_cases(
    table: Tag,
    class_fqn: str,
    package_name: str | None,
    info: FilenameInfo,
) -> list[dict]:
    """Iterate rows in a per-class table, emitting one dict per test method.

    A test row has three <td>s: icon, method name (+optional detail toggle),
    duration. Failure/error tests are followed by a short message row and a
    `<div id="...-failure">` or `<div id="...-error">` stack row.
    """
    cases: list[dict] = []
    rows = table.find_all("tr", recursive=False)
    i = 0
    while i < len(rows):
        row = rows[i]
        tds = row.find_all("td", recursive=False)
        i += 1
        if len(tds) < 3:
            continue
        img = tds[0].find("img")
        anchor = tds[1].find("a", attrs={"name": True})
        if img is None or anchor is None:
            continue
        tc_name = anchor.get("name", "")
        if not tc_name.startswith(_TC_PREFIX):
            continue
        identifier = tc_name[len(_TC_PREFIX) :]
        method = _surefire_method(identifier, class_fqn)
        icon_kind = _surefire_icon_kind(img.get("src", ""))
        duration_s = _to_float(tds[2].get_text(strip=True))
        duration_ms = int(round(duration_s * 1000)) if duration_s is not None else None

        status = _surefire_status_for_icon(icon_kind, identifier, table)
        error_message: str | None = None
        error_stack: str | None = None

        if icon_kind in {"error", "warning"}:
            # Next non-empty row should hold the short error message.
            message_row, stack_row, advanced = _surefire_collect_detail(rows, i)
            if message_row is not None:
                error_message = _trim(_extract_message_td(message_row))
            if stack_row is not None:
                stack_div = stack_row.find(
                    "div",
                    attrs={"id": [f"{identifier}-failure", f"{identifier}-error"]},
                )
                if stack_div is not None:
                    pre = stack_div.find("pre")
                    if pre is not None:
                        error_stack = pre.get_text()
                    else:
                        error_stack = stack_div.get_text("\n", strip=True)
            i += advanced

        module, vendor = classify_module(
            kind=info.kind,
            class_fqn=class_fqn,
            package_name=package_name,
        )
        cases.append(
            {
                "kind": info.kind,
                "test_name": method,
                "test_file": None,
                "test_line": None,
                "class_fqn": class_fqn,
                "package_name": package_name,
                "suite_path": None,
                "project_name": None,
                "tags": None,
                "status": status,
                "outcome": None,
                "ok": status == TestCaseResult.STATUS_PASSED,
                "retry": None,
                "started_at": info.started_at,
                "duration_ms": duration_ms,
                "error_message": error_message,
                "error_stack": error_stack,
                "error_snippet": None,
                "step_count": None,
                "attachment_names": None,
                "module": module,
                "vendor": vendor,
            }
        )

    return cases


def _surefire_method(identifier: str, class_fqn: str) -> str:
    """Identifier is `<class_fqn>.<method>`; for @Disabled classes the
    method is the class_fqn itself.
    """
    prefix = class_fqn + "."
    if identifier.startswith(prefix):
        rest = identifier[len(prefix) :]
        return rest or class_fqn
    return identifier


def _surefire_icon_kind(src: str) -> str:
    m = _SUREFIRE_ICON_RE.search(src)
    return m.group(1) if m else ""


def _surefire_status_for_icon(icon_kind: str, identifier: str, table: Tag) -> str:
    if icon_kind == "success":
        return TestCaseResult.STATUS_PASSED
    if icon_kind == "warning":
        return TestCaseResult.STATUS_SKIPPED
    if icon_kind == "error":
        # Distinguish failure (assertion) vs error (unexpected exception) by
        # the `<div id>` suffix attached to the test.
        if table.find("div", attrs={"id": f"{identifier}-failure"}) is not None:
            return TestCaseResult.STATUS_FAILED
        return TestCaseResult.STATUS_ERROR
    return TestCaseResult.STATUS_PASSED


def _surefire_collect_detail(rows: list[Tag], start_idx: int) -> tuple[Tag | None, Tag | None, int]:
    """Find the message row (no icon, short text) and the stack row
    (containing the `<pre>`). Returns `(message_row, stack_row, n_rows_consumed)`.

    Surefire emits an empty separator row between the main test row and the
    message row in some cases, so scan up to a few rows ahead.
    """
    message: Tag | None = None
    stack: Tag | None = None
    consumed = 0
    look = 0
    while start_idx + look < len(rows) and look < 4:
        candidate = rows[start_idx + look]
        tds = candidate.find_all("td", recursive=False)
        look += 1
        if len(tds) < 2:
            continue
        # A new test starts when the first td has an <img>.
        if tds[0].find("img") is not None:
            break
        if candidate.find("div", attrs={"id": True}) is not None:
            stack = candidate
            consumed = look
            continue
        text = tds[1].get_text(strip=True) if len(tds) >= 2 else ""
        if text and message is None:
            message = candidate
            consumed = look
    return message, stack, consumed


def _extract_message_td(row: Tag) -> str:
    tds = row.find_all("td", recursive=False)
    if len(tds) < 2:
        return ""
    return tds[1].get_text(" ", strip=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_percentage(value: str) -> float | None:
    if not value:
        return None
    stripped = value.strip().rstrip("%")
    try:
        return float(stripped)
    except ValueError:
        return None


def _safe_rate(numerator: int, denominator: int) -> Decimal | None:
    if denominator <= 0:
        return None
    return (Decimal(numerator) * Decimal(100) / Decimal(denominator)).quantize(Decimal("0.001"))


def _epoch_ms_to_dt(value: Any) -> datetime | None:
    ms = _to_int(value)
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)


def _iso_to_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _trim(value: str | None, limit: int = 2000) -> str | None:
    if value is None:
        return None
    return value if len(value) <= limit else value[:limit]


__all__ = [
    "FilenameInfo",
    "parse_filename",
    "parse_playwright",
    "parse_surefire",
]
