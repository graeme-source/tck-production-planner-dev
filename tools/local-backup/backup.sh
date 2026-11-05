#!/usr/bin/env bash
# Pulls a full pg_dump of the live database to this Mac over Railway SSH (since
# 5 Nov 2026: the public connection stays closed after the October incident).
# Read-only against live: it logs in as claude_read. Runs on a schedule via
# launchd. Keeps the last 30 dumps.
set -euo pipefail

BACKUP_DIR="${TCK_BACKUP_DIR:-$HOME/TCK-Backups}"
RETAIN=30
MIN_BYTES=1000000   # live DB compresses to ~135MB; anything under 1MB is broken
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

source "$HOME/TCK-Backups/bin/railway-db.sh"

# Runs on the database server under the read-only login, so it can't change
# anything, and at low priority so it doesn't slow the app.
REMOTE="bash -c 'set -o pipefail; nice -n 10 pg_dump -h /var/run/postgresql -U claude_read -d railway --no-owner --no-acl --format=plain | nice -n 10 gzip -6'"

STAMP=$(date '+%Y-%m-%d_%H%M%S')
OUT="$BACKUP_DIR/tck-prod-$STAMP.sql.gz"
TMP="$OUT.partial"

ATTEMPTS="${TCK_BACKUP_ATTEMPTS:-3}"
dumped=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  log "Starting backup -> $OUT (attempt $attempt/$ATTEMPTS)"
  # A dropped connection can end the stream quietly: the file must be a whole
  # gzip and reach pg_dump's own closing line to count.
  if on_db "$REMOTE" > "$TMP" 2>>"$LOG" && gzip -t "$TMP" 2>>"$LOG" \
     && gunzip -c "$TMP" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
    dumped=1
    break
  fi
  log "WARN: pg_dump attempt $attempt/$ATTEMPTS failed; discarding partial."
  rm -f "$TMP"
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    log "Retrying in 30s..."
    sleep 30
  fi
done

if [ "$dumped" -ne 1 ]; then
  log "ERROR: pg_dump failed after $ATTEMPTS attempts. No backup written; previous backups left untouched."
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

# Sweep away dead .partial files left by previous failed runs (older than a day),
# so the folder doesn't silently fill with half-written dumps.
find "$BACKUP_DIR" -name 'tck-prod-*.sql.gz.partial' -mtime +0 -delete 2>/dev/null || true

# Rotate the log if it's gotten big (>5MB).
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 5242880 ]; then
  mv "$LOG" "$LOG.1"
  log "(rotated previous log to $LOG.1)"
fi

COUNT=$(ls -1 "$BACKUP_DIR"/tck-prod-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
log "Done. Current backups: $COUNT"
