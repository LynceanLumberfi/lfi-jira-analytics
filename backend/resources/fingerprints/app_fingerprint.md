# Fingerprint: lfi-prepare-dev-plan

## Identity

| Field | Value |
| --- | --- |
| Name | `lfi-prepare-dev-plan` |
| Model | `claude-opus-4-6` |
| Invocation | User-invoked only (`disable-model-invocation: true`) |
| Inputs | `docs/implementation/jira-requirement.txt`, optional `--context <file-path>` |
| Output | `docs/implementation/app-dev-implementation-plan.md` (overwritten) |
| Companion | `/lfi-execute-dev-plan` consumes the output |

## Purpose

Reads a JIRA ticket and produces a structured App/Mobile implementation plan tailored to the LumberFI Timesheet RN/Expo codebase, applying coding guidelines from `docs/claude-skills/context/coding_guidelines.md`.

## Execution Flow

| Step | Action | Pause? |
| --- | --- | --- |
| 0 | Parse `--context <file>` if present | No |
| 1 | Read `jira-requirement.txt` + `coding_guidelines.md` | No |
| 2 | Analyze: goal, ACs, UX entities, data shape, API surface, affected dirs, phases | No |
| 3 | Print analysis summary, classify size (Small/Medium/Large) | **YES — wait for "yes"** |
| 4 | Generate phases interactively | **YES — between phases (Medium/Large)** |
| 5 | Confirm overwrite, then write file | **YES — wait for "yes"** |

## Phase Set

| # | Phase | Trigger |
| --- | --- | --- |
| 1 | Types & Constants | Always considered |
| 2 | API Module(s) | If HTTP/API involved |
| 3 | State Model (Easy Peasy) | Only if global state needed |
| 4 | Hooks & Shared Components | If reusable logic / UI |
| 5 | Screen / Route Wiring | If new screen or navigation change |
| 6 | Tests | Always (unit + component) |

## Per-Phase Schema (mandatory, fixed order)

1. Files
2. Implementation Details
3. Types & DTOs
4. API Changes
5. State / Store Changes
6. Components & Hooks
7. Tests

Empty sections render as `_None_` — never omitted, never merged.

## Output Format Rules

| Rule | Detail |
| --- | --- |
| Format | Markdown tables for all itemized content |
| Exceptions | Goal prose, TS/JSON fenced blocks, `_None_` placeholder |
| Top-level sections | Goal, Acceptance Criteria, Affected Areas, Architecture Notes, Phase N..., Conventions Reminder |
| File write | Overwrite (never append) |

## Affected-Directory Decision Table (canonical)

| Ticket involves... | Directory |
| --- | --- |
| New screen / route | `src/screens/<Feature>/` + `App.tsx` `Stack.Screen` + `RootStackParamList` |
| Reusable UI | Check `lumberfi-app-components/` first; fallback `src/components/` |
| Screen-specific sub-component | `src/screens/<Feature>/Components/` |
| Shared hook | `src/hooks/` or colocated `src/screens/<Feature>/hooks/` |
| Global state | `src/models/<domain>Model.ts` + `src/models/index.ts` + `src/store.ts` allow-list |
| Local UI state | `useState` / `useReducer` in screen |
| HTTP/API | `src/api/<domain>/` with `api*` prefix; `config.API_URL` / `config.PLATFORM_API_URL` |
| Domain types | `src/models/<domain>/` or `src/types/<domain>/` + `index.ts` re-export |
| Pure helper | `src/utils/` |
| Constants/enums | `src/constants/constants.ts` or feature-local |
| Permission/feature flag | `src/utils/roles.ts` / `src/utils/foremanPermission.ts` |
| Errors | `handleApiError` in `src/api/index.ts` + `openSnackbar` |
| Offline persistence | `src/services/offlineMode/repositories/<domain>.ts` + `migrations.ts`; gate on UDF flag |
| i18n | `locales/en.json` + `locales/es.json` |

## Hard Rules

- Always overwrite the plan file — never append.
- Always read coding guidelines before analysis.
- Strict template + strict per-phase sub-schema, fixed order.
- Use `_None_` for empty sections; never omit or merge.
- Tables only for itemized content.
- Pause after Step 3 analysis; pause between phases (Medium/Large); pause before write.
- Never invent component/hook/model names without codebase verification.
- Check `lumberfi-app-components/` before proposing new shared components.
- Apply `CODING_GUIDELINES` throughout; do not duplicate rules in plan.
