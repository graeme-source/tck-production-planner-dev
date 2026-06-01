#!/usr/bin/env bash
# Pulls a full pg_dump of the Railway production database (Postgres-IYTL)
# to this Mac. Read-only against the live cluster — never writes back.
# Designed to run on a schedule via launchd. Keeps the last 30 dumps.
#
# Setup (one-time):
#   1. Put the production connection string in ~/.tck-backup.env as:
#        PROD_DATABASE_URL='postgresql://postgres:PASS@HOST:PORT/railway'
#      chmod 600 ~/.tck-backup.env
#   2. launchctl load ~/Library/LaunchAgents/com.tck.dbbackup.plist
#   3. Test once: bash tools/local-backup/backup.sh
set -euo pipefail

ENV_FILE="${TCK_BACKUP_ENV:-$HOME/.tck-backup.env}"
BACKUP_DIR="${TCK_BACKUP_DIR:-$HOME/TCK-Backups}"
RETAIN=30
MIN_BYTES=1000000   # live DB compresses to ~135MB; anything under 1MB is broken
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

if [ ! -f "$ENV_FILE" ]; then
  log "ERROR: $ENV_FILE not found. Create it with PROD_DATABASE_URL=... (chmod 600)."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${PROD_DATABASE_URL:-}" ]; then
  log "ERROR: PROD_DATABASE_URL not set in $ENV_FILE."
  exit 1
fi

# Railway runs Postgres 18; pg_dump refuses to dump a server newer than itself,
# so prefer a versioned client over the default Homebrew pg_dump.
PG_DUMP="/opt/homebrew/bin/pg_dump"
for candidate in /opt/homebrew/opt/postgresql@18/bin/pg_dump /opt/homebrew/opt/postgresql@17/bin/pg_dump; do
  if [ -x "$candidate" ]; then
    PG_DUMP="$candidate"
    break
  fi
done

STAMP=$(date '+%Y-%m-%d_%H%M%S')
OUT="$BACKUP_DIR/tck-prod-$STAMP.sql.gz"
TMP="$OUT.partial"

log "Starting backup -> $OUT"
log "Using $PG_DUMP ($($PG_DUMP --version 2>&1 | head -1))"

if "$PG_DUMP" \
      --no-owner --no-acl \
      --format=plain \
      --dbname="$PROD_DATABASE_URL" 2>>"$LOG" \
    | gzip -9 > "$TMP"; then
  :
else
  log "ERROR: pg_dump failed. Partial file left at $TMP for inspection."
  exit 1
fi

SIZE=$(stat -f%z "$TMP")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  log "ERROR: dump is only $SIZE bytes (< $MIN_BYTES). Not promoting. See $TMP."
  exit 1
fi

mv "$TMP" "$OUT"
ln -sfn "$OUT" "$BACKUP_DIR/latest.sql.gz"
log "OK: wrote $OUT ($SIZE bytes)"

# Prune old dumps — keep the most recent $RETAIN. Uses a while-read loop
# (not mapfile) so it works on macOS's default bash 3.2.
ls -1t "$BACKUP_DIR"/tck-prod-*.sql.gz 2>/dev/null | tail -n +$((RETAIN + 1)) | while IFS= read -r old; do
  [ -n "$old" ] || continue
  log "Pruning $old"
  rm -f "$old"
done

# Rotate the log if it's gotten big (>5MB).
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 5242880 ]; then
  mv "$LOG" "$LOG.1"
  log "(rotated previous log to $LOG.1)"
fi

COUNT=$(ls -1 "$BACKUP_DIR"/tck-prod-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
log "Done. Current backups: $COUNT"
