#!/usr/bin/env bash
# Pulls a full pg_dump of the live database to this Mac over Railway SSH (since
# 5 Nov 2026: the public connection stays closed after the October incident).
# Read-only against live: it logs in as claude_read. Runs on a schedule via
# launchd. keeps the last 14 dumps.
set -euo pipefail

BACKUP_DIR="${TCK_BACKUP_DIR:-$HOME/TCK-Backups}"
RETAIN=14   # about 3 GB each; two a day is a week of history without filling the Mac
MIN_BYTES=1000000000   # live DB compresses to about 3 GB; anything under 1 GB is broken
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

source "$HOME/TCK-Backups/bin/railway-db.sh"

REMOTE_FILE=/tmp/tck-backup.sql.gz
CHUNK_MB=64
SERVER_WAIT_MINUTES=40
# A long stream through Railway SSH stalls, so the dump is built on the database
# server first, then fetched in small pieces that are checked as a whole.
# Read-only login, low priority: it can't change anything or slow the app.
BUILD="rm -f $REMOTE_FILE*; nohup setsid bash -c 'set -o pipefail; nice -n 10 pg_dump -h /var/run/postgresql -U claude_read -d railway --no-owner --no-acl --format=plain | nice -n 10 gzip -6 > $REMOTE_FILE.tmp && mv $REMOTE_FILE.tmp $REMOTE_FILE && md5sum < $REMOTE_FILE | cut -d\" \" -f1 > $REMOTE_FILE.md5 || echo failed > $REMOTE_FILE.failed' > /dev/null 2>&1 < /dev/null &"

# Kill a piece that hangs: SSH can sit silent forever otherwise.
with_limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }

build_on_server() {
  on_db "$BUILD" 2>>"$LOG" || return 1
  local i state
  for i in $(seq 1 $((SERVER_WAIT_MINUTES * 2))); do
    sleep 30
    state=$(with_limit 60 bash -c 'source "$HOME/TCK-Backups/bin/railway-db.sh"; on_db "$0"' "if [ -f $REMOTE_FILE.failed ]; then echo failed; elif [ -f $REMOTE_FILE.md5 ]; then echo ready; else echo working; fi" 2>>"$LOG" | tail -1) || true
    [ "$state" = ready ] && return 0
    [ "$state" = failed ] && return 1
  done
  return 1
}

fetch_from_server() {
  local bytes chunks piece want got tries
  bytes=$(with_limit 60 bash -c 'source "$HOME/TCK-Backups/bin/railway-db.sh"; on_db "$0"' "wc -c < $REMOTE_FILE" 2>>"$LOG" | tail -1 | tr -d ' ')
  [ -n "$bytes" ] && [ "$bytes" -gt 0 ] || return 1
  chunks=$(( (bytes + CHUNK_MB * 1048576 - 1) / (CHUNK_MB * 1048576) ))
  : > "$TMP"
  for piece in $(seq 0 $((chunks - 1))); do
    want=$(( CHUNK_MB * 1048576 ))
    [ "$piece" -eq $((chunks - 1)) ] && want=$(( bytes - piece * CHUNK_MB * 1048576 ))
    for tries in 1 2 3 4 5; do
      with_limit 180 bash -c 'source "$HOME/TCK-Backups/bin/railway-db.sh"; on_db "$0"' "dd if=$REMOTE_FILE bs=1M skip=$((piece * CHUNK_MB)) count=$CHUNK_MB 2>/dev/null" > "$TMP.piece" 2>>"$LOG" || true
      got=$(stat -f%z "$TMP.piece")
      [ "$got" -eq "$want" ] && break
      log "WARN: piece $((piece + 1))/$chunks came back short ($got of $want bytes), try $tries"
      sleep 5
    done
    [ "$got" -eq "$want" ] || return 1
    cat "$TMP.piece" >> "$TMP"
  done
  rm -f "$TMP.piece"
  local expected actual
  expected=$(with_limit 60 bash -c 'source "$HOME/TCK-Backups/bin/railway-db.sh"; on_db "$0"' "cat $REMOTE_FILE.md5" 2>>"$LOG" | tail -1)
  actual=$(md5 -q "$TMP")
  [ -n "$expected" ] && [ "$expected" = "$actual" ]
}

STAMP=$(date '+%Y-%m-%d_%H%M%S')
OUT="$BACKUP_DIR/tck-prod-$STAMP.sql.gz"
TMP="$OUT.partial"

ATTEMPTS="${TCK_BACKUP_ATTEMPTS:-3}"
dumped=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  log "Starting backup -> $OUT (attempt $attempt/$ATTEMPTS)"
  if build_on_server && fetch_from_server && gzip -t "$TMP" 2>>"$LOG" \
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

on_db "rm -f $REMOTE_FILE*" 2>>"$LOG" || log "WARN: couldn't clear the copy on the server; the next run replaces it."
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
