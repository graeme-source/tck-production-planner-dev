#!/usr/bin/env bash
# Pulls a full pg_dump of the Railway production database to the local
# Mac. Designed to run nightly via launchd. Keeps the last 30 daily
# dumps, prunes the rest. Refuses to declare success if the dump looks
# suspiciously small.
#
# Setup (one-time):
#   1. Put the production DATABASE_URL in ~/.tck-backup.env as:
#        PROD_DATABASE_URL='postgresql://user:pass@host:port/railway'
#      chmod 600 ~/.tck-backup.env
#   2. Load the launchd job:
#        launchctl load ~/Library/LaunchAgents/com.tck.dbbackup.plist
#   3. Test once: bash tools/local-backup/backup.sh
set -euo pipefail

ENV_FILE="${TCK_BACKUP_ENV:-$HOME/.tck-backup.env}"
BACKUP_DIR="${TCK_BACKUP_DIR:-$HOME/TCK-Backups}"
RETAIN=30
MIN_BYTES=50000   # anything smaller than 50KB is almost certainly broken
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

STAMP=$(date '+%Y-%m-%d_%H%M%S')
OUT="$BACKUP_DIR/tck-prod-$STAMP.sql.gz"
TMP="$OUT.partial"

log "Starting backup -> $OUT"

# pg_dump straight into gzip. --no-owner / --no-acl keeps the dump
# portable to a fresh local Postgres if we ever need to restore for
# inspection. -Fp = plain SQL so it's human-readable + grep-able.
if /opt/homebrew/bin/pg_dump \
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

# Prune old dumps — keep the most recent $RETAIN files.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/tck-prod-*.sql.gz 2>/dev/null | tail -n +$((RETAIN + 1)))
for f in "${OLD[@]:-}"; do
  [ -n "$f" ] || continue
  log "Pruning $f"
  rm -f "$f"
done

# Rotate the log if it's gotten big (>5MB).
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 5242880 ]; then
  mv "$LOG" "$LOG.1"
  log "(rotated previous log to $LOG.1)"
fi

log "Done. Current backups: $(ls -1 "$BACKUP_DIR"/tck-prod-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
