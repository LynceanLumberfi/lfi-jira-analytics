# Frontend Design Reference

Persistent design notes for the lfi-jira-analytics frontend. Built up phase-by-phase; load this at the start of any frontend session.

**Stack:** React 18 + Vite 6 + Tailwind 3.4 + ECharts 5.5 + @tanstack/react-query 5.62. Frontend serves on `:5173`, proxies `/api` → backend on `:8008`. The Vite proxy is already configured.

---

## 1. Mockup source

`JiraIntegration/` at the repo root is the designer's mockup (vanilla CSS + React, Lovable/v0-style — **not Tailwind**). We translate it to Tailwind + token-driven CSS variables on our end.

| File | Screens | Phase |
| --- | --- | --- |
| `Lumber x Jira Integration.html` | mounts the mockup | — |
| `styles.css` | design tokens (CSS custom properties) | reference |
| `ui.jsx` | shared components (icons, Sidebar, Topbar, StatusPill, TypeBadge, ConfBar, Toggle, JiraLogo, LumberLogo, Avatar, Code) | reference |
| `screens-a.jsx` | 01 Home, 02 Connect | **Phase 1** |
| `screens-b.jsx` | 03 Configure, 04 Sync Run | **Phase 1** (Sync Run only) |
| `screens-c.jsx` | 05 Review, 06 Manual Map | Phase 2 |
| `screens-d.jsx` | 07 History, 08 Failed, Architecture modal | **Phase 1** (History + Failed) |
| `screens-overview.jsx` | Home/Productivity/Quality/AI dashboards | Phase 3 |
| `screens-workspace.jsx` | per-team workspace pages | Phase 3 |
| `data.js`, `data-issues.js` | mock data shapes | reference |
| `tweaks-panel.jsx` | demo-state switcher (empty/first-sync/healthy/has-errors/conflict-heavy) | reference |

---

## 2. App shell

- **Sidebar (left, 240px, collapses to 64px):** Lumber logo, ⌘K search, workspace teams (nested with sub-pages), Settings → Integrations + Cost & Tokens, current user badge. Badges (e.g. "142") indicate unread/pending.
- **Topbar (sticky):** breadcrumbs left, theme toggle + action buttons right.
- **Main content:** max-width 1280px (1440px on wide pages).
- **Routing:** mockup uses hash routing; we use React Router v6.
- **Theme:** `[data-theme="light"|"dark"]` attribute on `:root`. Both palettes defined.

---

## 3. Design tokens (from `JiraIntegration/styles.css`)

### Neutrals (warm paper / clay)

| Token | Light | Dark (inverted luminosity) |
| --- | --- | --- |
| `--bg` | `#FAF7F2` | `#161310` |
| `--bg-elev` | `#FFFFFF` | (darker) |
| `--bg-sunken` | `#F2EEE7` | (darker) |
| `--border` | `#E7E1D6` | (darker) |
| `--border-strong` | `#D8D1C2` | (darker) |
| `--ink` (text 1°) | `#1F1B16` | (lighter) |
| `--ink-2` | `#4A4339` | |
| `--ink-3` | `#75695A` | |
| `--ink-4` | `#A39785` | |
| `--ink-5` | `#C9BFAD` | |

### Accent + status (OKLCH)

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `oklch(0.62 0.13 50)` | primary CTAs, in-progress states |
| `--ok` | `oklch(0.58 0.12 155)` | success |
| `--warn` | `oklch(0.72 0.14 75)` | warning |
| `--err` | `oklch(0.58 0.17 27)` | error |
| `--info` | `oklch(0.58 0.12 240)` | info |
| `--jira` | `oklch(0.55 0.18 255)` | Jira brand |

Soft and hover variants exist for each (`--accent-soft`, `--accent-hover`, etc.).

### Typography

- **Sans:** Inter (400 / 500 / 600 / 700)
- **Mono:** JetBrains Mono
- **Scale:**
  - Page title: 24px / 600
  - Card title: 14px / 600
  - Body: 14px / 400
  - Label: 12.5px / 500
  - Uppercase meta: 11px / 600 / +0.06em letter-spacing

### Radii + shadows

- Radii: `6px` (sm) / `10px` (md) / `14px` (lg) / `20px` (xl) / `999px` (pill)
- Shadows: sm (1–2px), md (2–6px cards), lg (10–30px modals/overlays)

---

## 4. Component patterns

| Mockup class | Tailwind component (ours) |
| --- | --- |
| `.btn`, `.btn.primary`, `.btn.accent`, `.btn.ghost`, `.btn.danger`, `.btn.sm`, `.btn.lg` | `<Button variant="default" \| "primary" \| "accent" \| "ghost" \| "danger" size="sm" \| "default" \| "lg">` |
| `.card`, `.card.sunken`, `.card-header`, `.card-pad`, `.card-pad-lg` | `<Card>`, `<CardHeader>`, `<CardBody>` (with `sunken` prop) |
| `.pill`, `.pill.ok`, `.pill.warn`, `.pill.err`, `.pill.info` | `<Pill tone="default" \| "ok" \| "warn" \| "err" \| "info">` |
| `.progress-track` + `.progress-fill` (shimmer-animated) | `<ProgressBar value={0–100} tone="accent" \| "ok" \| "err" shimmer />` |
| `.tbl-wrap` + `.tbl` (sticky thead, bg-sunken) | `<Table>`, `<THead>`, `<TBody>`, `<TR>`, `<TH>`, `<TD>` |
| `.input`, `.select`, `.textarea` | `<Input>`, `<Select>`, `<Textarea>` (focus ring uses `--accent-soft`) |
| Toggle (custom on/off) | `<Toggle>` |

Icons: lucide-react. Mockup names from `ui.jsx`: search, settings, plug, users, clock, cash, briefcase, bell, receipt, history, zap, check, x, alert, alertTri, info, arrow/arrowL/arrowDown, chev*, pause, play, refresh, download, filter, link, unlink, more, copy, external, shield, key, beaker, sparkles, loader, diff, network, spark, pencil, trash, eye, calendar, home, gauge, chart, sun.

Branded marks: `<JiraLogo>`, `<LumberLogo>`, `<ConnectorMark>`, `<Avatar>` (initials in name-hashed hue).

---

## 5. Backend API (current)

### Sync

- `POST /api/sync` → 202 + `SyncStateOut` (body: `{ since?: ISO8601 }`). 409 if a sync is running.
- `GET /api/sync/state/{id}` → `SyncStateOut` (with `phases: SyncPhaseOut[]`).
- `GET /api/sync/state?kind=sync|promote|sanitize|score` → latest `SyncStateOut` or `null`.
- `GET /api/sync/history?kind=sync&limit=20` → `SyncStateOut[]` (ordered by `started_at DESC`).
- `POST /api/sync/reap?threshold_minutes=N` → `{ reaped_count, reaped_ids }`.

### Failed records

- `GET /api/failed-records?status=open|dismissed|all&phase=&error_code=&entity=&sync_state_id=&limit=&offset=` → `{ items, total, open_count, dismissed_count, by_code }`.
- `POST /api/failed-records/{id}/dismiss` body `{ dismissed_by }` → `FailedRecordOut`.
- `POST /api/failed-records/{id}/retry` → `FailedRecordOut` (stub — increments `retry_count`).

### Integrations (Phase 1 additions)

- `GET /api/integrations/jira` → masked env config: `{ base_url, email, project_key, api_token_masked, custom_fields }`.
- `POST /api/integrations/jira/test` → `{ ok: boolean, account?: {...}, error?: string }`. Pings `/rest/api/3/myself`.

### Schemas

**`SyncStateOut`:** `id`, `status` (`running`/`success`/`error`), `started_at`, `finished_at`, `since`, `synced_until`, `issues_synced`, `error_message`, `triggered_by`, `phases[]`.

**`SyncPhaseOut`:** `id`, `phase`, `status`, `started_at`, `finished_at`, `heartbeat_at`, `items_total`, `items_processed`, `metrics` (JSON), `error_message`.

**Phase values (Phase 1):** `syncing`, `promoting`, `extracting_changelogs`, `extracting_comments`, `extracting_worklogs`, `extracting_attachments`, `reconciling`. (`extracting` legacy value retired; `scoring` is separate pipeline.)

### Credentials

Env-driven only: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`. Optional custom field IDs: `JIRA_FIELD_SPRINT`, `JIRA_FIELD_STORY_POINTS`, `JIRA_FIELD_TEAM`, etc.

---

## 6. Polling model

All async operations follow:

1. `POST /api/{operation}` → HTTP 202 + `SyncStateOut` (immediately, with `id`).
2. UI polls `GET /api/sync/state/{id}` every ~2 seconds via TanStack Query's `refetchInterval`.
3. `refetchInterval: (data) => data.status === 'running' ? 2000 : false` — polling stops automatically on `success`/`error`.
4. On `error`: read `error_message` and inspect `phases[].error_message` + `/api/failed-records?sync_state_id={id}`.

This pattern is uniform across sync, promote, sanitize, score.

---

## 7. Translation to our stack

1. **Tokens to Tailwind:** define OKLCH values as CSS variables on `:root` (and `[data-theme="dark"]`) in `src/index.css`. Reference them in `tailwind.config.js` `theme.extend.colors` as `accent: 'oklch(var(--accent) / <alpha-value>)'` etc. so the dark-mode swap is just a `data-theme` flip.
2. **Component layer:** ports live in `src/components/ui/`. Layout pieces (Sidebar, Topbar, AppShell) in `src/components/layout/`.
3. **Pages:** one file per route under `src/pages/`.
4. **Data layer:** `src/lib/api.ts` (typed fetchers), `src/lib/queryClient.ts` (QueryClient), `src/lib/hooks/` (useSyncPolling, useFailedRecords, …).
5. **Types:** TypeScript for all new code (`.tsx`/`.ts`). Existing `.jsx` in scaffold stays until App.jsx is replaced.

---

## 8. Phase 1 scope (Integration + data sync)

| Route | Page | Notes |
| --- | --- | --- |
| `/integrations` | Integration Home | KPI cards, connected Jira card, available integrations grid |
| `/integrations/connect` | Connect Jira (wizard) | 4 steps, env-driven read-only inputs |
| `/integrations/sync/:id` | Sync Run (live) | Polling, overall + phase progress |
| `/integrations/history` | Sync History | Past runs + audit drawer |
| `/integrations/failed` | Failed Records | Grouped error cards, dismiss/retry |

**Backend work also in Phase 1:**

- Parallelize the `extracting` phase: replace one row with four (`extracting_changelogs`, `extracting_comments`, `extracting_worklogs`, `extracting_attachments`) using `asyncio.gather` + `Semaphore(8)` to stay under Jira's ~40 req/sec.
- New integrations API endpoints (see §5).

**Out of Phase 1:**

- Configure page (entity toggles + field mappings)
- Review / Manual Mapping
- Analytics screens (overview, quality, AI)
- Cost & Tokens
- Auth / multi-user (user badge stubbed to a hardcoded value)
- Pause/Cancel sync (no backend support yet; rendered disabled with tooltip)

---

## 9. Notable mockup details to preserve

- **Outcome quad on Sync Run:** Created (ok) / Updated (info) / Unchanged / Review (warn). 2×2 grid. Sourced from `staging`+`promoting` phase `metrics` and open failed records.
- **Shimmer progress bar:** animated gradient on running state. 10px overall, 6px per-phase.
- **Audit timeline (History drawer):** colored dot per event keyed off tone (ok/warn/err/info/muted) + actor + time. We render one entry per phase + heartbeat ticks.
- **Error cards (Failed):** grouped by `error_code`. Expandable: "What happened" (`error_message`), "How to resolve" (static recipes keyed on `error_code`), "Raw response" (`<Code>` block).
- **Demo states (`tweaks-panel.jsx`):** empty / first-sync / healthy / has-errors / conflict-heavy. We do **not** ship this panel; just useful for testing UI states.

---

## 10. Deferred decisions

- **Auth:** user badge hardcoded to `"Lumber Admin"` in Phase 1.
- **Multi-integration:** Available grid (Acumatica, QuickBooks, …) shows visual placeholders only — Connect buttons disabled.
- **Pause/Cancel:** disabled with tooltip until backend supports them.
- **Configure page:** Phase 2; needs per-entity toggle + field-mapping endpoints first.
