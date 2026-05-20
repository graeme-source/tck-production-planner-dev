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
