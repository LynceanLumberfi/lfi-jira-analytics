"""Classify each test case into a top-level product module (and an optional
integration vendor sub-tag) based on its kind + naming.

Rules live here so they're easy to tweak in one place — the parser calls
`classify(...)` per case, and the backfill CLI calls it over historical rows.

Module names are stable strings used as DB enum-like values; do not rename
without a migration to update existing rows.
"""
from __future__ import annotations

import re
from typing import Optional


MODULE_TIMESHEET = "Timesheet"
MODULE_PAYROLL = "Payroll"
MODULE_TIME_OFF = "Time Off"
MODULE_ONBOARDING = "Onboarding"
MODULE_SCHEDULING = "Scheduling"
MODULE_USER_MGMT = "User Management"
MODULE_INTEGRATIONS = "Integrations"
MODULE_REPORTING = "Reporting"
MODULE_IMPLEMENTATION = "Implementation"
MODULE_ACCESS = "Access & Permissions"
MODULE_COMPENSATION = "Compensation"
MODULE_OTHER = "Other / Core"


ALL_MODULES = (
    MODULE_TIMESHEET,
    MODULE_PAYROLL,
    MODULE_TIME_OFF,
    MODULE_ONBOARDING,
    MODULE_SCHEDULING,
    MODULE_USER_MGMT,
    MODULE_INTEGRATIONS,
    MODULE_REPORTING,
    MODULE_IMPLEMENTATION,
    MODULE_ACCESS,
    MODULE_COMPENSATION,
    MODULE_OTHER,
)


# Vendor keywords used for both "is integration?" detection and the vendor tag.
# Order matters when packages overlap — e.g. `sage.intacct` should map to
# Sage Intacct, not generic Sage. Use the most specific match.
_VENDOR_RULES: tuple[tuple[str, str], ...] = (
    ("sage.intacct", "Sage Intacct"),
    ("sage", "Sage"),
    ("acumatica", "Acumatica"),
    ("netsuite", "NetSuite"),
    ("procore", "Procore"),
    ("spectrum", "Spectrum"),
    ("premier", "Premier"),
    ("quickbase", "Quickbase"),
    ("buildops", "BuildOps"),
    ("heavyjob", "HeavyJob"),
    ("knowify", "Knowify"),
    ("nmbr", "NMBR"),
    ("agave", "Agave"),
    ("symmetry", "Symmetry"),
    ("descope", "Descope"),
    ("quartz", "Quartz"),
)


# ---------------------------------------------------------------------------
# Playwright — directory name (the segment after `e2e/`) and the suite name
# (parsed earlier from the filename) drive the module.
#
# Lookups are lowercased; matching is "first hit wins".
# ---------------------------------------------------------------------------

_PW_DIR_TO_MODULE: dict[str, str] = {
    # User management / employee admin
    "adduser": MODULE_USER_MGMT,
    "user-management": MODULE_USER_MGMT,
    "restricted-admin": MODULE_USER_MGMT,
    "restricted-admin-permissions": MODULE_USER_MGMT,
    # Onboarding
    "onboardinguser": MODULE_ONBOARDING,
    "onboarding": MODULE_ONBOARDING,
    # Scheduling
    "scheduler": MODULE_SCHEDULING,
    # Timesheet
    "timesheets": MODULE_TIMESHEET,
    "timesheet-audit": MODULE_TIMESHEET,
    "timesheet-overview": MODULE_TIMESHEET,
    # Time off
    "timeoff": MODULE_TIME_OFF,
    # Payroll
    "payroll": MODULE_PAYROLL,
    "payroll-settings": MODULE_PAYROLL,
    "travelpay-payroll-flow": MODULE_PAYROLL,
    "union-payrate": MODULE_PAYROLL,
    "lumberai-payroll-flow": MODULE_PAYROLL,
    "private-worker-with-union-project": MODULE_PAYROLL,
    "post-tax-deductions": MODULE_PAYROLL,
    # Compensation / pay rate
    "pay-rate-section": MODULE_COMPENSATION,
    "project-compensation-rules-workflow": MODULE_COMPENSATION,
    "holiday-config": MODULE_COMPENSATION,
    # Access
    "navbar-access": MODULE_ACCESS,
    "ssn-security-number": MODULE_ACCESS,
    # Implementation
    "implementation": MODULE_IMPLEMENTATION,
}

# Playwright filename-suite → module. The filename suite is more reliable
# than the file path when the latter is unusual.
_PW_SUITE_TO_MODULE: dict[str, str] = {
    "employee": MODULE_USER_MGMT,
    "onboarding": MODULE_ONBOARDING,
    "scheduler": MODULE_SCHEDULING,
    "timeoff": MODULE_TIME_OFF,
    "timesheet-audit": MODULE_TIMESHEET,
    "timesheet-core-1": MODULE_TIMESHEET,
    "timesheet-core-2": MODULE_TIMESHEET,
    "timesheet-overview": MODULE_TIMESHEET,
    "forms": MODULE_USER_MGMT,
    "implementation": MODULE_IMPLEMENTATION,
    # 'smoke' covers many modules — leave as None so we fall back to file path.
}


# ---------------------------------------------------------------------------
# Surefire — package keyword rules. First match wins, so put more specific
# patterns first (e.g. timesheet before generic 'service').
#
# Each entry: (regex over lowercase class_fqn, module).
# ---------------------------------------------------------------------------

_SF_RULES: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(r"\.timesheet[._]"), MODULE_TIMESHEET),
    (re.compile(r"timesheet"), MODULE_TIMESHEET),
    (re.compile(r"\.exports?[._]"), MODULE_REPORTING),
    (re.compile(r"\.report[._]"), MODULE_REPORTING),
    (re.compile(r"custominvoice|invoicereport|reportentry|timebycostcode|timebytask|schedulebytask"), MODULE_REPORTING),
    (re.compile(r"\.leave[._]|\.leavecategory[._]|leaveallocation"), MODULE_TIME_OFF),
    (re.compile(r"holiday"), MODULE_TIME_OFF),
    (re.compile(r"\.onboarding[._]|onboardingemail|onboardingsettings"), MODULE_ONBOARDING),
    (re.compile(r"\.scheduler[._]|scheduleby|schedulelock"), MODULE_SCHEDULING),
    (re.compile(r"payroll|payrate|earningrate|compcode|deduction"), MODULE_PAYROLL),
    (re.compile(r"compensation|payrate"), MODULE_COMPENSATION),
    (re.compile(r"\.integrations?[._]"), MODULE_INTEGRATIONS),
    (re.compile(r"\.(sage|acumatica|netsuite|procore|spectrum|premier|quickbase|buildops|heavyjob|knowify|nmbr|agave|symmetry)\."), MODULE_INTEGRATIONS),
    (re.compile(r"\.descope[._]|\.auth[._]"), MODULE_ACCESS),
    (re.compile(r"companyuser|userservice|userreferral|userverification|adduser|companyholiday"), MODULE_USER_MGMT),
    (re.compile(r"\.quartz[._]|quartzadmin"), MODULE_INTEGRATIONS),
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify(
    *,
    kind: str,
    class_fqn: Optional[str] = None,
    test_file: Optional[str] = None,
    package_name: Optional[str] = None,
    suite: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """Return (module, vendor) for one test case.

    Lookup order:
      Playwright -> file-path dir -> suite -> Other.
      Surefire   -> class_fqn / package_name keywords -> Other.

    Vendor is only set when the module is Integrations.
    """
    if kind == "playwright":
        module = _classify_playwright(test_file, suite)
        vendor = _vendor_from_text(test_file or "") if module == MODULE_INTEGRATIONS else None
        return module, vendor

    if kind == "surefire":
        module = _classify_surefire(class_fqn, package_name)
        vendor = _vendor_from_text((class_fqn or "") + " " + (package_name or "")) if module == MODULE_INTEGRATIONS else None
        return module, vendor

    return MODULE_OTHER, None


def _classify_playwright(test_file: Optional[str], suite: Optional[str]) -> str:
    # 1) Try the file-path directory (`e2e/<dir>/...`).
    if test_file:
        parts = test_file.split("/")
        if len(parts) >= 2 and parts[0] == "e2e":
            dir_key = parts[1].lower()
            if dir_key in _PW_DIR_TO_MODULE:
                return _PW_DIR_TO_MODULE[dir_key]
    # 2) Fall back to the filename suite.
    if suite:
        s = suite.lower()
        if s in _PW_SUITE_TO_MODULE:
            return _PW_SUITE_TO_MODULE[s]
    return MODULE_OTHER


def _classify_surefire(class_fqn: Optional[str], package_name: Optional[str]) -> str:
    haystack = (class_fqn or "")
    if package_name and package_name not in haystack:
        haystack = f"{haystack} {package_name}"
    haystack = haystack.lower()
    for pattern, module in _SF_RULES:
        if pattern.search(haystack):
            return module
    return MODULE_OTHER


def _vendor_from_text(text: str) -> Optional[str]:
    t = text.lower()
    for keyword, vendor in _VENDOR_RULES:
        if keyword in t:
            return vendor
    return None


__all__ = ["classify", "ALL_MODULES"]
