# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills

# dump-db
- **dump-db** (`.claude/skills/dump-db/SKILL.md`) - pg_dump of jira_analytics into backups/. Trigger: `/dump-db`
When the user types `/dump-db`, invoke the Skill tool with `skill: "dump-db"` before doing anything else.

## Python environment

All Python commands **must** use the virtual environment at `.jira-analytics/` in the project root. No exceptions — never use `python`, `pip`, or any Python tool from the system or any other environment.

```bash
# Run Python
.jira-analytics/bin/python script.py

# Install packages
.jira-analytics/bin/pip install <package>

# Run tools (alembic, click CLIs, pytest, …)
.jira-analytics/bin/alembic upgrade head
.jira-analytics/bin/python backend/cli/sync.py
```

Or activate first and use bare commands for the duration of the session:

```bash
source .jira-analytics/bin/activate
```

The venv is Python 3.10.20 from pyenv. The Dockerfile is pinned to the same `python:3.10.20-slim` image so host CLIs and the containerized backend share an identical Python version.

When adding a new dependency: edit `backend/requirements.txt`, then run `.jira-analytics/bin/pip install -r backend/requirements.txt` to keep the venv in sync.

## Stack

- **PostgreSQL 16** in Docker (service `db`, host port `:5433` → container `:5432`, volume `pgdata`, `./backups` mounted at `/backups`)
- **FastAPI + SQLAlchemy + Alembic** on the **host** at `:8008` via the `.jira-analytics` venv (uvicorn `--reload`). The Dockerfile + compose `backend` service still build but are unused day-to-day; the AI scoring endpoint shells out to the `claude` CLI which only exists on the host.
- **React + Vite + Tailwind + ECharts + @tanstack/react-query** on the host (`:5173`, proxies `/api` → `:8008`)
- **Python CLIs** under `backend/cli/`, run on the host via `.jira-analytics/bin/python`, talk to Postgres on `localhost:5433`

## Port note

Host port for Postgres is `5433`, not the spec default `5432`. Reason: an unrelated `lumberfi-services` Postgres container holds host `:5432`. The container internally still listens on `:5432` — only the host mapping changed. If that situation changes, update `docker-compose.yml`, `.env`, `.env.example`, and this file together.

## DATABASE_URL: host vs container

`.env` holds the **host** value (`postgresql://admin:secret@localhost:5433/jira_analytics`) so host CLIs and `.jira-analytics/bin/alembic` work out of the box. `docker-compose.yml` overrides `DATABASE_URL` on the `backend` service to `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}` so the container reaches Postgres over the compose network. Both env.py (alembic) and `app/db.py` read whichever value is in scope at runtime.

## Common commands

| Command | What it does |
| --- | --- |
| `docker compose up -d db` | Start Postgres only (the recommended dev setup) |
| `cd backend && ../.jira-analytics/bin/uvicorn app.main:app --port 8008 --reload` | Start the API on the host |
| `.jira-analytics/bin/alembic upgrade head` | Run migrations from the host |
| `.jira-analytics/bin/python backend/cli/<command>.py` | Run a CLI tool against local Postgres |
| `.jira-analytics/bin/python backend/cli/score.py --limit 200` | Run the AI scoring CLI (uses your local `claude` CLI) |
| `cd frontend && npm run dev` | Start Vite dev server on `:5173` |

## Project structure

```
backend/
├── Dockerfile           # python:3.10.20-slim (matches host venv)
├── requirements.txt     # fastapi, sqlalchemy, alembic, psycopg2-binary, click, httpx, pandas, …
├── alembic.ini          # url is set at runtime by env.py (reads DATABASE_URL from .env)
├── alembic/
│   ├── env.py           # loads .env, target_metadata = Base.metadata
│   └── versions/        # single squashed 000100_initial_schema.py (no chains while pre-launch)
├── app/
│   ├── main.py          # FastAPI app + lifespan reaper hook
│   ├── db.py            # SQLAlchemy engine, SessionLocal, Base, get_db dependency
│   ├── api/             # routers: sync, staging, sanitize, score, failed_records, issues, dimensions, analytics
│   ├── models/          # SQLAlchemy models (user, team, sprint, issue, issue_sprint, changelog, comment, attachment, worklog, issue_metrics, issue_ai_score, staging_issue, sync_state, sync_phase, failed_record)
│   ├── schemas/         # Pydantic request/response models
│   └── services/        # business logic (sync, staging, sanitize, scoring, reaper, failure)
└── cli/                 # score.py (AI scoring), verify_staging_flow1.py + verify_staging_flow2.py (verification harnesses)
frontend/                # Vite + React + Tailwind + ECharts (host)
backups/                 # mounted into the db container at /backups
docker-compose.yml
.env / .env.example      # POSTGRES_*, DATABASE_URL, JIRA_*
.jira-analytics/         # Python venv (gitignored)
```

## Companion repo

`../lfi-dev-analytics/` is the user's existing CSV-based AI scoring pipeline. When implementing the AI enrichment phase here, **rewrite from scratch** using that project only as a reference for prompt structure, batching, and `TokenUsage` shape. Do not copy files.
