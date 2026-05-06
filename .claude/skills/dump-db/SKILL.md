---
name: dump-db
description: "Take a pg_dump of the jira_analytics database into the project backups/ folder. File is named jira_analytics.dump; if that exists, jira_analytics(1).dump, jira_analytics(2).dump, etc."
trigger: /dump-db
---

# /dump-db

Take a compressed pg_dump of the `jira_analytics` PostgreSQL database and write it to the `backups/` folder in the current project.

## Steps

1. **Resolve the output filename** — starting from `jira_analytics.dump`, check whether `backups/jira_analytics.dump` already exists. If it does, try `backups/jira_analytics(1).dump`, then `backups/jira_analytics(2).dump`, and so on until a free slot is found.

   Run this shell one-liner to compute the filename:
   ```bash
   f=backups/jira_analytics.dump; n=1; while [ -f "$f" ]; do f="backups/jira_analytics($n).dump"; n=$((n+1)); done; echo "$f"
   ```

2. **Run pg_dump inside the db container** (host does not have `pg_dump`):
   ```bash
   docker exec $(docker compose ps -q db) pg_dump -U admin -Fc jira_analytics -f /backups/<resolved-filename-basename>
   ```
   The `backups/` host directory is mounted at `/backups` inside the container, so use only the basename after `/backups/` for the `-f` path.

3. **Verify** — confirm the file exists and print its size with `ls -lh <resolved-filename>`.

4. **Report** — tell the user the full path of the dump file and its size.

## Notes
- Always use `-Fc` (custom format) so the dump can be restored with `pg_restore`.
- Database credentials: host `localhost`, port `5433`, user `admin`, db `jira_analytics`.
- If the db container is not running, tell the user to start it with `docker compose up -d db`.
