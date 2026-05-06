# Architecture

Reference doc for developers extending or operating this codebase.

For onboarding (clone / install / run), see `README.md`. For change history (what was built when, and why), see `progress.md`. This document describes **how it works today**.

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Pipeline at a glance](#2-pipeline-at-a-glance)
3. [Stack and layout](#3-stack-and-layout)
4. [Database schema](#4-database-schema)
5. [Sync flow — Jira to staging](#5-sync-flow--jira-to-staging)
6. [Hash semantics](#6-hash-semantics)
7. [Staging review workflow](#7-staging-review-workflow)
8. [Promote flow — staging to issues](#8-promote-flow--staging-to-issues)
9. [Sanitize step](#9-sanitize-step)
10. [AI scoring (Phase 5, in progress)](#10-ai-scoring-phase-5-in-progress)
11. [Pipeline phase tracking](#11-pipeline-phase-tracking)
12. [Stuck-run reaper](#12-stuck-run-reaper)
13. [Failure handling](#13-failure-handling)
14. [Worklog tracking](#14-worklog-tracking)
15. [Analytics views](#15-analytics-views)
16. [API reference](#16-api-reference)
17. [Verification harness](#17-verification-harness)
18. [Common operations](#18-common-operations)

---

## 1. System overview

This service syncs Jira project data into Postgres, lets a human review each change before it lands, then runs AI scoring against the description quality of every Story. The end product is a set of analytics views the frontend renders.

The pipeline is intentionally **not** "Jira → live data". It's "Jira → staging → review → promote → enrichment → analytics" so that bad data, mis-mapped fields, or unwanted issues never silently corrupt the warehouse.

Audience: backend engineers maintaining the sync, the staging UI, the AI scoring CLI, and the analytics queries that drive the dashboard.

---

## 2. Pipeline at a glance

```
┌────────────┐
│ Jira Cloud │
└─────┬──────┘
      │ POST /rest/api/3/search/jql (cursor pagination via nextPageToken,
      │      expand=changelog,renderedFields)
      ▼
┌─────────────────────────┐    sync_state row tracks the run
│ POST /api/sync          │    sync_phases rows track per-phase progress
│  → run_sync (bg task)   │
│  → stage_issue per row  │
└─────────┬───────────────┘
          │ writes raw JSON + payload_hash
          ▼
┌─────────────────────────┐    one row per (sync_state_id, jira_key)
│ staging_issues          │    only inserted when payload_hash differs
│ status=pending          │    from the latest existing row for that key
└─────────┬───────────────┘
          │ user reviews via PATCH /api/staging/{id}  → approved | skipped
          │ or POST /api/staging/approve-all           → bulk approve
          ▼
┌─────────────────────────┐
│ POST /api/staging/promote│  for each approved row:
│  → persist_issue         │    upsert users / teams / sprints / issue
└─────────┬───────────────┘    upsert comments / attachments / worklogs
          ▼
┌─────────────────────────┐
│ issues + related tables │
└─────────┬───────────────┘
          │ POST /api/sanitize  (separate phase — not auto-fired by promote)
          │   1. extract description from `implementation-plan.*` attachment
          │   2. reconcile issue_ai_scores against description hash
          ▼
┌─────────────────────────┐
│ issue_ai_scores         │  rows in 'pending' state await scoring
│  status=pending         │
└─────────┬───────────────┘
          │ scoring CLI (Phase 5) or POST /api/score
          ▼
┌─────────────────────────┐
│ issue_ai_scores         │  status=completed, with quality / skill / cost data
│  status=completed       │
└─────────┬───────────────┘
          ▼
┌─────────────────────────┐
│ analytics views         │  v_issue_facts, v_team_aggregates,
│ (raw SQL in 000100)     │  v_assignee_aggregates, v_sprint_velocity,
└─────────────────────────┘  v_epic_progress
```

---

## 3. Stack and layout

| Layer | Tech | Where it runs |
|---|---|---|
| Database | Postgres 16 | Docker (`docker compose up -d db`), host `:5433` |
| Backend | FastAPI + SQLAlchemy 2.0 + Alembic | Host venv, `:8008` (uvicorn `--reload`) |
| Frontend | React + Vite + Tailwind + ECharts + react-query | Host, `:5173`, proxies `/api` → `:8008` |
| AI scoring | Shells out to local `claude` CLI | Host venv (CLI under `backend/cli/`) |

Python venv lives at `.jira-analytics/` (Python 3.10.20 from pyenv, matches the Dockerfile pin).

```
backend/
├── alembic/
│   ├── env.py                       # loads .env, target_metadata = Base.metadata
│   └── versions/                    # single squashed 000100_initial_schema.py (pre-launch policy)
├── app/
│   ├── main.py                      # FastAPI app + lifespan startup hook
│   ├── db.py                        # engine, SessionLocal, Base, get_db
│   ├── api/                         # FastAPI routers (one file per surface)
│   ├── models/                      # SQLAlchemy 2.0 mapped classes
│   ├── schemas/                     # Pydantic request/response models
│   └── services/                    # business logic, no FastAPI imports
└── cli/                             # Click + ad-hoc scripts (verify, score, …)
frontend/                            # Vite app
backups/                             # mounted at /backups inside the db container
```

Naming convention: `app/api/` only handles HTTP plumbing; all logic lives in `app/services/`. The verification harness (`backend/cli/verify_staging_flow1.py`) imports services directly without going through FastAPI.

---

## 4. Database schema

All tables live in a single Postgres database (`jira_analytics`). While pre-launch the schema lives in a single squashed migration `000100_initial_schema.py` — see `feedback_migration_policy` memory for the squash workflow. Current head: `000100`.

### Domain tables (the "real" data after promote)

| Table | Purpose |
|---|---|
| `users` | Jira users, keyed on `jira_account_id` |
| `teams` | Jira teams (custom field), keyed on `jira_team_id` |
| `sprints` | Jira sprints, keyed on `jira_sprint_id` |
| `issues` | One row per Jira issue, with denormalized fields for fast filtering. `description` is the post-extraction text; `description_adf` is the raw ADF blob; `raw_json` is the full Jira payload. |
| `issue_sprints` | M:N junction (an issue can span multiple sprints) |
| `comments` | Jira comments, ADF + plain text |
| `comments` | Body in plain text (`adf_to_text` of the ADF body). Rows with IDs absent from a re-promote's payload are DELETEd (Jira deletions propagate). |
| `attachments` | Metadata only — bytes are re-fetched from Jira when needed. `extracted_at` is set by sanitize once a plan-attachment's content has been pulled into `issues.description`; non-NULL means "skip re-download on next sanitize". Rows with IDs absent from a re-promote's payload are DELETEd. |
| `worklogs` | Author + ADF comment + plain text. The inline `fields.worklog` field caps at 20 (Jira's `maxResults`); when `total > len(inline)` we paginate via `JiraClient.get_issue_worklogs`. Deletion-not-in-payload runs only when pagination succeeds, so a failed pagination can't drop rows we couldn't see. |
| `changelogs` | Replaced wholesale on each promote (to avoid drift). |
| `issue_metrics` | Computed from already-persisted children at the end of `persist_issue`: `cycle_time_hours`, `lead_time_hours`, `reopen_count`, `comment_count`. NULL/0 when the underlying signal is absent. |
| `issue_ai_scores` | One row per Story; tracks scoring state, AI outputs, token usage, and the `description_hash` that gates re-scoring. |

### Operational tables (the pipeline's bookkeeping)

| Table | Purpose |
|---|---|
| `sync_state` | One row per pipeline run — `triggered_by` discriminates sync vs promote vs sanitize vs score. Lifecycle: `running` → `success` \| `error`. The sync run additionally holds the cursor (`since`, `synced_until`); other kinds leave those NULL. |
| `sync_phases` | Child rows of `sync_state`, one per pipeline phase (`syncing`, `promoting`, `extracting`, `reconciling`, `scoring`). Heartbeat + items_processed + per-phase metrics. |
| `staging_issues` | Holding pen for raw Jira payloads awaiting human review. Status: `pending` → `approved` → `promoted` \| `failed`; `pending` → `skipped`; any active row → `superseded` when a re-sync brings a different hash. At most one active (`pending`/`approved`) row per `jira_key` — enforced by partial unique index `uq_staging_active_jira_key`. |
| `failed_records` | Normalized error log across all phases (`sync`, `promote`, `sanitize`, `score`). Includes auto-generated `fix_steps`. |

### Analytics views (read-only)

Defined in `000100_initial_schema.py` as raw SQL `op.execute(...)` blocks — they're not autogenerated from models. Re-added by hand after every migration squash.

| View | What it returns |
|---|---|
| `v_issue_facts` | One row per issue; flattens issues + assignee + team + AI score + metrics with computed columns (`estimate_hours`, `over_budget`, `is_done`) |
| `v_team_aggregates` | Per-team rollup of issue count, avg quality, points, spend |
| `v_assignee_aggregates` | Same rollup keyed on assignee |
| `v_sprint_velocity` | Per-sprint planned vs. completed points + completion % |
| `v_epic_progress` | Per-epic completion stats |

---

## 5. Sync flow — Jira to staging

`POST /api/sync` (request: `{"since": "2026-05-01T00:00:00Z"}` or `{}`):

1. **409 guard** — if any `sync_state` row is already `running`, refuse with 409 (use `POST /api/sync/reap` to clear stuck runs first).
2. Insert a `sync_state` row in `running`.
3. Queue `run_sync` on FastAPI `BackgroundTasks` (returns 202 immediately).
4. The background task:
   - Resolves the effective `since` (explicit → last successful `synced_until − 1 day` → full sync).
   - Builds JQL: `[project = "X" AND] updated >= "<since>" ORDER BY updated ASC`.
   - Pre-fetches an approximate count for the JQL via `POST /rest/api/3/search/approximate-count` so the syncing phase has an `items_total` for the UI progress bar. (The count is approximate but stable across the run; the legacy `total` field is no longer returned by the search endpoint since Atlassian retired `GET /rest/api/3/search` in 2025.)
   - Opens a `syncing` phase row.
   - Loads `latest_hashes` — `{jira_key → payload_hash}` from staging across all prior runs.
   - Pages through issues, calls `stage_issue(...)` per issue, ticks the phase every 50.
   - Closes the phase with `metrics={total, new, updated, unchanged}`.
   - Marks `sync_state.status = success`.

Critically: the sync **does not write to the `issues` table**. It only writes to `staging_issues`. The `issues` table is updated only on promote.

Implementation: `backend/app/services/sync_service.py` (`run_sync`, `_resolve_since`, `_build_jql`).

---

## 6. Hash semantics

`compute_payload_hash` in `backend/app/services/staging_service.py:22` is the heart of change detection. It picks a stable subset of the Jira payload, canonicalizes to JSON, and SHA-256s it.

### What's in the hash

| Field | Source |
|---|---|
| `summary` | `fields.summary` |
| `status` | `fields.status.name` |
| `issue_type` | `fields.issuetype.name` |
| `assignee` | `fields.assignee.accountId` |
| `priority` | `fields.priority.name` |
| `story_points` | configured custom field (`JIRA_FIELD_STORY_POINTS`) |
| `time_estimate_secs` | `fields.aggregatetimeoriginalestimate` |
| `time_spent_secs` | `fields.aggregatetimespent` |
| `description` | `fields.description` (full ADF blob) |
| `labels` | sorted `fields.labels` |
| `attachments` | sorted attachment filenames |
| `sprints` | sorted sprint **IDs** (not names/dates) |
| `customers` | sorted custom field values (multi-choice) |
| `reported_by_customer` | normalized `True \| False \| None` |

### What's deliberately NOT in the hash

- `created` / `updated` timestamps — Jira bumps these for trivial changes
- comment count, watcher count, vote count
- changelog history
- worklogs themselves (but `time_spent_secs` IS in the hash, which is server-side recomputed by Jira when a worklog is added — so adding a worklog still triggers re-review)
- sprint state / dates (only sprint membership matters for review)

### Why these choices matter

Adding fields to the hash means more re-reviews, including spurious ones. Removing fields means missed changes that should have been reviewed. The current set is calibrated for the user's review intent: catch real content changes, ignore Jira noise.

To change what triggers re-review, edit `compute_payload_hash` and add a verification scenario in `backend/cli/verify_staging_flow1.py` (the test asserts which changes do and don't shift the hash).

---

## 7. Staging review workflow

Each row in `staging_issues` carries a `review_status`:

```
   pending ───approve──▶ approved ───promote──▶ promoted   (terminal: in issues table)
      │                      │
      │                      └──promote-fails──▶ failed     (terminal: see failed_records)
      │
      ├─────skip──▶ skipped                                 (terminal: never promoted)
      │
      └─re-sync brings new hash──▶ superseded               (terminal: replaced by a newer staging row)
            (only fires from pending or approved — terminal rows are immune)
```

`pending` is the default. `approved` and `skipped` are user actions; `promoted` and `failed` come out of the promote step; `superseded` is system-applied during sync. Once a row is `promoted` or `failed`, `PATCH /api/staging/{id}` returns 409.

### Active-row invariant

**At most one row per `jira_key` is in an active state (`pending` or `approved`) at any time.** Enforced at the DB level by partial unique index:

```sql
CREATE UNIQUE INDEX uq_staging_active_jira_key
ON staging_issues (jira_key)
WHERE review_status IN ('pending', 'approved');
```

This means review/promote logic only ever has to look at active rows. `approve_all_pending` and `promote_approved` cannot accidentally action stale content, since stale active rows literally cannot exist.

### Re-syncing the same issue

If Jira returns the same `jira_key` in a later sync with a **different** payload hash, `stage_issue` does the following in a single transaction:

1. `UPDATE staging_issues SET review_status='superseded', superseded_at=now() WHERE jira_key = :K AND review_status IN ('pending','approved')` — clears any active row for this key.
2. `INSERT` a new `pending` row.

If the prior row was already terminal (`promoted` / `skipped` / `failed` / `superseded`), step 1 is a no-op and the prior row is left untouched. Multiple terminal rows for the same `jira_key` accumulate as full audit history.

If the hash matches the latest existing row (regardless of `review_status`), no new staging row is created — the issue is classified as `unchanged` in the sync metrics. `fetch_latest_hashes` does `DISTINCT ON (jira_key) ORDER BY id DESC` to find the comparison baseline.

Behavior matrix:

| Prior latest row | Re-sync hash | Outcome |
|---|---|---|
| `pending` or `approved` | unchanged | no new row |
| `pending` or `approved` | changed | prior → `superseded`; new `pending` row |
| `skipped` / `promoted` / `failed` / `superseded` | unchanged | no new row |
| `skipped` / `promoted` / `failed` / `superseded` | changed | new `pending` row; prior row left untouched (still terminal) |

### Identical duplicates within one Jira response (Flow-1 concern)

If Jira returns the same issue twice in one response (rare, indexer race), `stage_issue` updates an in-memory `latest_hashes` dict after each insert, so the second occurrence with identical content is deduped to `unchanged` (not a row collision).

If the two duplicates have **different** content, the second insert hits the `(sync_state_id, jira_key)` unique constraint and the run errors out cleanly. See verification scenarios D18a / D18b.

---

## 8. Promote flow — staging to issues

`POST /api/staging/promote` runs `promote_approved` in `backend/app/services/staging_service.py`:

For every staging row with `review_status='approved'`, ordered by `created_at`:

1. Call `persist_issue(db, row.raw_payload, settings)` — the upsert chain that lives in `sync_service.py`. Inside `persist_issue`:
   - `_upsert_user` for assignee + reporter (by `accountId`)
   - `_upsert_team` (by team field id)
   - `_upsert_issue` (by `jira_key`) — sets all denormalized columns, including `description_text` from ADF or rendered fallback
   - `_replace_issue_sprints` (M:N — replaces all rows for this issue)
   - `_upsert_comments` (by `jira_comment_id`) — upsert + delete-not-in-payload
   - `_upsert_attachments` (by `jira_attachment_id`) — upsert + delete-not-in-payload
   - `_upsert_worklogs` (by `jira_worklog_id`) — paginates via `JiraClient.get_issue_worklogs` when `total > len(inline)`; deletes-not-in-payload only on complete-set knowledge
   - `_replace_changelog` (delete + reinsert; changelogs are append-only in Jira but easier to replace than diff)
   - `_upsert_issue_metrics` — computes `cycle_time_hours` / `lead_time_hours` / `reopen_count` / `comment_count` from already-persisted children
2. Mark the staging row `promoted`, set `promoted_at = now()`.
3. **Per-row error handling:** any exception rolls back this issue's transaction, marks the staging row `failed`, appends the traceback to `review_notes`, and inserts a `failed_records` row. The promote loop continues with the next row.

`promote_approved(db, sync_state_id=None, limit=None)`:

- `sync_state_id` — when provided, opens a `promoting` phase row, ticks `items_processed` per row, and closes the phase with `{promoted, failed}` metrics. The `POST /api/staging/promote` endpoint creates a sync_state (`triggered_by='api-promote'`) and passes its id so the UI can poll progress.
- `limit` — when provided, processes at most `limit` approved rows (`ORDER BY created_at LIMIT n`). Lets a caller chunk a huge backlog across multiple HTTP calls. Default `None` = process all.

Key properties:
- **Per-issue isolation.** One bad payload doesn't kill the whole batch.
- **Sanitize is decoupled.** `promote_approved` does NOT auto-fire `run_sanitize`. After promote, call `POST /api/sanitize` (or `run_sanitize(db)`) to materialize `issue_ai_scores`. This keeps a promote failure from masquerading as a sanitize failure and lets each phase be observed/retried on its own cadence.
- **Order-independent.** Approved rows are iterated in `created_at` order, but the result of a Flow-1 promote (empty target tables) does not depend on that order — dimension upserts (users/teams/sprints) are commutative.

### Per-helper update semantics (Flow 2 — re-promote with existing data)

`persist_issue` is the same code path on first and subsequent promotes; how it behaves on re-promote depends on the helper:

| Helper | Mode | Behavior on re-promote |
|---|---|---|
| `_upsert_user` / `_upsert_team` / `_upsert_sprint` | upsert by external ID | UPDATE branch hits; display name / sprint state / dates may drift forward. **No orphan deletion** — a user that no longer appears on any issue stays in `users`. |
| `_upsert_issue` | upsert by `jira_key` | All denormalized columns refreshed; `synced_at = now()`; assignee/reporter/team FKs swap atomically. |
| `_upsert_comments` / `_upsert_attachments` | upsert + delete-not-in-payload | New IDs INSERT; existing IDs UPDATE in place; **rows whose IDs are absent from the payload are DELETEd** (Jira deletions propagate). Comment / attachment fields are returned in full inline, so absence is real. |
| `_upsert_worklogs` | upsert + delete-not-in-payload (gated on complete set) | When `worklog.total > len(inline)` the helper calls `JiraClient.get_issue_worklogs(key)` to fetch the rest before upserting. Deletion of missing IDs runs **only** if pagination succeeded — a failed pagination falls back to inline + skips deletion (so we never lose rows we couldn't see). |
| `_replace_issue_sprints` | DELETE all + INSERT all | Issue's sprint set always matches the latest payload exactly. Sprint dimension rows are *not* removed even if no issue references them anymore. |
| `_replace_changelog` | DELETE all + INSERT all | Final state always matches the payload. Churn is acceptable since changelog is append-only in Jira. |
| `_upsert_issue_metrics` | computed from joined children | After all child upserts, computes `cycle_time_hours` (first transition into an in-progress status → first subsequent transition into done), `lead_time_hours` (created → resolved/first-done), `reopen_count` (done → non-done transitions), `comment_count` (rows in `comments`); upserts into `issue_metrics`. NULL when the underlying signal is absent. |

**Staging audit trail across re-promotes**: each successful promote leaves the staging row in `promoted` with `promoted_at` set and `raw_payload` preserved. Two consecutive promotes for the same `jira_key` produce two `promoted` staging rows — full audit history of what was actually applied.

---

## 9. Sanitize step

Sanitize is its **own pipeline phase**, invoked explicitly via `POST /api/sanitize`. It is no longer chained from promote — the typical workflow is `promote → sanitize → score`, run as three separate calls.

`run_sanitize` in `backend/app/services/sanitize_service.py` runs **two passes**:

### Pass 1: plan-attachment description extraction

For every Story with at least one attachment whose filename matches `ILIKE '%implementation-plan%'`:
- Take the most recent matching attachment by `created_at` (`DISTINCT ON (issue_id) ORDER BY created_at DESC`).
- Skip extensions outside `.md / .markdown / .txt / .html / .htm` (counted as `skipped`).
- **Caching guard**: skip the download entirely if `attachments.extracted_at IS NOT NULL` for that attachment row (counted as `skipped_cached`). Once an attachment has been successfully extracted, we don't re-download it.
- Download via `JiraClient.download_attachment` (auth, follow redirects).
- Decode: HTML → plain text via stdlib `html.parser` (skips `<script>`/`<style>`); markdown/text → UTF-8 with `errors='replace'`.
- **Always overwrite** `issues.description` with the result, then stamp `attachments.extracted_at = now()` in the same transaction. Failures (network, decode) are logged + counted; one bad file never blocks the rest.

The guard invalidates automatically when a *new* plan attachment (different `jira_attachment_id`) appears with a later `created_at` — the `DISTINCT ON` picks up the newer row, which has `extracted_at IS NULL` and is therefore re-extracted. To force re-extraction of an already-cached attachment, an operator can `UPDATE attachments SET extracted_at = NULL WHERE …`.

Implementation: `backend/app/services/attachment_extractor.py`.

### Pass 2: reconcile `issue_ai_scores` against description hash

For every Story, compute `SHA-256(coalesce(description, ''))`:

| Outcome | Condition | Action |
|---|---|---|
| **new** | No `issue_ai_scores` row exists | INSERT `status='pending'`, hash set |
| **rescored** | Row exists, hash differs | UPDATE: `status='pending'`, hash updated, all 10 scoring outputs `NULL` |
| **unchanged** | Row exists, hash matches | No-op — Phase 5 CLI skips this row |
| **orphaned** | Row exists, joined issue is no longer of an allowed type | DELETE the row |

This is what saves tokens on re-sync: a Story whose description didn't change keeps its existing score and isn't re-processed.

**Orphan cleanup** runs *before* the SELECT-and-classify step, so the `unchanged`/`rescored` counts are not polluted by orphaned rows. An orphan is an `issue_ai_scores` row whose joined issue is no longer of an allowed type (e.g. a Story that became a Bug). The result dict reports `orphaned_deleted` alongside `stories_marked_pending`, `stories_rescored`, and `stories_unchanged`.

### Phase tracking

`POST /api/sanitize` creates a `sync_state` row (`triggered_by='api-sanitize'`) and calls `run_sanitize(db, sync_state_id=N)`, which records `extracting` and `reconciling` phases in `sync_phases` for UI progress visibility. The response includes `sync_state_id` so the UI can poll. Calling `run_sanitize(db)` directly without a `sync_state_id` (e.g. from a one-off Python session) skips the phase rows.

---

## 10. AI scoring (Phase 5, in progress)

`issue_ai_scores` columns are in place:

| Column | Purpose |
|---|---|
| `scoring_status` | `pending` → `in_progress` → `completed` \| `failed` |
| `description_hash` | SHA-256 from sanitize; gates re-scoring |
| `description_quality_score`, `ai_plan_detected`, `skill_usage_detected`, `skill_name`, `complexity_estimate`, `scoring_notes` | Rubric outputs |
| `model_used`, `scored_at` | Provenance |
| `input_tokens`, `output_tokens`, `cache_read_tokens` | Cost attribution per row |
| `error_message`, `raw_response` | Debugging |

The actual scoring CLI (`backend/cli/score.py`) shells out to the local `claude` CLI to generate scores. It picks up `pending` rows, claims them (`SELECT FOR UPDATE SKIP LOCKED` then UPDATE to `in_progress` in one transaction — two workers running concurrently get disjoint sets), runs the rubric, writes outputs + token usage, sets `completed`.

**Subscription context.** This tool is designed for a Claude Code subscription (Pro / Max), not an API key — `_invoke_claude` shells out to the `claude` CLI which uses your local Claude Code session. As a result:

- `issue_ai_scores.total_cost_usd` and `ScoringStateOut.total_cost_usd_sum` are **informational** — the API-equivalent dollar value the CLI reports for the call. On a subscription you aren't billed per token, so treat these as a *relative usage proxy* (compare runs, compare models), not as billing.
- Subscription tiers cap how many prompts you can issue in a 5-hour window. Mid-batch rate limits surface as `claude` CLI non-zero exits with usage-limit phrases in stderr. `_invoke_claude` pattern-matches these (`usage limit`, `rate limit`, `too many requests`, `quota`, `try again in`) and raises `ScoringRateLimitedError`. `score_pending` then marks the current row failed with `error_code=RATE_LIMITED`, releases any still-claimed rows back to `pending`, and **stops the batch** — so we don't burn the rest of the batch on the same error.
- If you have a small daily quota, prefer small `--limit` batches and re-run after the cap resets. The remaining rows are still `pending` and pick up cleanly on the next call.

Companion repo `../lfi-dev-analytics/` is the reference implementation for prompt structure and `TokenUsage` shape. Don't copy files — rewrite from scratch.

Run-level cost query:
```sql
SELECT sum(input_tokens),
       sum(output_tokens),
       sum(cache_read_tokens),
       sum(input_tokens * 0.000003 + output_tokens * 0.000015) AS est_cost_usd
FROM issue_ai_scores
WHERE scored_at >= '<run_start>';
```

---

## 11. Pipeline phase tracking

Each sync run creates child `sync_phases` rows — one per phase — for UI progress, ETA, and stuck-run detection.

| Phase | When | `items_total` | `items_processed` ticks | `metrics` JSONB |
|---|---|---|---|---|
| `syncing` | Jira API loop | Pre-fetched via `get_issue_count` | Every 50 issues | `{total, new, updated, unchanged}` |
| `promoting` | Per-row promote (`POST /api/staging/promote`) | Number of approved staging rows in this batch | Per row | `{promoted, failed}` |
| `extracting` | Plan-attachment downloads (sanitize pass 1) | Number of matching attachments not already cached | Per attachment | `{checked, extracted, failed, skipped, skipped_cached}` |
| `reconciling` | Hash classification + ai_score upsert (sanitize pass 2) | Story count | Once at end | `{new_pending, rescored, unchanged}` |
| `scoring` | Per-row scoring via `claude` CLI subprocess | Number of pending Story rows claimed | Per row | `{scored, failed, no_description}` |

`heartbeat_at` is committed every commit boundary (every 50 issues during sync, per-attachment during extract). A partial index `WHERE status='running'` makes stuck-run queries cheap.

### UI ETA query

```sql
SELECT phase,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM finished_at - started_at)) AS p50_s
FROM sync_phases
WHERE status = 'success'
GROUP BY phase;
```

The UI mixes `items_processed/items_total` (when known) with `now() - started_at` vs the historical p50 to render a believable progress bar.

Helpers: `backend/app/services/phase_service.py` — `open_phase`, `close_phase`, `tick`, `close_running_phases`.

---

## 12. Stuck-run reaper

If the worker process dies outside its `except` branch (kill -9, OOM, container restart), `sync_state.status` stays `running` forever and `POST /api/sync` returns 409 indefinitely.

The reaper (`backend/app/services/reaper_service.py`) handles this:

A run is **stuck** when:
- It has at least one phase, and the latest `heartbeat_at` is older than the threshold, OR
- It has no phases yet, and `started_at` is older than the threshold.

When found, the reaper:
- Marks `sync_state.status = error` with a "reaped" message and `finished_at = now()`
- Calls `close_running_phases` to flip any open phases to `error`
- Inserts a `failed_records` row (`error_code=UNKNOWN`, `phase=sync`) with detail explaining the cause

### Triggers

- **App startup** — FastAPI `lifespan` hook in `app/main.py` runs the reaper once on boot. Handles process-restart recovery automatically.
- **Manual** — `POST /api/sync/reap?threshold_minutes=10` for cases where the process is alive but the sync is hung. Default threshold 10 min, configurable per call (1–1440).

### Stuck-run detection query (for ad-hoc admin use)

```sql
SELECT * FROM sync_phases
WHERE status = 'running' AND heartbeat_at < now() - interval '10 minutes';
```

---

## 13. Failure handling

`failed_records` is the canonical error log for record-level failures across all pipeline phases.

| Field | Notes |
|---|---|
| `phase` | `sync` \| `promote` \| `sanitize` \| `score` (CHECK constrained) |
| `entity` | `issue` \| `user` \| `sprint` \| `comment` \| `attachment` \| `team` |
| `error_code` | `DEPENDENCY` \| `CONFLICT_UNIQUE` \| `CONFLICT_FIELDS` \| `VALIDATION` \| `RATE_LIMITED` \| `NETWORK` \| `UNKNOWN` |
| `fix_steps` | JSONB array, auto-populated by `failure_service.classify` based on error code |
| `sync_state_id` / `staging_id` | Optional FKs for traceability |
| `jira_ref` | The Jira key (or other identifier) of the failing record |
| `retry_count`, `last_retried_at` | Reserved for future retry support |
| `dismissed_at`, `dismissed_by` | Soft-dismiss without deleting |

`failure_service.classify(exc)` maps Python exceptions to error codes:
- `IntegrityError` with "unique" → `CONFLICT_UNIQUE`
- `IntegrityError` with "foreign key" → `DEPENDENCY`
- `httpx.HTTPStatusError(429)` → `RATE_LIMITED`
- `httpx.NetworkError` / `ConnectError` / `TimeoutException` → `NETWORK`
- `ValueError` / `TypeError` / `KeyError` → `VALIDATION`
- Anything else → `UNKNOWN`

`record_failure(...)` is callable from any `except` block and is safe to use after a rollback.

---

## 14. Worklog tracking

Each Jira worklog entry maps to one `worklogs` row. The intent is "where is dev time going" analytics — not just totals, but categorization via the comment text.

| Column | Notes |
|---|---|
| `jira_worklog_id` | UNIQUE; idempotent upserts on re-sync |
| `author_id` | FK → `users` (the dev who logged the time) |
| `started_at` | When the work was done (Jira's `started`, not `created`) |
| `time_spent_secs` | INT NOT NULL DEFAULT 0 |
| `comment_adf` | JSONB raw ADF blob (nullable) |
| `comment_text` | Plain text via `adf_to_text` (or pass-through if Jira returns a plain string) |

### Worklog → hash relationship

Worklogs are NOT directly hashed. But `time_spent_secs` IS, and Jira recomputes `aggregatetimespent` server-side whenever a worklog is added. So adding a worklog naturally bumps the hash, the issue re-stages, and the reviewer sees the new comment in `raw_payload`.

The user invariant this relies on: **users can add worklogs but cannot edit them**. If someone edits a worklog's `timeSpentSeconds`, that also changes the aggregate and re-triggers review. If someone edits only the comment of an existing worklog (not the time), the hash stays the same and review isn't re-triggered. This is acceptable per current product rules.

### Pagination

Jira returns up to 20 worklogs inline in the issue payload. When `worklog.total > len(inline)`, `_upsert_worklogs` calls `JiraClient.get_issue_worklogs(issue_key)` to page the rest from `/rest/api/3/issue/{key}/worklog`. Deletion-not-in-payload only runs when pagination succeeded, so a transient network failure can't drop rows we couldn't see (the upserts still apply; the missing IDs are left alone).

### Useful queries

```sql
-- Total time per author across all stories (last 30 days)
SELECT u.display_name,
       SUM(w.time_spent_secs)/3600.0 AS hours,
       COUNT(*) AS log_entries
FROM worklogs w JOIN users u ON u.id = w.author_id
WHERE w.started_at >= now() - interval '30 days'
GROUP BY u.display_name ORDER BY hours DESC;

-- Top time-consumers per story
SELECT i.jira_key, i.summary, SUM(w.time_spent_secs)/3600.0 AS hours
FROM worklogs w JOIN issues i ON i.id = w.issue_id
GROUP BY i.jira_key, i.summary
ORDER BY hours DESC LIMIT 20;

-- Free-text categorization (manual)
SELECT i.jira_key, w.started_at::date AS day,
       w.time_spent_secs/60 AS minutes, w.comment_text
FROM worklogs w JOIN issues i ON i.id = w.issue_id
WHERE w.comment_text ILIKE '%debug%'
ORDER BY w.started_at DESC;
```

The `comment_text` column is also a clean candidate for AI categorization later — could feed it to the scorer to bucket time as `debugging` / `code-review` / `infra` / `meeting`.

---

## 15. Analytics views

All defined in the single squashed migration `000100_initial_schema.py` as raw SQL `op.execute(...)` blocks (read the file for full definitions).

- **`v_issue_facts`** — denormalized one-row-per-issue with computed columns (`estimate_hours`, `spent_hours`, `over_budget`, `is_done`, `no_description`). All other views build on this.
- **`v_team_aggregates`** — per-team rollup including avg quality, scored count, points, skill detection, over-budget count.
- **`v_assignee_aggregates`** — same shape keyed on assignee.
- **`v_sprint_velocity`** — planned vs. completed points + completion %.
- **`v_epic_progress`** — completion stats per epic key.

The frontend's analytics endpoints query these views directly. Adding a new aggregate? Either:
1. Add the view's `CREATE OR REPLACE VIEW` block to the squashed `000100_initial_schema.py` (and re-run the squash workflow if you'd rather autogenerate first), OR
2. Compute it in `backend/app/services/analytics_service.py` against `v_issue_facts` (preferred for one-off queries).

---

## 16. API reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/sync` | Trigger a sync (`{"since": "..."}` or `{}`). 202 + new SyncStateOut. 409 only if another sync run is already running — promote / sanitize / score don't block. |
| `GET` | `/api/sync/state?kind=sync\|promote\|sanitize\|score` | Latest run with embedded phases. Omit `kind` for "latest of any kind". |
| `GET` | `/api/sync/state/{id}` | Fetch a specific sync_state by id (with phases). 404 if not found. **Primary polling endpoint for UI progress on promote / sanitize / score runs.** |
| `GET` | `/api/sync/history?kind=…&limit=N` | Recent runs (1..200, default 20) with phases. Optionally filtered by `kind`. |
| `POST` | `/api/sync/reap?threshold_minutes=N` | Reap stuck `running` runs across any kind (default 10 min). |
| `POST` | `/api/sanitize` | **Background.** 202 + new SyncStateOut (`triggered_by='api-sanitize'`). Records `extracting` + `reconciling` phases. Poll `/api/sync/state/{id}`. |
| `GET` | `/api/staging` | Paginated staging list + breakdown counts. Query: `status`, `change_type`, `sync_state_id`, `limit`, `offset`. |
| `PATCH` | `/api/staging/{id}` | Set `approved` or `skipped` with `reviewed_by` + `review_notes`. Reversal allowed except for `promoted` / `failed` terminals. |
| `POST` | `/api/staging/approve-all` | Bulk-approve all `pending` rows. |
| `POST` | `/api/staging/skip-all?reviewed_by=…` | Bulk-skip all `pending` rows. Skipped is terminal; PATCH back to `approved` to revive. |
| `POST` | `/api/staging/promote?limit=N` | **Background.** 202 + new SyncStateOut (`triggered_by='api-promote'`). Records a `promoting` phase. Optional `?limit=N` (1..10000) caps the batch. Poll `/api/sync/state/{id}`. |
| `POST` | `/api/score` | **Background.** 202 + ScoreTriggerOut with `sync_state_id` (`triggered_by='api-score'`). Body: `{limit, model?, triggered_by?, dry_run?}`. Records a `scoring` phase. In-process lock rejects a second simultaneous trigger with `accepted=false`. |
| `GET` | `/api/score/state` | Counts (pending / in_progress / completed / failed), tokens, cost, `latest_sync_state_id` for the most recent scoring run. |
| `*` | `/api/failed-records` | List/dismiss failed records (see `backend/app/api/failed_records.py`) |
| `*` | `/api/issues`, `/api/dimensions`, `/api/analytics` | Read-only views over the analytics data (see corresponding source files) |

OpenAPI/Swagger UI: `http://localhost:8008/docs`.

---

## 17. Verification harness

Six harnesses cover the pipeline:

- **Step 1 / Staging Flow 1** — first sync into empty staging.
- **Step 1 / Staging Flow 2** — re-sync against existing staging (active-row invariant).
- **Step 2 / Promote Flow 1** — first-time promote into empty actual tables.
- **Step 2 / Promote Flow 2** — re-promote with pre-existing actual data (update / replace / propagated deletions / worklog pagination).
- **Step 3 / Sanitize** — both passes (plan-attachment extraction with caching guard + `issue_ai_scores` reconciliation with orphan cleanup), against fresh and pre-populated states.
- **Step 4 / Scoring** — `score_pending` end-to-end with `subprocess.run` mocked: claim-and-mark, no-description short-circuit, parse failures, CLI errors (incl. subscription rate-limit bail), batch limit, model resolution, dry-run, stale-`in_progress` reaper.

Each cleans up after itself and uses prefixes (`VERIFY-` / `VERIFY-F2-` / `VERIFY-P1-` / `VERIFY-P2-` / `VERIFY-S1-` / `VERIFY-SC1-`) plus distinct `triggered_by` values, so production-shaped data is never touched. Staging harnesses run `sync_service.run_sync` with a mocked `JiraClient`; the promote harnesses insert approved staging rows directly and call `promote_approved`; the sanitize harness inserts issues + attachments directly and patches `attachment_extractor.JiraClient`; the scoring harness inserts pending `issue_ai_scores` rows directly and patches `scoring_service.subprocess.run` + `_load_agent` so the claude CLI is never actually invoked.

```bash
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py
.jira-analytics/bin/python backend/cli/verify_promote_flow2.py
.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py
.jira-analytics/bin/python backend/cli/verify_scoring_flow1.py
```

**Operator note for the scoring harness**: the claim is global (no prefix filter — that's intentional, so we exercise the real production query). If any non-`VERIFY-SC1-` pending Story `issue_ai_scores` rows are sitting in the DB, they'll be picked up by `_claim_pending` and pollute scenarios that assert counts (e.g. `G1`). The harness aborts loudly at startup if it finds stray rows; clean them up and re-run.

### Staging Flow 1 — first sync into empty staging

| ID | What it checks |
|---|---|
| A1 | Single populated issue → 1 staging row, change_type=`new`, metrics correct |
| A2 | 5 issues → 5 `new` rows |
| A3 | Different summaries → distinct hashes |
| A4 | Estimated/actual hours influence the hash |
| A5 | Sprint membership / customer / reported_by_customer affect hash; sprint state churn does not |
| A6 | Adding a worklog bumps the hash via `aggregatetimespent` |
| A7 | `persist_issue` stores worklogs with both ADF and plain-string comments |
| B5 | Issue with all-null optional fields stages cleanly |
| B6 | Unicode + emoji round-trip end-to-end |
| C10 | Empty Jira result → success, no rows, metrics all zero |
| D15 | Payload missing `fields` key → graceful (hash over None defaults) |
| D17 | Attachment without `filename` → hash uses empty string, no crash |
| D18a | Duplicate jira_key with identical content → silently deduped |
| D18b | Duplicate jira_key with different content → unique constraint error, sync ends in `error` |
| E19 | Jira returns 401 → sync ends in `error` with captured message |
| E20 | Network drop mid-pagination → rollback wipes uncommitted rows; sync + phase both `error` |
| G29 | Reaper marks stuck run as `error`; preserves healthy + heartbeating runs; idempotent on second call |

### Staging Flow 2 — re-sync against existing staging

| ID | What it checks |
|---|---|
| H1 | Re-sync, identical content → 0 new rows; metrics show all `unchanged` |
| H2 | Re-sync with one issue's hash changed → 1 `updated` row; others `unchanged` |
| H3 | Re-sync introducing a brand-new issue → 1 `new` row alongside untouched older ones |
| H4 | Mixed re-sync (1 updated, 1 unchanged, 1 absent, 1 brand new) — metrics correct |
| I1 | Prior `pending` + same hash → no new row, status preserved |
| I2 | Prior `pending` + hash changed → prior → `superseded` (with `superseded_at`); new `pending` row inserted (key invariant case) |
| I3 | Prior `approved` + same hash → no new row, status preserved |
| I4 | Prior `approved` + hash changed → prior → `superseded`; new `pending` row (eliminates stale-promote bug class) |
| I5 | Prior `skipped` + same hash → no new row |
| I6 | Prior `skipped` + hash changed → new `pending` row; prior `skipped` row stays terminal (no `superseded_at`) |
| I7 | Prior `promoted` + same hash → no new row |
| I8 | Prior `promoted` + hash changed → new `pending` row (re-edit case); prior `promoted` row stays terminal |
| I9 | Prior `failed` + hash changed → new `pending` row; prior `failed` row stays terminal |
| K1 | Three syncs with three distinct hashes → 3 rows; first two `superseded`, latest `pending` |
| K2 | Hash flap A → B → A → 3 rows; row[0].hash == row[2].hash but they're separate rows (`latest_hashes` only sees current latest) |
| L1 | Issue disappears from sync 2 (no longer in Jira's response) → its prior row preserved untouched, no auto-supersede on absence |
| U1 | Partial unique index `uq_staging_active_jira_key` rejects a raw `INSERT` that would create a second active row — proves DB-level enforcement of the invariant |

When you change `compute_payload_hash`, add a Flow-1 scenario asserting which fields shift the hash (pattern: A4 / A5 / A6). When you change the active-row state machine, add a Flow-2 scenario in Group I or U.

### Promote Flow 1 — first-time promote into empty actual tables

| ID | What it checks |
|---|---|
| A1 | No approved rows → no-op (`{promoted: 0, failed: 0}`); no `sanitize` key in result |
| A2 | Single minimal payload → 1 issue, no users/teams/sprints/children |
| B1 | Distinct assignee + reporter → 2 user rows, both FKs wired and differ |
| B2 | Same person as assignee + reporter → 1 user row, both FKs equal |
| B3 | Unassigned issue → no user row, both FKs NULL |
| B4 | Team field set → 1 team row, FK + name preserved |
| B5 | Sprint history (closed + active + future) → 3 sprints + 3 `issue_sprint` rows |
| B6 | Multi-value `customers` + `reported_by_customer="Yes"` → array stored, bool coerced |
| C1 | N comments by the assignee → N comment rows, no extra users |
| C2 | Comment by a third party → new user row created on demand |
| C3 | Attachments → N rows (metadata only; binaries pulled by sanitize, not promote) |
| C4 | Worklogs → N rows + author user; `time_spent_secs` mirrored on issue |
| C5 | Changelog histories → N rows in order |
| C6 | Kitchen sink: comments + attachments + worklogs + changelog + sprint + team — all wired |
| D1 | Two issues share assignee → 1 user, both issue FKs equal |
| D2 | Two issues share sprint → 1 sprint, 2 `issue_sprint` rows |
| D3 | Two issues share team → 1 team, both issue FKs equal |
| E1 | `epic_key` references an in-batch issue → stored as plain string (no FK), works regardless of order |
| E2 | Issue is itself an Epic → no special handling, persisted normally |
| F1 | Bad payload (missing top-level `key`) in a batch → 2 promoted, 1 → `failed`; `failed_records` row created; `review_notes` contains the traceback |
| F2 | After F1, re-running promote → 0 promoted, 0 failed (failed row not picked up) |
| G1 | After success: staging row `review_status='promoted'`, `promoted_at` set, `raw_payload` preserved |
| G3 | Promote does NOT auto-fire sanitize — no `issue_ai_scores` rows after promote; explicit `run_sanitize(db)` then materializes them |
| G4 | Order-independent: shared dimensions resolve to a single row regardless of staging `created_at` order |
| K1 | First promote populates `issue_metrics` with `comment_count` and `reopen_count`; `cycle_time_hours` / `lead_time_hours` NULL when no status changes/resolution |
| K2 | `cycle_time_hours` and `lead_time_hours` computed from changelog status transitions and `resolved_at` |
| K3 | `reopen_count` counts done → non-done transitions in changelog |
| P1 | `promote_approved(db, sync_state_id=N)` records a `promoting` phase row with `items_total`, `items_processed`, `metrics={promoted,failed}`, status=`success` |
| P2 | `promote_approved(db, limit=2)` honors the cap; remaining approved rows stay `approved` for a follow-up call |

When you change `persist_issue` or any of its `_upsert_*` / `_replace_*` helpers, add a Promote Flow 1 scenario in the appropriate group. When you change Step 2's coupling boundaries (e.g. re-introducing or further decoupling sanitize), update Group G. When you change the metrics computation, add a Group K scenario.

### Promote Flow 2 — re-promote with existing data

| ID | What it checks |
|---|---|
| A1 | Idempotent re-promote: identical content twice → 1 issue row, fields unchanged, both staging rows `promoted` |
| B1 | Summary + status change between promotes → issue row updated in place |
| B2 | Priority / story_points / labels change → all reflected on the same issue row |
| C1 | Assignee swap (Alice → Bob, Bob is new) → 2 user rows, FK now points to Bob, Alice row not orphaned |
| C2 | Assignee cleared (Alice → None) → FK NULL, Alice user row preserved |
| C3 | Team swap (Alpha → Beta) → both team rows retained, issue FK points to Beta |
| D1 | Sprint membership change ([S1, S2] → [S2, S3]) → `issue_sprints` reflects {S2, S3}; sprint dimension keeps S1, S2, S3 (no orphan deletion) |
| E1 | Comment added in v2 → 2 comment rows |
| E2 | Attachment added in v2 → 1 attachment row |
| E3 | Worklog added in v2 → 2 worklog rows |
| F1 | Comment edited (same `id`, ADF body changes) → 1 comment row, body field updated |
| G1 | Comment present in v1, absent in v2 → comment row DELETEd (deletion propagates) |
| G2 | Attachment present in v1, absent in v2 → attachment row DELETEd |
| G3 | Worklog absent in v2 inline AND total matches inline (complete set) → worklog row DELETEd |
| H1 | Changelog replay (identical histories) → final state correct (DELETE+REINSERT churn doesn't break correctness) |
| H2 | Changelog grew across promotes → 3 rows |
| I1 | Two successful promotes for the same key → both staging rows `promoted`, each preserves its own `raw_payload`, both `promoted_at` set |
| J1 | Failed first (bad payload), recovered second → row 1 `failed`, row 2 `promoted`, issue exists |
| J2 | Good first, failed second → first issue intact, row 1 `promoted`, row 2 `failed` |
| W1 | `worklog.total > len(inline)` → `JiraClient.get_issue_worklogs(key)` is called, all rows from the complete set are persisted |
| W2 | Pagination raises (network error) → fall back to inline upserts, **skip deletion** so we don't drop rows we couldn't see |

### Sanitize — Pass 1 (extraction) + Pass 2 (reconciliation)

| ID | What it checks |
|---|---|
| A1 | Empty DB → both passes return zeros |
| A2 | Story with no attachments → description preserved (still gets a pending score row) |
| A3 | Story with attachments but none match `implementation-plan` → description preserved |
| B1 | `.md` plan attachment → description overwritten with file body |
| B2 | `.txt` plan attachment → extracts |
| B3 | `.html` plan attachment → `<script>` and `<style>` excluded; visible text retained |
| B4 | `.markdown` extension supported |
| B5 | `.htm` extension supported (HTML path) |
| B6 | `.pdf` plan attachment → counted as `skipped`, description preserved |
| B7 | Filename case mismatch (`Implementation-Plan.md`) → still matches (`ILIKE`) |
| B8 | Filename embeds substring (`v2-implementation-plan-final.md`) → matches |
| C1 | Two plan attachments with different `created_at` → only the latest is downloaded (`DISTINCT ON`) |
| D1 | Bug with plan attachment → ignored; no score row created |
| D2 | Epic with plan attachment → ignored; no score row created |
| E1 | One Story's download raises `ConnectionError` → counted as `failed`, other Story still extracts |
| E2 | Binary noise in a `.txt` → still extracts via UTF-8 `errors='replace'` |
| G1 | First-time reconcile: Story with description → 1 new pending row, hash matches `SHA-256(description)` |
| G2 | First-time reconcile: Story with NULL description → 1 new pending row, hash = `SHA-256("")` |
| G4 | Bug / Task / Epic do not get `issue_ai_scores` rows |
| H1 | Re-sanitize, hash unchanged → counted as `unchanged`, status preserved |
| H2 | Re-sanitize, hash changed → row reset to `pending`, all 10 scoring outputs nulled, hash refreshed |
| H3 | Already-`scored` Story, hash still matches → status preserved (`scored_at`, `skill_name`, etc. intact) |
| H4 | Pass 1 rewrites description in *this* call → Pass 2 sees the change, resets row to `pending` (in-call ordering) |
| H-orphan | Pre-existing score row whose issue is no longer a Story → row deleted, counted as `orphaned_deleted` |
| I1 | Mixed batch (one new + one unchanged + one rescored) → counts correct |
| J1 | `run_sanitize(db, sync_state_id=N)` → `extracting` and `reconciling` rows appear in `sync_phases` with metrics populated |
| J2 | `run_sanitize(db)` (no sync_state_id) → no phase rows |
| M1 | Caching guard: a second sanitize on stable data does NOT re-download (`mock.calls` length stays at 1; `extraction_skipped_cached=1`) |
| M2 | Cache invalidates when a *newer* plan attachment is uploaded → second sanitize re-downloads the new one and overwrites the description |
| M3 | Full no-op re-sanitize: zero downloads, zero ai_score writes, all stories `unchanged` |
| M4 | Stickiness: plan attachment renamed away from `implementation-plan*` between sanitizes → description from first run preserved |
| M5 | Force re-extraction: clearing `extracted_at = NULL` makes the next sanitize re-download |

When you change `_decode_attachment` or the filename / extension matching, add a Group B scenario. When you change `_upsert_scoring_rows` (especially the orphan-cleanup query or the rescore field-nulling), add a Group H scenario. When you change the caching guard logic, add a Group M scenario.

### Scoring Flow 1 — `score_pending` against pending `issue_ai_scores`

| ID | What it checks |
|---|---|
| A1 | No pending rows → `ScoreSummary(attempted=0, scored=0)`, no `subprocess.run` calls |
| A2 | Single Story happy path → `completed` with all fields populated: `ai_score`, `ai_plan_detected`, `skill_name`, `skill_usage_detected`, `scored_at`, `total_cost_usd`, tokens |
| B1 | Story with NULL description → short-circuit `completed` with zeros, NO subprocess call |
| B2 | Story with whitespace-only description → same short-circuit as B1 |
| C1 | `ai_score=5` → `ai_plan_detected=True` |
| C2 | `ai_score=1` → `ai_plan_detected=False` |
| C3 | `skill_name=null` in agent response → `skill_usage_detected=False`, row still `completed` |
| D1 | Agent response JSON missing `quality_score` → row → `failed`, `failed_records` row created |
| D2 | `quality_score=7` (outside 0-5) → row → `failed` |
| D3 | `ai_score="3"` (wrong type) → row → `failed` |
| D4 | `skill_name="Foo"` (not in allowed set) → row → `failed` |
| D5 | Response with no JSON object at all → row → `failed` (regex match fails) |
| E1 | `claude` CLI not on PATH → `FileNotFoundError` → `RuntimeError` → row → `failed`, error message mentions `claude` |
| E2 | CLI exits non-zero with a non-rate-limit error → row → `failed`, `failed_records.error_code != RATE_LIMITED` |
| E3 | `subprocess.TimeoutExpired` → row → `failed`, `failed_records.error_code = TIMEOUT` |
| E4 | Rate-limit on the **first** call → row 1 → `failed`, rows 2–N released back to `pending`, batch bails, `failed_records.error_code = RATE_LIMITED`, mock called exactly once |
| E5 | Rate-limit on the **second** of three calls → 1 completed, 1 failed, 1 released; batch bails after 2 calls |
| G1 | `limit=2` with 5 pending → exactly 2 claimed, 2 scored; remaining 3 stay `pending` |
| G2 | Multiple pending Stories → claim+score in `issues.id` ascending order (verified via monotonic `scored_at`) |
| G3 | Bug / Epic / Task pending rows → ignored by the claim, only the Story scored |
| H1 | Model resolution precedence: explicit `model=` arg > `CLAUDE_MODEL` env > agent frontmatter (verified by inspecting the `--model` argv across three invocations) |
| I1 | `dry_run=True` → no `subprocess.run` calls, no DB writes; rows stay `pending` (claims auto-released) |
| I2 | Dry-run counts `no_description` correctly for a mixed batch |
| J1 | Stale `in_progress` (joined `issues.synced_at` older than 60-min threshold) → reset to `pending` by `_reap_stale_in_progress` at top of `score_pending`, then claimed and scored normally |
| K1 | `sync_state_id` provided → `scoring` phase row opened, ticked per row, closed with metrics `{scored, failed, no_description}` |

When you change `_invoke_claude`, `_parse_cli_output`, or `_parse_score_json`, add a Group C / D / E scenario. When you change the claim / reaper SQL, add a Group G / J scenario. When you change the rate-limit detection patterns, add a Group E scenario. When you change the phase-tracking integration, add a Group K scenario.

---

## 18. Common operations

### Trigger a sync

```bash
curl -X POST http://localhost:8008/api/sync -H 'Content-Type: application/json' -d '{}'
# → 202 with the new SyncState row
curl http://localhost:8008/api/sync/state | jq .
# → status, current phase, items_processed/items_total
```

### Review and promote

```bash
# See what's waiting
curl 'http://localhost:8008/api/staging?status=pending' | jq '.items[] | {jira_key, change_type}'

# Approve a single issue
curl -X PATCH http://localhost:8008/api/staging/42 \
     -H 'Content-Type: application/json' \
     -d '{"review_status": "approved", "reviewed_by": "you@lumberfi.com"}'

# Or bulk-approve everything pending
curl -X POST http://localhost:8008/api/staging/approve-all

# Or bulk-skip everything pending (terminal — promote ignores them)
curl -X POST 'http://localhost:8008/api/staging/skip-all?reviewed_by=you@lumberfi.com'

# Promote: 202 with sync_state_id; poll for progress
PROMOTE_ID=$(curl -sX POST http://localhost:8008/api/staging/promote | jq -r .id)
curl -s http://localhost:8008/api/sync/state/$PROMOTE_ID | jq .

# Run sanitize the same way
SANITIZE_ID=$(curl -sX POST http://localhost:8008/api/sanitize | jq -r .id)
curl -s http://localhost:8008/api/sync/state/$SANITIZE_ID | jq .

# Or watch all recent promotes / sanitizes / scores
curl -s 'http://localhost:8008/api/sync/history?kind=promote&limit=5' | jq .
```

### Recover a stuck run

```bash
# If the process crashed: just restarting the backend triggers the lifespan reaper.
# If the process is alive but the sync is hung:
curl -X POST 'http://localhost:8008/api/sync/reap?threshold_minutes=10'
```

### Inspect failures

```sql
-- Open failures (not dismissed)
SELECT id, phase, entity, jira_ref, error_code, title, created_at
FROM failed_records
WHERE dismissed_at IS NULL
ORDER BY created_at DESC LIMIT 50;

-- Failures grouped by error_code
SELECT error_code, COUNT(*) FROM failed_records
WHERE dismissed_at IS NULL GROUP BY error_code;
```

### Reset a Story for re-scoring

```sql
-- The hash mechanism handles this automatically when description changes.
-- To force-rescore a single Story manually:
UPDATE issue_ai_scores SET
  scoring_status='pending', description_hash=NULL,
  description_quality_score=NULL, ai_plan_detected=NULL,
  skill_usage_detected=NULL, skill_name=NULL,
  complexity_estimate=NULL, scoring_notes=NULL,
  model_used=NULL, scored_at=NULL,
  input_tokens=NULL, output_tokens=NULL, cache_read_tokens=NULL,
  error_message=NULL, raw_response=NULL
WHERE issue_id = (SELECT id FROM issues WHERE jira_key = 'LFI-123');
```

### Run a one-off Python session against the DB

```bash
.jira-analytics/bin/python -c "
import os, sys
os.environ.setdefault('DATABASE_URL', 'postgresql://admin:secret@localhost:5433/jira_analytics')
sys.path.insert(0, 'backend')
from app.db import SessionLocal
from app.models import Issue
from sqlalchemy import select
with SessionLocal() as db:
    n = db.execute(select(Issue)).scalars().all()
    print(f'{len(n)} issues')
"
```
