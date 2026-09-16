#!/bin/bash
# Refresh the LOCAL dev database (tck_live) from the LIVE Railway database.
#
# Runs once per day, at first login (RunAtLoad) and at 05:30 for Macs left
# on or asleep overnight — see com.tck.dbrefresh.plist. The flow:
#
#   1. Fresh pg_dump of live via the existing backup.sh (READ-ONLY on live;
#      also lands in ~/TCK-Backups/ so it doubles as the off-Railway backup).
#   2. Restore into tck_live_fresh and sanity-check it.
#   3. Atomic swap: tck_live -> tck_live_prev (yesterday's copy kept as the
#      fallback), tck_live_fresh -> tck_live. The old DB is never dropped
#      until a VALIDATED fresh one is ready, so a failed pull can only ever
#      leave you on yesterday's data, never with no data.
#   4. Re-seed the local-only claude-test admin user and bounce the dev API
#      on :3000 so its connection pool moves to the new DB.
#
# SAFETY: PROD_DATABASE_URL is only ever passed to pg_dump (inside
# backup.sh). Nothing in this script writes to Railway.
#
# Manual run / re-run today: rm ~/TCK-Backups/.last-local-refresh && bash <this file>
set -uo pipefail

BACKUP_DIR="$HOME/TCK-Backups"
LOG="$BACKUP_DIR/refresh.log"
MARKER="$BACKUP_DIR/.last-local-refresh"
BACKUP_SH="${TCK_BACKUP_SH:-$HOME/Dev Projects/tck-production-planner-main/tools/local-backup/backup.sh}"
PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
TEST_EMAIL="claude-test@thecalzonekitchen.co.uk"

mkdir -p "$BACKUP_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
fail() { log "ERROR: $*"; exit 1; }

# Once per day — first trigger (login or 05:30) wins, the rest no-op.
TODAY=$(date '+%Y-%m-%d')
if [ -f "$MARKER" ] && [ "$(cat "$MARKER" 2>/dev/null)" = "$TODAY" ]; then
  exit 0
fi

log "=== Local DB refresh starting (trigger at login/schedule) ==="

# Local Postgres may still be starting just after boot.
for i in $(seq 1 60); do
  pg_isready -q 2>/dev/null && break
  sleep 5
done
pg_isready -q || fail "local Postgres not up after 5 minutes; giving up for today's trigger"

# 1) Fresh dump from live. backup.sh retries 3x itself; wrap with a few more
#    rounds so a slow Wi-Fi handshake right after boot doesn't lose the day.
dumped=0
for round in 1 2 3; do
  if bash "$BACKUP_SH" >> "$LOG" 2>&1; then dumped=1; break; fi
  log "WARN: backup.sh round $round failed; retrying in 60s"
  sleep 60
done
[ "$dumped" -eq 1 ] || fail "could not pull a fresh dump from live"

# 2) Restore into a scratch DB. ON_ERROR_STOP stays off: a live dump from a
#    newer pg_dump can carry harmless SET lines the local server rejects.
dropdb --if-exists tck_live_fresh >> "$LOG" 2>&1
createdb tck_live_fresh >> "$LOG" 2>&1 || fail "createdb tck_live_fresh failed"
gunzip -c "$BACKUP_DIR/latest.sql.gz" | psql -q -v ON_ERROR_STOP=0 tck_live_fresh >> "$LOG" 2>&1

# Sanity: don't swap in a half-restored DB.
TABLES=$(psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" tck_live_fresh 2>/dev/null || echo 0)
PLANS=$(psql -tAc "SELECT count(*) FROM production_plans" tck_live_fresh 2>/dev/null || echo 0)
USERS=$(psql -tAc "SELECT count(*) FROM app_users" tck_live_fresh 2>/dev/null || echo 0)
[ "$TABLES" -ge 100 ] || fail "fresh DB has only $TABLES tables; keeping current tck_live"
[ "$PLANS" -ge 1 ] || fail "fresh DB has no production plans; keeping current tck_live"
[ "$USERS" -ge 1 ] || fail "fresh DB has no users; keeping current tck_live"

# 3) Carry the local-only test user over (it doesn't exist on live).
TEST_COLS="name,email,password_hash,role,is_active,pin_hash,onboarding_required,password_changed_at"
HAVE=$(psql -tAc "SELECT count(*) FROM app_users WHERE email='$TEST_EMAIL'" tck_live_fresh)
if [ "$HAVE" = "0" ]; then
  psql tck_live -c "\\copy (SELECT $TEST_COLS FROM app_users WHERE email='$TEST_EMAIL') TO STDOUT" 2>/dev/null \
    | psql tck_live_fresh -c "\\copy app_users($TEST_COLS) FROM STDIN" >> "$LOG" 2>&1 \
    || log "WARN: could not carry claude-test user over (fine if it didn't exist)"
  psql -q tck_live_fresh -c "SELECT setval(pg_get_serial_sequence('app_users','id'), (SELECT max(id) FROM app_users));" >> "$LOG" 2>&1
fi

# 4) Swap. Terminate + rename must land together before a pooled client
#    reconnects, so retry the whole block a few times.
swapped=0
for round in 1 2 3 4 5; do
  if psql -q postgres >> "$LOG" 2>&1 <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname IN ('tck_live','tck_live_prev','tck_live_fresh') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS tck_live_prev;
ALTER DATABASE tck_live RENAME TO tck_live_prev;
ALTER DATABASE tck_live_fresh RENAME TO tck_live;
SQL
  then swapped=1; break; fi
  log "WARN: swap round $round failed (a client reconnected mid-swap?); retrying in 5s"
  sleep 5
done
[ "$swapped" -eq 1 ] || fail "could not swap tck_live_fresh into place"

# 5) Bounce the dev API (:3000) so its pool reconnects; launchd respawns it.
PIDS=$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null || true
  log "Bounced dev API on :3000 (launchd respawns it)"
fi

echo "$TODAY" > "$MARKER"
log "OK: tck_live now mirrors live as of this morning's pull; yesterday's copy kept as tck_live_prev"
