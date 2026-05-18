# Progress

## Analytics: AI Adoption tab + Resource tab ✅ / 🚧 (2026-05-15)

### AI Adoption tab — complete

Full analytics view for skill adoption across sprint-associated Stories.

| Component | What it does |
|---|---|
| `AiAdoption.jsx` | Overview: 4 KPI heroes (story skill %, dev skill %, top team × 2), 12-week trend chart, stories table |
| `AiAdoptionTeam.jsx` | Team drill-down: 2 KPI heroes, trend chart, dev bar chart, stories table |
| `StoriesTable.jsx` | Reusable filterable + sortable issues table with inline `IssueDrawer` |
| `SkillAdoptionTrendsChart.jsx` | 12-week dual-line chart (stories % + devs %) |
| `DevSkillAdoptionChart.jsx` | Horizontal bar chart per dev, sorted by rate |
| `analytics_service.story_trends` | Added `has_sprint` filter; `done_any_weekly` CTE scoped to `issue_type='Story'` (fixes dev count inflation bug) |
| `analytics_service.by_assignee` | Added `team_ids` filter |
| `analytics_service.AnalyticsFilters` | Added `has_sprint: bool | None` field |
| Backend API | `has_sprint` query param on story-trends; `team_ids` on by-assignee |
| `api.js` | `getAnalyticsStoryTrends`, `getAnalyticsByTeam`, `getAnalyticsByAssignee` updated for new params |
| `Topbar.jsx` | Breadcrumb CRUMBS map corrected for all analytics + admin routes |

Key decisions:
- All AI Adoption queries filter `has_sprint: true` — only sprint-associated stories count.
- `done_any_weekly` bug fix: was counting devs across all issue types; scoped to Stories only.
- `StoriesTable` is self-contained (filter bar + sort + IssueDrawer) — used on both Overview and Team pages.

### Resource tab — complete

Capacity and velocity view.

| Component | What it does |
|---|---|
| `Resource.jsx` | 4 KPI heroes (story points, active devs, pts/dev, hours/point), 12-week trend chart, team breakdown table |
| `ResourceTrendsChart.jsx` | Dual-axis chart: bars (story points, left y) + line (active devs, right y), tooltip shows pts/dev |

Uses same `story_trends` endpoint as AI Adoption — `points_per_active_resource`, `active_resources`, `hours_per_point` fields already present in `StoryTrendOut`.

---

## JiraClient migration to /search/jql + live credentials wired ✅ Complete (2026-05-11)

### What changed

| Change | Where |
|---|---|
| `JiraClient.search_issues` now POSTs to `/rest/api/3/search/jql` with `nextPageToken` cursor pagination (Atlassian retired the old `GET /rest/api/3/search` — it returns 410 Gone). Accepts `fields` as `*all` / `*navigable` / comma-string / list. | `backend/app/services/jira_client.py` |
| `JiraClient.get_issue_count` now POSTs to `/rest/api/3/search/approximate-count`. The new search/jql endpoint no longer returns `total`; this sibling endpoint gives an approximate (but stable across a run) count for the `syncing` phase's `items_total` ETA. | same |
| Pipeline diagram and §5 sync description updated to reflect the new endpoint shape. | `ARCHITECTURE.md` |
| Live Jira credentials wired in `.env`: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, plus `JIRA_PROJECT_KEY=TIM`. | `.env` (gitignored) |
| Custom-field IDs verified against `/rest/api/3/field` and overridden where Lumberfi's IDs differ from defaults: `JIRA_FIELD_STORY_POINTS=customfield_10031` (team uses "Story Points", not the next-gen "Story point estimate"), `JIRA_FIELD_REPORTED_BY_CUSTOMER=customfield_10078`, `JIRA_FIELD_CUSTOMER=customfield_10077`, `JIRA_FIELD_PROD_RELEASE_DATE=customfield_10439`. The rest (sprint / team / epic_link) matched the Jira-Cloud defaults. | `.env` |

### Why the migration matters

Without it, the first `POST /api/sync` from the frontend would have failed with 410 Gone, and every analytics column that depends on custom fields (story points, customers, prod release date, reported-by-customer) would have been NULL because the default custom-field IDs don't match Lumberfi's actual schema.

### Live verification against `lumberfi.atlassian.net`

| Probe | Result |
|---|---|
| `GET /rest/api/3/myself` | 200, returns `Lyncean Patel` / accountId / email — credentials valid |
| `POST /rest/api/3/search/jql` with page_size=2 | Cursor pagination works across multiple pages; first 5 issues fetched with summary/status/issuetype intact |
| `POST /rest/api/3/search/approximate-count` for `project = TIM` | 26,538 |
| `project = TIM AND updated >= 2026-01-02` | 12,187 — this is the planned first-sync scope |
| `project = TIM AND updated >= -1d` (narrow probe) | 492 — pagination terminates cleanly |

### Story-points field probe

Two candidate fields existed: `customfield_10016` ("Story point estimate", next-gen default) and `customfield_10031` ("Story Points", classic). Live probe against 8 recent TIM Stories showed all real values in `10031` and `10016` always NULL → picked `10031`.

### Verification

All six harnesses still green — `MockJiraClient` short-circuits both methods so the harness suite was unaffected by the real-client migration: 17 + 17 + 29 + 21 + 32 + 25 = **141 scenarios.**

### First-sync plan (UI-triggered)

User will trigger from the frontend. Server-side scope and shape:

```
POST /api/sync  body: {"since": "2026-01-02T00:00:00Z"}
JQL:  project = TIM AND updated >= "2026-01-02" ORDER BY updated ASC
Approx count: 12,187
```

The first sync will create ~12k pending `staging_issues` rows. The frontend will need either a bulk-skip / bulk-approve workflow or chunked promote (`?limit=N`) to make the backlog manageable.

---

## API pass for frontend integration ✅ Complete (2026-05-11)

### Goal

The frontend will pull Jira → staging → promote → sanitize → score with a progress UI for each step. This pass closes the gaps that were blocking a uniform polling model.

### What changed

| # | Change | Where |
|---|---|---|
| 1 | **Background promote.** `POST /api/staging/promote` returns 202 + `SyncStateOut` immediately. A `_run_promote_bg` worker carries the actual work and updates the sync_state. Frontend polls `/api/sync/state/{id}` for the `promoting` phase. | `app/api/staging.py` |
| 2 | **Background sanitize.** Same shape — 202 + `SyncStateOut`, background worker, `extracting` + `reconciling` phases. | `app/api/sanitize.py` |
| 3 | **Unified scoring as a sync_state.** `POST /api/score` now creates a `sync_state` (`triggered_by='api-score'`) and `score_pending(sync_state_id=…)` opens a `scoring` phase with per-row `tick` + final `{scored, failed, no_description}` metrics. The frontend can poll progress the same way as promote/sanitize via `/api/sync/state/{id}`. The existing `/api/score/state` endpoint also exposes `latest_sync_state_id` for convenience. | `app/api/score.py`, `app/services/scoring_service.py` |
| 4 | **`GET /api/sync/state/{id}`.** Fetch any sync_state by id with phases. 404 if not found. Primary endpoint for the UI to poll a specific run after triggering it. | `app/api/sync.py` |
| 5 | **`?kind=` filter** on `GET /api/sync/state` and `GET /api/sync/history`. Values: `sync` / `promote` / `sanitize` / `score`. `kind=sync` excludes the non-sync `triggered_by` set; others match exactly. | `app/api/sync.py` |
| 6 | **`POST /api/staging/skip-all`.** Bulk-flips all `pending` rows to `skipped` with optional `?reviewed_by=`. Skipped is terminal; PATCH back to `approved` to revive a row. | `app/api/staging.py`, `app/services/staging_service.py` |
| 7 | **`dry_run` on `POST /api/score`.** `ScoreTriggerRequest.dry_run: bool = False`. Passed through to `score_pending(dry_run=...)`. Counts attempted + no_description without invoking the claude CLI; claims are released back to `pending`. | `app/api/score.py`, `app/schemas/scoring.py` |
| 8 | **Lifespan resets stuck `in_progress` ai_scores.** uvicorn startup unconditionally flips any `in_progress` rows back to `pending` (the previous worker is gone). Removes the up-to-60-min wait under the `synced_at` proxy reaper. | `app/main.py` |

### Constants added (no schema changes — all string discriminators)

| Constant | Value |
|---|---|
| `SyncState.TRIGGERED_BY_SYNC` | `"api"` |
| `SyncState.TRIGGERED_BY_PROMOTE` | `"api-promote"` |
| `SyncState.TRIGGERED_BY_SANITIZE` | `"api-sanitize"` |
| `SyncState.TRIGGERED_BY_SCORE` | `"api-score"` *(new)* |
| `SyncState.NON_SYNC_TRIGGERED_BY` | tuple of the above three non-sync values |
| `SyncPhase.PHASE_SCORING` | `"scoring"` *(new)* |
| `reaper_service._TRIGGERED_BY_TO_PHASE` | now includes the SCORE mapping |

### Response-shape changes (one breaking, all noted for the frontend)

| Endpoint | Before | After |
|---|---|---|
| `POST /api/staging/promote` | 200 `PromoteResult{sync_state_id, promoted, failed}` (synchronous) | **202 `SyncStateOut`** (background); read results from the closed `promoting` phase's metrics |
| `POST /api/sanitize` | 200 `SanitizeResult{sync_state_id, …}` (synchronous) | **202 `SyncStateOut`** (background); read results from `extracting` + `reconciling` phase metrics |
| `POST /api/score` | 202 `ScoreTriggerOut` (background already) | 202 `ScoreTriggerOut` with **new `sync_state_id` field** |
| `GET /api/score/state` | as before | adds **`latest_sync_state_id`** |
| `ScoreTriggerRequest` | `{limit, model?, triggered_by?}` | adds **`dry_run: bool = False`** |
| `ScoringStateOut` | as before | adds **`latest_sync_state_id: int \| None`** |

`PromoteResult` and `SanitizeResult` schemas were removed (no longer returned by any endpoint). `SkipAllResult{skipped: int}` added.

### Verification

- All 6 harnesses still green (added scoring `K1` for `sync_state_id` phase tracking → 25/25).
- Smoke against `TestClient`:
  - `/api/sync/state/{nonexistent}` → 404
  - `/api/sync/state?kind=promote` → filters correctly
  - `POST /api/staging/promote` → 202 with `triggered_by='api-promote'`; `GET /api/sync/state/{id}` returns the `promoting` phase with `items_processed=1, items_total=1, metrics={promoted:1, failed:0}`; issue actually promoted in `issues` table.
  - `POST /api/staging/skip-all?reviewed_by=tester` → 3 pending → skipped (reviewed_by attributed); already-approved row untouched.
  - `GET /api/score/state` exposes `latest_sync_state_id` and `total_cost_usd_sum`.

### Frontend integration model (intended)

For each pipeline step the UI follows the same shape:

```
1. POST /api/<step>          → 202 SyncStateOut { id, status, triggered_by, started_at, ... }
2. (poll)  GET /api/sync/state/{id}    → SyncStateOut with phases[]
3. When state.status == "success" or "error" → done
```

Per-step specifics:

| Step | Trigger | `triggered_by` | Phase(s) recorded | Final metric source |
|---|---|---|---|---|
| Sync | `POST /api/sync` | `api` | `syncing` | `state.issues_synced`; phase metrics |
| Promote | `POST /api/staging/promote?limit=N` | `api-promote` | `promoting` | phase metrics `{promoted, failed}` |
| Sanitize | `POST /api/sanitize` | `api-sanitize` | `extracting`, `reconciling` | phase metrics |
| Score | `POST /api/score` `{limit, dry_run?}` | `api-score` | `scoring` | phase metrics `{scored, failed, no_description}` + `/api/score/state` for tokens + cost |

### Verification

All six harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` | 29 | 29/29 ✅ |
| `verify_promote_flow2.py` | 21 | 21/21 ✅ |
| `verify_sanitize_flow1.py` | 32 | 32/32 ✅ |
| `verify_scoring_flow1.py` | 25 | 25/25 ✅ |

**Total: 141 scenarios passing.**

---

## Step 4 / Scoring: code review fixes + verification harness ✅ Complete (2026-05-11)

### What changed

| Area | Change |
|---|---|
| Status vocabulary | Aligned on `pending → in_progress → completed \| failed`. Code was already canonical (`completed`); docs §10 and `verify_sanitize_flow1.py` H3/H4/I1 pre-inserts flipped from `"scored"` to `"completed"`. |
| Concurrency | `_claim_pending` does `SELECT FOR UPDATE SKIP LOCKED + UPDATE…RETURNING` in one statement — two workers run disjoint sets, and `in_progress` is a real state (not just doc). `_reap_stale_in_progress` resets rows whose joined `issues.synced_at` is older than 60 min back to `pending` on each call. The in-process lock survives as a same-process re-entry guard; `is_running` in `GET /api/score/state` derives from `count(in_progress)`. |
| New columns | `issue_ai_scores.ai_score INT` and `issue_ai_scores.total_cost_usd NUMERIC(10,6)` — promoted out of `raw_response` JSONB so analytics can filter on numeric ai_score and sum cost without unpacking JSON. Sanitize Pass 2's rescore branch also nulls them. |
| `TIMEOUT` error code | New `FailedRecord.CODE_TIMEOUT` + CHECK update. `failure_service.classify` maps `subprocess.TimeoutExpired` and `httpx.TimeoutException` to it. `_FIX_STEPS[TIMEOUT]` suggests bumping `SCORING_TIMEOUT_SECS`. |
| Subscription rate-limit handling | `ScoringRateLimitedError` raised by `_invoke_claude` and `_parse_cli_output` when stderr/stdout/`is_error` text matches `(usage limit\|rate.?limit\|too many requests\|quota\|try again in)`. The `score_pending` loop catches it specifically, records the current row as `failed` with `error_code=RATE_LIMITED`, releases remaining `in_progress` claims back to `pending`, and **stops the batch** — no more burning through your daily quota on rows that will all fail the same way. |
| API endpoints open `sync_state` | `POST /api/staging/promote` and `POST /api/sanitize` each create a sync_state (`triggered_by='api-promote'` / `'api-sanitize'`) so the UI can poll progress. `PromoteResult` and `SanitizeResult` return `sync_state_id`. |
| Sync 409 guard scoped | `POST /api/sync` now ignores running `sync_state` rows whose `triggered_by` is one of the non-sync values (`api-promote`, `api-sanitize`) — they no longer block new syncs. Canonical constants live on `SyncState.TRIGGERED_BY_PROMOTE` / `TRIGGERED_BY_SANITIZE` / `NON_SYNC_TRIGGERED_BY`. |
| Reaper phase derivation | A reaped `sync_state` whose `triggered_by` is `api-promote` / `api-sanitize` now lands in `failed_records.phase` as `promote` / `sanitize` instead of always `sync`. |

### Subscription context (clarification for §10 of ARCHITECTURE.md)

This tool is designed for a **Claude Code subscription (Pro / Max)**, not an API key. `_invoke_claude` shells out to the `claude` CLI which uses your local Claude Code session, so:

- `issue_ai_scores.total_cost_usd` and `ScoringStateOut.total_cost_usd_sum` are **informational**, not billing. Treat them as a usage proxy.
- Subscription tiers cap how many prompts you can issue in a 5-hour window. Mid-batch rate limits now stop the batch cleanly (released rows pick up on the next call after the cap resets).
- Run small batches (`--limit N` on the CLI, `?limit=N` on the API) and re-run after the cap resets.

### Code touched

- `backend/app/services/scoring_service.py` — `_claim_pending`, `_release_claims`, `_reap_stale_in_progress`, `ScoringRateLimitedError`, `_RATE_LIMIT_PATTERN`, `_looks_rate_limited`, rate-limit detection in `_invoke_claude` + `_parse_cli_output`, bail-out branch in `score_pending`, new column writes in `_write_score` / `_mark_no_description`
- `backend/app/services/sanitize_service.py` — rescore branch nulls `ai_score` + `total_cost_usd`
- `backend/app/services/failure_service.py` — `TimeoutExpired` → `TIMEOUT`, `_FIX_STEPS[TIMEOUT]`
- `backend/app/services/reaper_service.py` — `_phase_for(state)` derives `failed_records.phase` from `triggered_by`
- `backend/app/models/issue_ai_score.py` — new `ai_score`, `total_cost_usd` columns
- `backend/app/models/failed_record.py` — `CODE_TIMEOUT` + CHECK update
- `backend/app/models/sync_state.py` — `TRIGGERED_BY_PROMOTE` / `TRIGGERED_BY_SANITIZE` / `NON_SYNC_TRIGGERED_BY`
- `backend/app/api/score.py` — `is_running` from `in_progress` count; surfaces `total_cost_usd_sum` + `in_progress`
- `backend/app/api/staging.py`, `backend/app/api/sanitize.py` — sync_state creation; use new SyncState constants
- `backend/app/api/sync.py` — 409 guard filters non-sync triggered_by
- `backend/app/schemas/scoring.py` — `ScoringStateOut.in_progress`, `total_cost_usd_sum`
- `backend/app/schemas/staging.py` — `PromoteResult.sync_state_id`
- `backend/alembic/versions/000100_initial_schema.py` — re-squashed for new columns + CHECK update

### Step 4 verification harness

`backend/cli/verify_scoring_flow1.py` — 24 scenarios across 8 groups. `subprocess.run` and `_load_agent` patched per-scenario so the real `claude` CLI is never invoked:

| Group | Scenarios | What's covered |
|---|---|---|
| A | A1, A2 | No pending rows; single Story happy path |
| B | B1, B2 | NULL / whitespace-only description short-circuits (no subprocess call) |
| C | C1, C2, C3 | High vs low `ai_score` flips `ai_plan_detected`; `skill_name=null` |
| D | D1–D5 | Parse failures: missing keys, out-of-range, wrong type, invalid skill, no JSON in response |
| E | E1–E5 | CLI not found; non-rate-limit nonzero exit; `TimeoutExpired` → TIMEOUT; rate-limit bail on first call; rate-limit bail mid-batch (rows after the failure released to `pending`) |
| G | G1, G2, G3 | `limit=N` honored; `issues.id` ordering; non-Story types ignored by the claim |
| H | H1 | Model resolution precedence: CLI arg > env > agent frontmatter |
| I, J | I1, I2, J1 | Dry-run (no DB writes / no subprocess); stale `in_progress` reaped before claim |

The harness aborts loudly at startup if it finds any non-`VERIFY-SC1-` pending Story `issue_ai_scores` rows in the DB — those would be picked up by the global `_claim_pending` and pollute G1's `limit` assertion.

### Verification

All six harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` | 29 | 29/29 ✅ |
| `verify_promote_flow2.py` | 21 | 21/21 ✅ |
| `verify_sanitize_flow1.py` | 32 | 32/32 ✅ |
| `verify_scoring_flow1.py` | 24 | 24/24 ✅ |

**Total: 140 scenarios passing.**

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
.jira-analytics/bin/python backend/cli/verify_promote_flow2.py
.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py
.jira-analytics/bin/python backend/cli/verify_scoring_flow1.py
```

---

## Pre-launch gap fixes: metrics, pagination, deletions, phase tracking ✅ Complete (2026-05-11)

### What changed (six gaps closed)

1. **`issue_metrics` is now populated.** `persist_issue` calls `_upsert_issue_metrics` after child upserts. Computes `cycle_time_hours`, `lead_time_hours`, `reopen_count`, `comment_count` from already-persisted `changelogs` + `comments` + `issues.created_at` / `resolved_at`. NULL/0 when the underlying signal is absent.
2. **Worklog pagination wired.** `_upsert_worklogs` now detects `worklog.total > len(inline)` and calls `JiraClient.get_issue_worklogs(key)` to fetch the complete set before upserting. Silent data loss for issues with >20 worklogs is gone.
3. **Comments / attachments / worklogs propagate Jira deletions.** Items in DB but absent from the payload are DELETEd. Worklogs only delete-not-in-payload when the complete set was fetched (pagination succeeded), so a network failure can't drop rows we couldn't see.
4. **Promote has a `promoting` phase row.** `promote_approved(db, sync_state_id=N)` opens a phase, ticks per row, closes with `{promoted, failed}` metrics. UI can poll progress now.
5. **Promote accepts a batch limit.** `promote_approved(db, limit=N)` processes at most N rows; remaining stay `approved` for a follow-up call. The API endpoint exposes `?limit=` (1..10000).
6. **`POST /api/sanitize` and `POST /api/staging/promote` open a `sync_state`.** Each endpoint creates a `running` sync_state, dispatches the work with its id, then closes the state to `success` or `error`. Both responses now return `sync_state_id` so the UI can poll `extracting`/`reconciling`/`promoting` phase rows.

### Behavior changes summary

| Before | After |
|---|---|
| `issue_metrics` always NULL | Populated by `persist_issue` |
| `>20 worklogs` silently dropped | Paginated via `JiraClient.get_issue_worklogs` |
| Items deleted in Jira leaked into our DB | Comments / attachments / worklogs DELETEd when absent from payload (worklogs gated on complete set) |
| Promote had no phase row | `promoting` phase recorded when `sync_state_id` is provided |
| Promote was unbounded | `limit=N` caps the batch size |
| Sanitize/promote API endpoints had no sync_state | Both create a `sync_state`, return `sync_state_id` |

### Schema change

| Column / index | Notes |
|---|---|
| `SyncPhase.PHASE_PROMOTING = "promoting"` | New phase constant (no DB-level constraint — `phase` is a free string) |

### Code touched

- `backend/app/services/jira_client.py` — new `get_issue_worklogs(issue_key, page_size)` paginates `/rest/api/3/issue/{key}/worklog`.
- `backend/app/services/sync_service.py` — new `_upsert_issue_metrics`, new `_delete_missing_children`; `_upsert_comments`/`_upsert_attachments` track `seen_ids` and call delete-not-in-payload; `_upsert_worklogs` pages on `total > len(inline)` and gates delete-not-in-payload on `full_set_known`.
- `backend/app/services/staging_service.py` — `promote_approved(db, sync_state_id=None, limit=None)`; phase row open/tick/close.
- `backend/app/models/sync_phase.py` — `PHASE_PROMOTING` constant.
- `backend/app/api/staging.py` — `POST /api/staging/promote` creates a `sync_state`, accepts `?limit=`, returns `sync_state_id`.
- `backend/app/api/sanitize.py` — `POST /api/sanitize` creates a `sync_state` and passes its id to `run_sanitize`.
- `backend/app/schemas/staging.py` — `PromoteResult` gains `sync_state_id`.

### Decisions revisited

| Question | Outcome |
|---|---|
| `issue_metrics`: keep + populate, or delete? | **Populate** — derivable from existing data, and `v_issue_facts` already JOINs it |
| Worklog pagination: paginate or accept loss? | **Paginate** — silent data loss is the worst kind |
| Comments / attachments: propagate deletions? | **Yes** — the inline payload is authoritative for these fields |
| Worklogs: propagate deletions? | **Yes, but gated on complete-set knowledge** — never delete after a failed pagination |

### New verification scenarios

| Harness | New scenarios |
|---|---|
| `verify_promote_flow1.py` | K1 (metrics row exists with comment/reopen counts), K2 (cycle_time + lead_time from changelog), K3 (reopen_count counts done→non-done), P1 (`promoting` phase row recorded), P2 (`limit=N` honored) |
| `verify_promote_flow2.py` | G1/G2/G3 flipped from "stale row preserved (gap)" to "deletion propagated" (now passing assertions); W1 (pagination fetches the complete set), W2 (pagination failure → fall back, no deletion) |

### Verification

All five harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` | 29 | 29/29 ✅ |
| `verify_promote_flow2.py` | 21 | 21/21 ✅ |
| `verify_sanitize_flow1.py` | 32 | 32/32 ✅ |

**Total: 116 scenarios passing.**

### Notable harness fix

`verify_staging_flow1.py` scenario A7 (`persist_issue` worklog test) cleanup didn't account for the new `issue_metrics` row created by `persist_issue` → DELETE on `issues` failed FK → row leaked → next harness saw an extra Story → cascading false failures. Fixed by deleting `issue_metrics` and `issue_ai_scores` first in A7's cleanup.

---

## Sanitize Flow 2: caching guard for Pass 1 ✅ Complete (2026-05-08)

### What changed

**New behavior**: sanitize Pass 1 now caches successful extractions on the attachment row. A second sanitize on stable data does zero downloads.

| Concern | Before | After |
|---|---|---|
| Re-runs of sanitize | Always re-downloaded every plan attachment | Skipped if `extracted_at IS NOT NULL` on the chosen attachment |
| API calls per Story-with-plan, per sanitize | 1 every time | 1 the first time, 0 thereafter (until a newer attachment appears) |
| Cache invalidation when a newer plan is uploaded | N/A | Automatic via `DISTINCT ON (issue_id) ORDER BY created_at DESC` — new attachment row has `extracted_at IS NULL` |
| Force re-extraction | Always | `UPDATE attachments SET extracted_at = NULL WHERE …` |

### Schema change

| Column | Notes |
|---|---|
| `attachments.extracted_at TIMESTAMPTZ NULL` | NULL = never extracted; non-NULL = `now()` at successful extraction |

### Code touched

- `backend/app/models/attachment.py` — new `extracted_at` mapped column.
- `backend/app/services/attachment_extractor.py` — query now selects `extracted_at`, filters cached rows out of `targets`, stamps `extracted_at = now()` on success in the same transaction as the description UPDATE. Stats dict gains `skipped_cached`.
- `backend/app/services/sanitize_service.py` — `run_sanitize` exposes `extraction_skipped_cached` in the result dict.

### Migration squash

Re-squashed to a single `000100_initial_schema.py` per pre-launch policy:

1. `alembic downgrade base`
2. wipe `backend/alembic/versions/`
3. `alembic revision --autogenerate --rev-id 000100 -m "initial_schema"` — autogen captured `extracted_at` automatically
4. manually re-added the 5 analytics views (`v_issue_facts`, `v_team_aggregates`, `v_assignee_aggregates`, `v_sprint_velocity`, `v_epic_progress`) in `upgrade()` and the `DROP VIEW` calls in `downgrade()`
5. `alembic upgrade head`
6. `alembic check` → "No new upgrade operations detected"

### New harness scenarios (verify_sanitize_flow1.py, Group M)

| ID | What it checks |
|---|---|
| M1 | Cache guard: second sanitize on stable data has `mock.calls` length still 1 and `extraction_skipped_cached=1` |
| M2 | Cache invalidates when a newer plan attachment is uploaded → second sanitize re-downloads the new one and overwrites description |
| M3 | Full no-op re-sanitize: zero downloads, zero ai_score writes, all stories `unchanged` |
| M4 | Stickiness: plan attachment renamed away from `implementation-plan*` → first run's description is preserved (Pass 1 has nothing to do) |
| M5 | Force re-extract: clearing `extracted_at` to NULL makes the next sanitize re-download |

### Verification

All five harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` | 24 | 24/24 ✅ |
| `verify_promote_flow2.py` | 19 | 19/19 ✅ |
| `verify_sanitize_flow1.py` | 32 | 32/32 ✅ |

**Total: 109 scenarios passing.**

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
.jira-analytics/bin/python backend/cli/verify_promote_flow2.py
.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py
```

---

## Step 2 / Promote Flow 2 verification ✅ Complete (2026-05-08)

### What changed

- **New harness**: `backend/cli/verify_promote_flow2.py` — 19 scenarios for re-promote against pre-populated actual tables.
- **No code changes** to `persist_issue` or its helpers. The harness verifies existing behavior is correct, and explicitly documents one known gap.

### Per-helper update semantics, verified

| Helper | Mode | F2 behavior verified |
|---|---|---|
| `_upsert_user` / `_upsert_team` / `_upsert_sprint` | upsert by external ID | UPDATE branch hits; dimensions preserved when no longer referenced (no orphan deletion) |
| `_upsert_issue` | upsert by `jira_key` | All denormalized columns refreshed; assignee/reporter/team FKs swap atomically |
| `_upsert_comments` / `_upsert_attachments` / `_upsert_worklogs` | upsert by external ID, **never delete** | Items new in payload INSERT; existing IDs UPDATE in place; **deletions in Jira leak into DB** (Group G) |
| `_replace_issue_sprints` | DELETE all + INSERT all | Membership matches latest payload exactly |
| `_replace_changelog` | DELETE all + INSERT all | History matches latest payload exactly |

### Documented gaps (Group G)

`G1`, `G2`, and `G3` assert the current behavior: a comment / attachment / worklog removed in Jira leaves a stale row in our DB. This is intentional pre-launch — revisit at launch if it becomes a problem. Three options when we revisit: (a) leave as-is, (b) propagate deletions, (c) soft-mark with a `deleted_in_jira_at` timestamp.

### Locked-in design decisions

| Decision | Outcome |
|---|---|
| Should re-promote propagate Jira deletions for comments/attachments/worklogs? | **Leave as-is**, document the gap (Group G) |
| `_replace_issue_sprints` DELETE+INSERT churn | **Keep** — correctness over cleverness |
| `_replace_changelog` DELETE+INSERT churn | **Keep** — same |
| Both staging rows end as `promoted` after a re-promote? | **Yes** — full audit trail of what was actually applied |

### Notable harness fix

The unique index `idx_staging_sync_key (sync_state_id, jira_key)` means two staging rows for the same `jira_key` cannot share a `sync_state` row. The harness's `two_promotes` helper now creates a fresh `sync_state` for each version — matching production reality (each sync is its own state).

### Verification

All five harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` (Step 1, first sync) | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` (Step 1, re-sync) | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` (Step 2, first promote) | 24 | 24/24 ✅ |
| `verify_promote_flow2.py` (Step 2, re-promote) | 19 | 19/19 ✅ |
| `verify_sanitize_flow1.py` (Step 3, sanitize) | 27 | 27/27 ✅ |

**Total: 104 scenarios passing.**

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
.jira-analytics/bin/python backend/cli/verify_promote_flow2.py
.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py
```

---

## Step 3 / Sanitize verification + orphan deletion ✅ Complete (2026-05-08)

### What changed

- **New behavior**: sanitize Pass 2 now deletes `issue_ai_scores` rows whose joined issue is no longer of an allowed type (e.g. a Story that was reclassified as a Bug). Reported as `orphaned_deleted` in the result dict and in the `reconciling` phase metrics.
- **New harness**: `backend/cli/verify_sanitize_flow1.py` — 27 scenarios covering both passes, fresh-DB and pre-populated states.

### Why orphan deletion

Without it, a Story-turned-Bug leaves a stale row in `issue_ai_scores` that's never touched by future sanitize calls (Pass 2's SELECT filters on `issue_type='Story'`). The row would also block any future Story-typed issue from claiming the same `issue_id` (FK is unique), which can't happen in practice but signals dead state. Deleting orphans before the SELECT keeps the table tracking only live Stories, and keeps `unchanged`/`rescored` counts honest.

### Code touched

- `backend/app/services/sanitize_service.py` — `_upsert_scoring_rows` returns a 4-tuple now (`inserted, rescored, unchanged, orphaned_deleted`); orphan DELETE runs first; `run_sanitize` propagates `orphaned_deleted` into its returned dict and the `reconciling` phase metrics.

### Sanitize verification harness

`backend/cli/verify_sanitize_flow1.py` covers 27 scenarios across 8 groups:

| Group | What it covers |
|---|---|
| A1–A3 | Trivial / no-op (empty DB; Story without attachments; non-matching attachments) |
| B1–B8 | Filename matching: each supported extension; case-insensitive ILIKE; substring matches; unsupported extensions counted as `skipped` |
| C1 | Multiple plan attachments → latest by `created_at` wins (DISTINCT ON) |
| D1–D2 | Issue type gating — Bug / Epic ignored even with a plan attachment |
| E1–E2 | Per-issue isolation on download failure; UTF-8 binary noise survives via `errors='replace'` |
| G1, G2, G4 | First-time reconcile: with description / NULL description / non-Story types skipped |
| H1–H4, H-orphan | Re-reconcile: unchanged / rescored / scored-preserved / Pass 1 rewrites then Pass 2 resets / orphan deletion |
| I1, J1, J2 | Mixed-batch counts; phase-row recording with and without `sync_state_id` |

The harness mocks `attachment_extractor.JiraClient` with a `MockJiraClient` that returns canned bytes per content URL (or raises canned exceptions). Same lift-and-patch shape as the staging Flow 1 harness, but applied to sanitize's download dependency.

### Locked-in design decisions

| Decision | Outcome |
|---|---|
| Pass 1 always overwrites `issues.description` when a plan attachment exists | Kept |
| Stale `issue_ai_scores` after issue type change | **Now deleted** (this change) |
| `ALLOWED_ISSUE_TYPES` is hardcoded to `("Story",)` | Kept (not env-configurable) |
| Mocking strategy for the `JiraClient` download dependency | Lifted from staging Flow 1 |

### Verification

All four harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` (Step 1, first sync) | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` (Step 1, re-sync) | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` (Step 2, first promote) | 24 | 24/24 ✅ |
| `verify_sanitize_flow1.py` (Step 3, sanitize) | 27 | 27/27 ✅ |

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py
```

---

## Step 2 / Promote Flow 1 + sanitize decoupling ✅ Complete (2026-05-08)

### What changed

**Promote and sanitize are now separate phases.** `promote_approved` no longer auto-runs `run_sanitize` at the end of the batch; the only way to materialize `issue_ai_scores` is to call `POST /api/sanitize` (or `run_sanitize(db)`) explicitly. The typical workflow becomes `promote → sanitize → score`, three separate calls.

### Why decouple

| Coupled (before) | Decoupled (now) |
|---|---|
| One HTTP call promotes + sanitizes | Two calls; reviewer remembers both |
| Sanitize failure looks like promote failure to the caller | Each phase fails on its own; clearer observability |
| Can't promote without paying sanitize cost | Promote in isolation is fast; sanitize on its own cadence |
| `PromoteResult.sanitize` field bundled in | `PromoteResult` is now `{promoted, failed}` only |

### Code touched

- `backend/app/services/staging_service.py` — `promote_approved` is back to `(db: Session) -> dict[str, Any]` returning `{"promoted", "failed"}`. The `skip_sanitize` flag added earlier in this session was removed (it was a workaround for the coupling — no longer needed).
- `backend/app/schemas/staging.py` — `PromoteResult.sanitize` field dropped; unused `Any` import cleaned up.
- `backend/app/api/staging.py` — `POST /api/staging/promote` docstring now points reviewers at `/api/sanitize` for the next phase.

### Step 2 / Flow 1 verification harness

New harness `backend/cli/verify_promote_flow1.py` covers 24 scenarios for first-time promote into empty actual tables:

| Group | What it covers |
|---|---|
| A1–A2 | Trivial inputs (no approved rows; minimal single payload) |
| B1–B6 | Dimension creation from a single payload (users / team / sprints / customers) |
| C1–C6 | Child entities (comments, attachments, worklogs, changelog, kitchen sink) |
| D1–D3 | Multi-issue dimension reuse within one batch (shared assignee / sprint / team) |
| E1–E2 | `epic_key` is plain string (no FK); Epics persist normally |
| F1–F2 | Per-row failure isolation; failed rows are not retried on re-promote |
| G1, G3, G4 | Bookkeeping (`promoted_at` set, payload preserved); promote does NOT auto-fire sanitize; result is order-independent |

Locked-in design decisions for Step 2 / Flow 1:

1. **Per-issue commits** (current behavior kept) — failure isolation beats batch atomicity.
2. **Sanitize is decoupled** (this change) — explicit `/api/sanitize` call required.
3. **Order-independent** — `created_at` ordering of approved rows does not affect the result for an empty target.

### Verification

All three harnesses green:

| Harness | Scenarios | Result |
|---|---|---|
| `verify_staging_flow1.py` (Step 1, first sync) | 17 | 17/17 ✅ |
| `verify_staging_flow2.py` (Step 1, re-sync) | 17 | 17/17 ✅ |
| `verify_promote_flow1.py` (Step 2, first promote) | 24 | 24/24 ✅ |

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
```

### Note on `issue_metrics`

`sanitize` writes `issue_ai_scores`, not `issue_metrics`. The `issue_metrics` table is read by `/api/issues` but no current code path writes to it; if Step 2 should populate it, that's a follow-up.

---

## Flow 2 invariant: one active row per `jira_key` ✅ Complete (2026-05-08)

### What changed

The staging layer now enforces a hard invariant: **at most one row per `jira_key` is in an active state (`pending` or `approved`) at any time.** When a re-sync brings a different hash for an issue with an existing active row, `stage_issue` flips the prior row to a new terminal state `superseded` (with `superseded_at = now()`) in the same transaction as the new `pending` INSERT.

This eliminates a previously-possible bug class: `approve_all_pending` and `promote_approved` could both action stale content (an old `pending` row alongside a newer one for the same `jira_key`). With the invariant, stale active rows literally cannot exist.

### Schema additions to `staging_issues`

| Column / index | Notes |
|---|---|
| `superseded_at TIMESTAMPTZ NULL` | When the prior active row was replaced |
| `STATUS_SUPERSEDED = "superseded"` | New terminal state (no DB CHECK — `review_status` is a free string) |
| `uq_staging_active_jira_key` | `UNIQUE INDEX ON staging_issues (jira_key) WHERE review_status IN ('pending','approved')` — enforces the invariant at the DB level |

### Behavior matrix

| Prior latest row | Hash on re-sync | Outcome |
|---|---|---|
| `pending` or `approved` | unchanged | no new row |
| `pending` or `approved` | changed | prior → `superseded`; new `pending` row |
| `skipped` / `promoted` / `failed` / `superseded` | unchanged | no new row |
| `skipped` / `promoted` / `failed` / `superseded` | changed | new `pending` row; prior left untouched (still terminal) |

### Code touched

- `backend/app/models/staging_issue.py` — `STATUS_SUPERSEDED` + `ACTIVE_STATUSES` tuple, `superseded_at` column, partial unique index in `__table_args__`
- `backend/app/services/staging_service.py` — `stage_issue()` does an UPDATE-then-INSERT in the same transaction so the partial-unique-index invariant holds
- `backend/app/models/issue.py` — `idx_issues_epic_key` moved into `__table_args__` so autogenerate keeps reproducing it (it was previously only in the chained migration)

### Migration squash — single 000100 again

The three chained migrations (`000100_initial_schema`, `000200_failed_records_and_views`, `000300_worklogs`) were collapsed back into a single `000100_initial_schema.py`. The five analytics views (`v_issue_facts`, `v_team_aggregates`, `v_assignee_aggregates`, `v_sprint_velocity`, `v_epic_progress`) are re-added after autogenerated table creation as raw SQL `op.execute(...)` blocks. Single migration file is the policy while pre-launch; revisit at launch.

### Verification

New harness `backend/cli/verify_staging_flow2.py` covers 17 re-sync scenarios:

| Group | What it covers |
|---|---|
| H1–H4 | Hash-gating across runs (no change / one changed / brand-new / mixed) |
| I1–I9 | Prior-row state × hash-change matrix (the invariant in action) |
| K1–K2 | Multi-sync audit trail; A → B → A flap-back |
| L1 | Issue disappears in re-sync — prior row preserved, not auto-superseded |
| U1 | Partial unique index rejects a direct second-active `INSERT` |

Both harnesses pass: **Flow 1 17/17, Flow 2 17/17**.

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
```

---

## Staging layer + failure tracking ✅ Complete (2026-05-08)

### Architecture change — sync no longer writes directly to `issues`

`POST /api/sync` now writes raw Jira payloads into a `staging_issues` holding table instead of directly upserting into `issues`. Issues must be reviewed and promoted before they land in the main data set. Sanitize and scoring reconciliation run at promote time, not sync time.

### `staging_issues` table

One row per `(sync_state_id, jira_key)`, only created when a payload hash differs from the latest existing row for that `jira_key`. Unchanged issues are silently skipped — they never appear in the review queue.

| Column | Notes |
|---|---|
| `jira_key` | Jira issue key (e.g. `LFI-42`) |
| `sync_state_id` | FK → `sync_state`, CASCADE |
| `jira_updated_at` | Jira's own `updated` timestamp (informational) |
| `payload_hash` | SHA-256 of key semantic fields (see below) |
| `change_type` | `new` \| `updated` |
| `raw_payload` | Full Jira issue object, untouched JSONB |
| `review_status` | `pending` → `approved` \| `skipped` → `promoted` \| `failed` |
| `reviewed_by` / `reviewed_at` / `review_notes` | Audit trail |
| `promoted_at` | Set when `persist_issue` succeeded |

**Hashed fields** (SHA-256 of canonical JSON): `summary`, `status.name`, `issue_type.name`, `assignee.accountId`, `priority.name`, `story_points`, `description` (ADF blob), `labels` (sorted), `attachment filenames` (sorted). Noisy Jira metadata (comment counts, etc.) is excluded. Adding a new `implementation-plan.md` attachment triggers a re-review.

**Re-sync behavior:** same issue in two syncs creates two rows only when the hash changes. Full history preserved. The latest row per `jira_key` is the authoritative state.

**Sync metrics** returned in `syncing` phase: `{total, new, updated, unchanged}`.

### Staging API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/staging` | Paginated list + breakdown counts by `change_type` and `review_status`. Query params: `status`, `change_type`, `sync_state_id`, `limit`, `offset`. |
| `PATCH` | `/api/staging/{id}` | Set `approved` or `skipped`; records `reviewed_by`, `reviewed_at`, `review_notes`. Returns 409 if row is already `promoted` or `failed`. |
| `POST` | `/api/staging/approve-all` | Bulk-approve all `pending` rows. Returns `{approved: N}`. |
| `POST` | `/api/staging/promote` | Run `persist_issue` for every `approved` row → mark `promoted` → chain `run_sanitize`. Per-row failures: status set to `failed`, error recorded in `review_notes` and `failed_records`. Returns `{promoted, failed, sanitize: {...}}`. |

### `failed_records` table

Normalized error log for record-level failures across all pipeline phases (`sync`, `promote`, `sanitize`, `score`). Distinct from `staging_issues.review_status='failed'` — this table is queryable, dismissable, and shows fix suggestions.

| Column | Notes |
|---|---|
| `phase` | `sync` \| `promote` \| `sanitize` \| `score` |
| `entity` | `issue` \| `user` \| `sprint` \| `comment` \| `attachment` \| `team` |
| `error_code` | `DEPENDENCY` \| `CONFLICT_UNIQUE` \| `CONFLICT_FIELDS` \| `VALIDATION` \| `RATE_LIMITED` \| `NETWORK` \| `UNKNOWN` |
| `fix_steps` | JSONB array of suggested remediation steps (auto-populated by `failure_service.classify`) |
| `sync_state_id` / `staging_id` | Optional FKs for traceability |
| `jira_ref` | Jira key of the failing record |
| `retry_count` / `last_retried_at` | For future retry support |
| `dismissed_at` / `dismissed_by` | Soft-dismiss without deleting |

`backend/app/services/failure_service.py` — `classify(exc)` maps exceptions to error codes; `record_failure(db, ...)` inserts a row with auto-generated fix steps.

### Service + schema files

- `backend/app/models/staging_issue.py` — `StagingIssue` model (4 indexes including unique `(sync_state_id, jira_key)`)
- `backend/app/models/failed_record.py` — `FailedRecord` model
- `backend/app/services/staging_service.py` — `compute_payload_hash`, `fetch_latest_hashes`, `stage_issue`, `promote_approved`, `approve_all_pending`
- `backend/app/services/failure_service.py` — `classify`, `record_failure`
- `backend/app/api/staging.py` — four staging endpoints
- `backend/app/schemas/staging.py` — `StagingIssueOut`, `StagingListOut`, `StagingReviewRequest`, `PromoteResult`, `ApproveAllResult`

### Backend devmode change

FastAPI backend now runs **on the host** via the `.jira-analytics` venv at **port `:8008`** (uvicorn `--reload`). The Docker `backend` service still builds but is unused day-to-day — the AI scoring endpoint shells out to the `claude` CLI which only exists on the host. Postgres-only Docker remains (`docker compose up -d db`).

```bash
cd backend && ../.jira-analytics/bin/uvicorn app.main:app --port 8008 --reload
```

### Updated phase roadmap

| # | Phase | Status |
|---|---|---|
| 1 | Project scaffold + Docker setup | ✅ Complete |
| 2 | DB models + Alembic migrations | ✅ Complete |
| 3 | Jira sync API + sanitize step | ✅ Complete |
| 3.x | Pipeline phase tracking | ✅ Complete |
| 3.x | Staging layer + failure tracking | ✅ Complete |
| 3.x | `issue_ai_scores` extensions (hash + tokens) | ✅ Complete |
| 4 | DB backup CLI | ⏭ Next |
| 5 | AI enrichment CLI | — |
| 6 | FastAPI analytics routes | — |
| 7 | React frontend | — |

---

## Pipeline phase tracking ✅ Complete (2026-05-08)

Each sync run now creates child `sync_phases` rows — one per pipeline step — giving the UI per-phase progress, live heartbeat, and historical duration averages.

### `sync_phases` table

| Column | Notes |
|---|---|
| `sync_state_id` | FK → `sync_state`, CASCADE |
| `phase` | `syncing` \| `extracting` \| `reconciling` |
| `status` | `running` → `success` \| `error` |
| `started_at` / `finished_at` | Duration of the phase |
| `heartbeat_at` | Updated at each commit boundary; partial index `WHERE status='running'` for cheap stuck-run queries |
| `items_total` / `items_processed` | Progress bar numerator/denominator |
| `metrics` | JSONB — phase-specific outcome counts |
| `error_message` | Set on `status='error'` |

**Three phases per run:**
1. **`syncing`** — Jira API loop. `items_total` pre-fetched via one `maxResults=0` call. Ticked every 50 issues. `metrics = {total, new, updated, unchanged}`.
2. **`extracting`** — plan-attachment download + decode. `items_total` = matching attachment count. Heartbeat per attachment. `metrics = {checked, extracted, failed, skipped}`.
3. **`reconciling`** — hash classification + `issue_ai_scores` upsert. Fast; `metrics = {new_pending, rescored, unchanged}`.

**Stuck-run detection:**
```sql
SELECT * FROM sync_phases WHERE status = 'running' AND heartbeat_at < now() - interval '10 minutes';
```

**Per-phase p50 duration (UI ETA):**
```sql
SELECT phase, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM finished_at - started_at)) AS p50_s
FROM sync_phases WHERE status = 'success' GROUP BY phase;
```

### API changes

`GET /api/sync/state` and `GET /api/sync/history` now include `phases: [SyncPhaseOut]` (eager-loaded via `selectinload`).

### New files

- `backend/app/models/sync_phase.py` — `SyncPhase` model
- `backend/app/services/phase_service.py` — `open_phase`, `close_phase`, `tick`, `close_running_phases`
- `backend/app/schemas/sync.py` — added `SyncPhaseOut`; `SyncStateOut.phases: list[SyncPhaseOut]`
- `backend/app/services/jira_client.py` — added `get_issue_count(jql)` for pre-fetching `items_total`

---

## `issue_ai_scores` extensions ✅ Complete (2026-05-08)

### Description hash (re-scoring gate)

`description_hash VARCHAR(64)` added. SHA-256 of `coalesce(issues.description, '')` computed at sanitize time (after plan-attachment extraction, so the hash reflects the final description).

Sanitize `_upsert_scoring_rows` classifies each Story row:

| Outcome | Condition | Action |
|---|---|---|
| **new** | No `issue_ai_scores` row exists | INSERT `status='pending'`, hash set |
| **rescored** | Row exists, hash differs | UPDATE: `status='pending'`, hash updated, all 10 scoring outputs `NULL` |
| **unchanged** | Row exists, hash matches | No-op — Phase 5 CLI skips this row entirely |

`run_sanitize` result shape updated to include `stories_rescored` and `stories_unchanged`. `POST /api/sanitize` response schema updated accordingly.

**Backfill:** rows with `description_hash IS NULL` are treated as "rescored" once, then stable.

### Token tracking

Three nullable `INTEGER` columns for AI scoring cost attribution:

| Column | Source |
|---|---|
| `input_tokens` | `usage.input_tokens` from Anthropic response |
| `output_tokens` | `usage.output_tokens` |
| `cache_read_tokens` | `usage.cache_read_tokens` (prompt cache hits) |

Run-level cost query:
```sql
SELECT sum(input_tokens), sum(output_tokens), sum(cache_read_tokens),
       sum(input_tokens * 0.000003 + output_tokens * 0.000015) AS est_cost_usd
FROM issue_ai_scores WHERE scored_at >= '<run_start>';
```

---

## Phase 3 — Jira sync API + sanitize step ✅ Complete (2026-05-06)

API-driven Jira sync (no CLI yet) plus a chained sanitize step that mirrors the `lfi-dev-analytics` `ALLOWED_ISSUE_TYPES = {"Story"}` filter and adds attachment-based description extraction.

### Sync

- **`sync_state` table** — one row per run. Columns: `started_at`, `finished_at`, `status` (`running`/`success`/`error`), `since`, `synced_until`, `issues_synced`, `error_message`, `triggered_by`. Squashed into `000100_initial_schema` rather than chained as a new migration (still one migration on disk).
- **`backend/app/services/jira_client.py`** — synchronous httpx Basic-auth wrapper around `/rest/api/3/search`. Pages on `total`/`maxResults` with `expand=changelog,renderedFields`. Adds `download_attachment(url)` for the sanitize step.
- **`backend/app/services/sync_service.py`** — `since` resolution: explicit request → else `(last successful synced_until − 1 day)` → else full sync (no lower bound). Builds JQL from `JIRA_PROJECT_KEY` (optional) + `updated >= …` and `ORDER BY updated ASC`. Per-issue: upserts `users` (by `accountId`), `teams` (by team field id), `sprints` (by `jira_sprint_id`), `issues` (by `jira_key`); replaces `issue_sprints` and `changelogs` for the issue; upserts `comments` (by `jira_comment_id`) and `attachments` (by `jira_attachment_id`) without deleting unseen ones. Description handled via `adf_to_text` (ADF tree → plain text) with a `renderedFields.description` fallback. `synced_until` set to the run's start time on success.
- **`backend/app/api/sync.py`** — `POST /api/sync` (body: `{"since": "<iso>"}` or `{}`) kicks off a `BackgroundTasks` worker with its own DB session; returns `202` with the new `SyncState`. `409` if a run is already `running`. `GET /api/sync/state` returns the latest run. `GET /api/sync/history?limit=N` (1..200, default 20) returns recent runs.

### Sanitize (chained after sync, also `POST /api/sanitize`)

- **`backend/app/services/sanitize_service.py`** — `run_sanitize(db)` runs two passes:
  1. **Plan-attachment extraction** (see below).
  2. **Pending scoring rows** — `INSERT INTO issue_ai_scores (issue_id, scoring_status) … ON CONFLICT (issue_id) DO NOTHING` for every `issues.issue_type = 'Story'`. Existing rows preserved in any state.
- **`backend/app/services/attachment_extractor.py`** — for each Story with at least one attachment whose filename matches `ILIKE '%implementation-plan%'` (latest by `created_at`), downloads via `JiraClient.download_attachment`, decodes:
  - `.md` / `.markdown` / `.txt` → UTF-8 text
  - `.html` / `.htm` → tags stripped via stdlib `html.parser` (skips `<script>`/`<style>`)
  - other extensions → skipped (counted)
  - Result **always overwrites** `issues.description`. Failures (network, decode) are logged + counted; one bad file never blocks the rest.
- Sanitize result shape (returned by API and logged after sync):
  ```json
  {"stories_marked_pending": 1, "descriptions_extracted": 1,
   "descriptions_failed": 0, "extraction_candidates": 1,
   "extraction_skipped_unsupported": 0, "allowed_issue_types": ["Story"]}
  ```

### Config additions (env)

`.env.example` documents new optional knobs:
- `JIRA_PROJECT_KEY` — scope sync to a single project (empty = all projects).
- `JIRA_FIELD_*` overrides for sprint / story-points / team / customer / prod-release-date / epic-link custom field IDs (Jira-Cloud defaults shown).

### Verification

- ✅ `alembic check` — clean, no chain (single squashed `000100`)
- ✅ `GET /health`, `GET /api/sync/state` (→ `null`), `GET /api/sync/history` (→ `[]`) on a fresh DB
- ✅ Manual `POST /api/sanitize`: 2 Stories + 1 Bug seed → `stories_marked_pending=2`; second call → `0` (idempotent); Bug correctly skipped
- ✅ End-to-end extraction: Story with inline `OLD INLINE DESCRIPTION` + `implementation-plan-v2.md` attachment served from a local HTTP server (reachable via `host.docker.internal`) → markdown body replaced the inline text; sibling `screenshot.png` correctly ignored

### Updated phase roadmap

| # | Phase | Status |
|---|---|---|
| 1 | Project scaffold + Docker setup | ✅ Complete |
| 2 | DB models + Alembic migrations | ✅ Complete |
| 3 | Jira sync API + sanitize step | ✅ Complete |
| 3.x | Pipeline phase tracking | ✅ Complete |
| 3.x | Staging layer + failure tracking | ✅ Complete |
| 3.x | `issue_ai_scores` extensions (hash + tokens) | ✅ Complete |
| 4 | DB backup CLI | ⏭ Next |
| 5 | AI enrichment CLI (rewritten, references `lfi-dev-analytics`) | — |
| 6 | FastAPI routes (analytics) | — |
| 7 | React frontend | — |

### Known follow-ups (deferred)

- Re-syncing a Story does **not** re-score it — its existing `issue_ai_scores` row is preserved as-is even if the description changed. An explicit "reset scoring" endpoint can be added when scoring lands in Phase 5.
- PDF / DOCX plan attachments are currently skipped (extension allowlist is text-only, per spec discussion).
- Sanitize runs synchronously inside the request; if plan-attachment counts ever get large, push it through `BackgroundTasks` too.

---

## Phase 2.2 — Skill detection columns on `issue_ai_scores` ✅ Complete (2026-05-06)

Two columns added to support per-issue skill fingerprinting (mirrors `lfi-dev-analytics` rubric output):

| Column | Type | Purpose |
|---|---|---|
| `skill_usage_detected` | BOOLEAN, nullable | Whether the AI rubric detected discernible skill usage in the issue. |
| `skill_name` | VARCHAR, nullable | Detected skill (e.g. `backend`, `web`, `app`) — populated when `skill_usage_detected = true`. |

### Migration

- The single squashed migration `000100_initial_schema` was **regenerated** to include the new columns (downgrade base → delete file → autogenerate → upgrade head). Still one migration on disk, no chain.
- `alembic check` → "No new upgrade operations detected"
- `\d+ issue_ai_scores` confirms `skill_usage_detected boolean` and `skill_name varchar` are present.

---

## Phase 2.1 — Schema extension for `JiraList.csv` columns + attachments ✅ Complete (2026-05-06)

The original Phase 2 spec didn't account for several columns visible in the `JiraList.csv` export, nor for descriptions that live in attached files. This addendum extends the schema to cover them.

### CSV columns now supported

| CSV column(s) | Stored as |
|---|---|
| `Issue id` | `issues.jira_issue_id` (VARCHAR UNIQUE) |
| `Team Id`, `Team Name` | New `teams` table; `issues.team_id` FK |
| `Sprint` × N (up to 19 in CSV) | New `issue_sprints` junction (M:N) — replaces single `issues.sprint_id` |
| `Custom field (Reported By Customer)` (Yes/No) | `issues.reported_by_customer` (BOOLEAN) |
| `Custom field (Customer)` × 3 | `issues.customers` (TEXT[]) |
| `Custom field (Prod Release Date)` | `issues.prod_release_date` (DATE) |

Already covered in Phase 2: Issue Type, Issue key, Summary, Assignee/Assignee Id, Story Points, Σ Original Estimate, Σ Time Spent, Description, Status.

### New tables

- **`teams`** — `id`, `jira_team_id` (UUID/VARCHAR UNIQUE), `name`, `created_at`
- **`issue_sprints`** — junction `(issue_id, sprint_id)` with `UNIQUE (issue_id, sprint_id)` and `ON DELETE CASCADE` both sides
- **`attachments`** — metadata only: `id`, `issue_id` (CASCADE), `jira_attachment_id` (UNIQUE), `filename`, `mime_type`, `size_bytes` (BIGINT), `author_id` (FK users), `content_url`, `created_at`, `synced_at`. **No extracted_text column** — see flow below.

### Description-from-attachment support

Schema is in place; sync-time logic lands in Phase 3:
- Each Jira attachment becomes one row in `attachments` (metadata + URL only).
- When the inline description is missing/short and an attachment carries the description, the sync CLI fetches the attachment on demand, extracts text, and writes it directly to `issues.description`. The attachment text is **not** cached in `attachments` — re-pull from `content_url` if needed again.

### Migration

- The original `b75a3c483c10_initial_schema`, `e470e083516b_csv_columns_and_attachments`, and `508ccce09723_drop_attachments_extracted_text` migrations have been **squashed** into a single revision `000100_initial_schema` (no down_revision).
- Applied via `alembic upgrade head`
- `alembic check` → "No new upgrade operations detected"

---

## Phase 2 — DB models + Alembic migrations ✅ Complete (2026-05-06)

### What landed

- `backend/app/db.py` — SQLAlchemy 2.0 `engine`, `SessionLocal`, `Base(DeclarativeBase)`, `get_db()` FastAPI dependency. Reads `DATABASE_URL` via `python-dotenv` from project root `.env`.
- `backend/app/models/` — one file per model:
  - `user.py` (`users`)
  - `sprint.py` (`sprints`)
  - `issue.py` (`issues`, with `JSONB`, `TEXT[]`, FKs to users + sprints, all 6 spec indexes)
  - `changelog.py` (`changelogs`, `ON DELETE CASCADE` to issues, composite index)
  - `comment.py` (`comments`, `ON DELETE CASCADE` to issues, unique `jira_comment_id`)
  - `issue_metrics.py` (`issue_metrics`, JSONB `time_in_status`, `reopen_count`/`comment_count` default 0)
  - `issue_ai_score.py` (`issue_ai_scores`, `NUMERIC(2,1)` quality score, `scoring_status` default `'pending'`, two indexes)
- `backend/app/models/__init__.py` — exports `Base` + all 7 models so Alembic autogenerate sees them.
- `backend/alembic/`, `backend/alembic.ini` — initialized via `alembic init alembic`.
- `backend/alembic/env.py` — rewritten to load `.env`, prepend `backend/` to `sys.path`, import `app.models`, set `target_metadata = Base.metadata`, enable `compare_type` + `compare_server_default`.
- `backend/alembic/versions/000100_initial_schema.py` — squashed initial migration covering all 10 tables (was previously three sequential migrations, now one).

### DATABASE_URL split (host vs container)

| Where | Value |
|---|---|
| `.env` (host CLIs, alembic from venv) | `postgresql://admin:secret@localhost:5433/jira_analytics` |
| `docker-compose.yml` `backend.environment` (overrides for container) | `postgresql://admin:secret@db:5432/jira_analytics` |

### Verification

- ✅ `alembic revision --autogenerate --rev-id 000100 -m "initial_schema"` — detected all 10 tables and all 11 named indexes
- ✅ `alembic upgrade head` — `000100` applied cleanly
- ✅ `docker exec lfi-jira-db psql … -c "\dt"` — 10 domain tables + `alembic_version`
- ✅ `\d+ issues` — `description_adf jsonb`, `labels text[]`, all 3 FKs, `synced_at default now()`
- ✅ `\d+ issue_ai_scores` — `description_quality_score numeric(2,1)`, `scoring_status default 'pending'`
- ✅ `alembic check` — "No new upgrade operations detected" (models and DB in sync)
- ✅ Host: `.jira-analytics/bin/alembic current` → `000100 (head)`
- ✅ Container: `docker exec lfi-jira-backend alembic current` → `000100 (head)`
- ✅ `curl http://localhost:8000/health` still returns `{"status":"ok"}` after backend recreate

### Updated phase roadmap

| # | Phase | Status |
|---|---|---|
| 1 | Project scaffold + Docker setup | ✅ Complete |
| 2 | DB models + Alembic migrations | ✅ Complete |
| 3 | Jira sync CLI | ⏭ Next |
| 4 | DB backup CLI | — |
| 5 | AI enrichment CLI (rewritten, references `lfi-dev-analytics`) | — |
| 6 | FastAPI routes | — |
| 7 | React frontend | — |

---

## Phase 1 — Project scaffold + Docker setup ✅ Complete (2026-05-06)

### Stack stood up

- **Postgres 16** in Docker — service `db`, container `lfi-jira-db`, host `:5433` → container `:5432`, named volume `pgdata`, `./backups` mounted at `/backups`, healthcheck via `pg_isready`.
- **FastAPI backend** in Docker — service `backend`, container `lfi-jira-backend`, host `:8000`, hot reload, builds from `backend/Dockerfile` (`python:3.10.20-slim`), reads env from `.env`, `depends_on: db (healthy)`.
- **React + Vite frontend** on host — Vite 6, React 18, TailwindCSS 3.4, ECharts 5.5 + `echarts-for-react`, `@tanstack/react-query` 5.62. Vite proxies `/api` → `:8000`. `frontend/.env` holds `VITE_API_URL=http://localhost:8000`. `npm install` clean (139 packages, 0 vulns).
- **Python venv** at `.jira-analytics/` (Python 3.10.20, matches container). All `backend/requirements.txt` deps installed: fastapi, uvicorn, sqlalchemy, alembic, psycopg2-binary, python-dotenv, httpx, click, pydantic, pydantic-settings, pandas.

### Files in place

- `docker-compose.yml`, `backend/Dockerfile`, `backend/requirements.txt`
- `backend/app/main.py` — FastAPI app with CORS for `:5173` and a `/health` endpoint
- `frontend/` — Vite scaffold (`App.jsx`, `main.jsx`, `index.css`, configs)
- `.env`, `.env.example` — Postgres + Jira creds
- `README.md` — setup/run instructions
- `CLAUDE.md` — repo conventions for Claude Code (venv rule, port note, structure)
- `progress.md` — this file
- `.gitignore` — includes `.jira-analytics/`

### Empty placeholders (intentional, ready for next phases)

- `backend/app/api/`, `backend/app/models/`, `backend/app/schemas/` — `.gitkeep` only
- `backend/cli/` — `.gitkeep` only
- `backups/` — `.gitkeep` only

### Deviations from original spec

| Item | Spec | Actual | Reason |
|---|---|---|---|
| Host port for Postgres | `5432` | `5433` | Unrelated `lumberfi-services` Postgres holds host `:5432`. Container internally still `:5432`. |
| Python base image | `3.11` | `3.10.20-slim` | Match host venv (only 3.10.20 installed via pyenv) so host CLIs and container behave identically. |

### Verification

- ✅ `docker compose up -d` — both services start, `db` healthy, `backend` up
- ✅ `curl http://localhost:8000/health` → `{"status":"ok"}`
- ✅ `docker compose exec backend python --version` → `Python 3.10.20`
- ✅ `npm run dev` — Vite boots on `:5173` in ~300ms
- ✅ `.jira-analytics/bin/python -c "import fastapi, sqlalchemy, alembic, psycopg2, click, httpx, pandas, pydantic, dotenv"` — all imports OK

User drives each phase with a separate prompt.
