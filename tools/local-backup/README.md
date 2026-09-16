# Local DB backup

Pulls a nightly `pg_dump` of the Railway production database to
`~/TCK-Backups/` on Graeme's Mac. This is the off-Railway copy that the
2026-05-20 outage proved we needed.

- **Schedule:** daily at 03:00 (via launchd; runs when Mac wakes if asleep at 03:00).
- **Retention:** 30 most recent daily dumps; older ones auto-deleted.
- **Format:** plain SQL, gzipped (`tck-prod-YYYY-MM-DD_HHMMSS.sql.gz`).
- **Convenience symlink:** `~/TCK-Backups/latest.sql.gz` always points at the newest.
- **Log:** `~/TCK-Backups/backup.log` (auto-rotates at 5MB).

## One-time setup

1. **Save the production connection string** outside the repo:

   ```bash
   cat > ~/.tck-backup.env <<'EOF'
   PROD_DATABASE_URL='postgresql://USER:PASS@HOST:PORT/railway'
   EOF
   chmod 600 ~/.tck-backup.env
   ```

   Get the URL from Railway → Postgres service → Variables → `DATABASE_URL`
   (use the **public** one, not the internal `*.railway.internal` host —
   that only resolves inside Railway's network).

2. **Install the launchd job:**

   ```bash
   cp "tools/local-backup/com.tck.dbbackup.plist" ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.tck.dbbackup.plist
   ```

3. **Test it once, right now:**

   ```bash
   bash tools/local-backup/backup.sh
   ls -lh ~/TCK-Backups/
   ```

   You should see a fresh `tck-prod-*.sql.gz` and a `latest.sql.gz` symlink.

## Restoring from a local dump

To inspect a dump:
```bash
gunzip -c ~/TCK-Backups/latest.sql.gz | less
```

To restore into a local Postgres for testing:
```bash
gunzip -c ~/TCK-Backups/latest.sql.gz | psql "postgresql://localhost/tck_restore_test"
```

**Never restore directly into production** without first inspecting the
dump and taking a Railway-side snapshot.

## Disabling / uninstalling

```bash
launchctl unload ~/Library/LaunchAgents/com.tck.dbbackup.plist
rm ~/Library/LaunchAgents/com.tck.dbbackup.plist
```

The script itself and the existing dumps remain.

## Daily local-DB refresh (added 2026-09-16)

`refresh-local-db.sh` + `com.tck.dbrefresh.plist` go one step further than
the backup: once a day they pull a FRESH dump from live and load it into
the local `tck_live`, so the local planner always has this morning's real
data. The Mac can't pull anything while it's shut down, so the job fires
at **login/boot** and at **05:30** (covers Macs left on or asleep —
whichever fires first wins, the script no-ops for the rest of the day).

Flow: fresh dump via `backup.sh` (read-only on live, and it doubles as the
day's off-Railway backup) → restore into `tck_live_fresh` → sanity checks →
atomic swap keeping the previous copy as `tck_live_prev` → re-seed the
local-only `claude-test` user → bounce the dev API on :3000. A failed pull
leaves `tck_live` untouched on yesterday's data — it never swaps in a
half-restored DB.

The plist runs the INSTALLED copy so it survives branch switches. Install /
update:

```bash
mkdir -p ~/TCK-Backups/bin
cp tools/local-backup/refresh-local-db.sh ~/TCK-Backups/bin/
cp tools/local-backup/com.tck.dbrefresh.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tck.dbrefresh.plist
```

Force a re-run today (e.g. to pull the latest orders mid-afternoon):

```bash
rm ~/TCK-Backups/.last-local-refresh && bash ~/TCK-Backups/bin/refresh-local-db.sh
```

Log: `~/TCK-Backups/refresh.log`. Disable the same way as the backup job,
with `com.tck.dbrefresh.plist` in place of the backup plist.
