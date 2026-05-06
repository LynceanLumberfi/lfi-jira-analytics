# lfi-jira-analytics

Local-first Jira Analytics Platform.

## Stack

- **PostgreSQL 16** (Docker, host `:5433` → container `:5432`)
- **FastAPI + SQLAlchemy + Alembic** (host venv, `:8008` via uvicorn `--reload`)
- **React + Vite + ECharts + TailwindCSS** (host, `:5173`)
- **Python CLIs** (host venv, talk to Postgres on `localhost:5433`)

## Layout

```
.
├── docker-compose.yml
├── .env                  # Postgres + Jira creds (gitignored)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/              # FastAPI app
│   │   ├── main.py
│   │   ├── api/
│   │   ├── models/
│   │   └── schemas/
│   └── cli/              # Click-based CLI tools
├── frontend/             # Vite + React + Tailwind (run locally)
│   ├── .env              # VITE_API_URL
│   └── src/
└── backups/              # mounted into the db container at /backups
```

## First-time setup

1. Copy env template and fill in your Jira credentials:
   ```bash
   cp .env.example .env
   # edit .env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
   ```

2. Start Postgres:
   ```bash
   docker compose up -d db
   ```

   - Postgres: `localhost:5433` (mapped from container :5432; using 5433 on host to avoid clash with another local Postgres)

3. Start the backend on the host:
   ```bash
   cd backend && ../.jira-analytics/bin/uvicorn app.main:app --port 8008 --reload
   ```

   - FastAPI: `http://localhost:8008` (health: `/health`, docs: `/docs`)

4. Install and run the frontend (locally, not in Docker):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   Vite dev server: `http://localhost:5173`. The frontend reads `VITE_API_URL` from `frontend/.env` (defaults to `http://localhost:8008`).

## Run database migrations

```bash
.jira-analytics/bin/alembic upgrade head
```

## Python environment

All Python commands **must** use the virtual environment at `.jira-analytics/` in the project root. No exceptions — never use `python`, `pip`, or any Python tool from the system or any other environment.

```bash
# Run Python
.jira-analytics/bin/python script.py

# Install packages
.jira-analytics/bin/pip install <package>

# Run tools (alembic, click CLIs, pytest, …)
.jira-analytics/bin/alembic upgrade head
```

Or activate first and use bare commands for the duration of the session:

```bash
source .jira-analytics/bin/activate
```

First-time setup on a fresh machine:

```bash
python3 -m venv .jira-analytics
.jira-analytics/bin/pip install --upgrade pip
.jira-analytics/bin/pip install -r backend/requirements.txt
```

## Run CLI tools

CLI tools live under `backend/cli/` and run on the host, talking to Postgres
on `localhost:5433`.

```bash
# AI scoring (Phase 5) — shells out to your local `claude` CLI
.jira-analytics/bin/python backend/cli/score.py --limit 50

# Verification harnesses — exercise the pipeline against the real code with
# mocked JiraClient (where needed). Each cleans up after itself.
.jira-analytics/bin/python backend/cli/verify_staging_flow1.py   # Step 1, first sync
.jira-analytics/bin/python backend/cli/verify_staging_flow2.py   # Step 1, re-sync (active-row invariant)
.jira-analytics/bin/python backend/cli/verify_promote_flow1.py   # Step 2, first promote
.jira-analytics/bin/python backend/cli/verify_promote_flow2.py   # Step 2, re-promote
.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py  # Step 3, both passes
.jira-analytics/bin/python backend/cli/verify_scoring_flow1.py   # Step 4, score_pending (subprocess mocked)
```

## Database backups

The `./backups` folder on the host is mounted to `/backups` inside the db
container. To dump:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  > backups/jira_analytics_$(date +%Y%m%d_%H%M%S).sql
```

To restore:

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < backups/your-dump.sql
```

## Common commands

| Command | What it does |
| --- | --- |
| `docker compose up -d db` | Start Postgres only |
| `cd backend && ../.jira-analytics/bin/uvicorn app.main:app --port 8008 --reload` | Start the API on the host |
| `.jira-analytics/bin/alembic upgrade head` | Run migrations from the host |
| `docker compose down` | Stop services (keeps volumes) |
| `docker compose down -v` | Stop services and drop the database volume |
| `cd frontend && npm run dev` | Start Vite dev server on :5173 |
| `.jira-analytics/bin/python backend/cli/verify_staging_flow1.py` | Step 1 first-sync verification |
| `.jira-analytics/bin/python backend/cli/verify_staging_flow2.py` | Step 1 re-sync verification |
| `.jira-analytics/bin/python backend/cli/verify_promote_flow1.py` | Step 2 first-promote verification |
| `.jira-analytics/bin/python backend/cli/verify_promote_flow2.py` | Step 2 re-promote verification |
| `.jira-analytics/bin/python backend/cli/verify_sanitize_flow1.py` | Step 3 sanitize verification (both passes) |
| `.jira-analytics/bin/python backend/cli/verify_scoring_flow1.py` | Step 4 scoring verification (subprocess mocked) |
