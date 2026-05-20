#!/usr/bin/env bash
# Postgres data recovery from a mounted volume containing a crashed
# cluster. Tries in escalating order:
#   1. Start postgres on a writable copy as-is
#   2. pg_resetwal -f, then start
#   3. Manual single-user mode
#   4. Stay alive so a human can poke around / run pg_filedump
#
# Source (mounted, read-only in intent): /mnt/old-data/pgdata
# Work copy (writable):                   /var/lib/postgresql/work
# Target to restore into:                 $DATABASE_URL (Postgres-lYTL)
#
# IMPORTANT: We never write into /mnt/old-data. All mutations happen on
# the copy in /var/lib/postgresql/work so the original volume stays
# intact for further attempts.
set -u

OLD=/mnt/old-data/pgdata
WORK=/var/lib/postgresql/work
LOGFILE=/tmp/pg.log
DUMPFILE=/tmp/recovered.sql
PORT=5433

banner() { printf "\n========== %s ==========\n" "$*"; }

banner "Source inventory"
if [ ! -d "$OLD" ]; then
  echo "ERROR: $OLD does not exist."
  echo "Contents of /mnt/old-data/:"
  ls -la /mnt/old-data/ 2>&1 || echo "(no /mnt/old-data either)"
  echo "Top-level mounts:"
  mount | grep -i "old-data\|postgres\|vol_" || true
  banner "Sleeping 24h so the container can be inspected via Railway shell"
  sleep 86400
  exit 1
fi

ls -la "$OLD" | head -30
echo ""
echo "PG_VERSION file:"
cat "$OLD/PG_VERSION" 2>/dev/null || echo "(missing — bad sign)"
echo ""
echo "Directory size:"
du -sh "$OLD" 2>/dev/null
echo ""
echo "Subdirectories:"
ls -d "$OLD"/*/ 2>/dev/null | head -20

banner "Copy to writable location (so we don't touch the original)"
rm -rf "$WORK"
mkdir -p "$WORK"
cp -a "$OLD/." "$WORK/"
chown -R postgres:postgres "$WORK"
chmod 700 "$WORK"
echo "Copy complete. Size:"
du -sh "$WORK"

# The Railway-managed postgres-ssl image referenced SSL certs at a path
# that doesn't exist in the official postgres image. Strip those config
# lines so the server can actually start. Also clear postgresql.auto.conf
# in case Railway's auto-tuner left similar references.
banner "Strip Railway-image-specific SSL references from postgresql.conf"
for f in "$WORK/postgresql.conf" "$WORK/postgresql.auto.conf"; do
  if [ -f "$f" ]; then
    echo "Before (ssl / cert lines in $f):"
    grep -nE '^\s*(ssl|ssl_cert_file|ssl_key_file|ssl_ca_file)\b' "$f" || echo "(none)"
    # Comment out any SSL-related directive so the defaults (ssl=off) apply.
    sed -i -E 's/^(\s*)(ssl[^=]*=)/\1# disabled-by-recovery \2/' "$f"
    echo "After:"
    grep -nE '^\s*(ssl|ssl_cert_file|ssl_key_file|ssl_ca_file)\b' "$f" || echo "(none — clean)"
  fi
done

# Some earlier recovery attempt dropped a recovery.signal file into the
# old data dir. That puts Postgres into archive-recovery mode on start,
# which we don't want; we just want a normal start on the live data.
if [ -f "$WORK/recovery.signal" ]; then
  echo "Removing leftover recovery.signal (was forcing archive recovery)."
  rm -f "$WORK/recovery.signal"
fi

# Re-apply ownership in case our edits touched root-owned files.
chown -R postgres:postgres "$WORK"
chmod 700 "$WORK"

# Pre-flight: ensure pg_control is readable.
banner "pg_controldata"
if su -p postgres -c "pg_controldata $WORK" 2>&1; then
  echo "(pg_controldata succeeded — cluster metadata is readable)"
else
  echo "(pg_controldata failed — cluster metadata may be damaged)"
fi

# Attempt 1: start as-is.
banner "Attempt 1 — start Postgres on the copy AS-IS"
rm -f "$LOGFILE"
if su -p postgres -c "pg_ctl -D $WORK -l $LOGFILE -o \"-p $PORT -c listen_addresses=127.0.0.1 -c ssl=off\" -w -t 30 start" 2>&1; then
  echo "✓ Postgres started without intervention."
  SERVER_UP=1
else
  echo "✗ Attempt 1 failed. Postmaster log:"
  cat "$LOGFILE" 2>/dev/null || echo "(no log file produced)"
  SERVER_UP=0
fi

# Attempt 2: pg_resetwal then start.
if [ "${SERVER_UP:-0}" -ne 1 ]; then
  banner "Attempt 2 — pg_resetwal -f then start"
  echo "Running pg_resetwal -f $WORK"
  su -p postgres -c "pg_resetwal -f $WORK" 2>&1 || echo "(pg_resetwal returned non-zero; continuing anyway)"

  rm -f "$LOGFILE"
  if su -p postgres -c "pg_ctl -D $WORK -l $LOGFILE -o \"-p $PORT -c listen_addresses=127.0.0.1 -c ssl=off\" -w -t 30 start" 2>&1; then
    echo "✓ Postgres started after pg_resetwal."
    SERVER_UP=1
  else
    echo "✗ Attempt 2 failed. Postmaster log:"
    cat "$LOGFILE" 2>/dev/null || echo "(no log file produced)"
  fi
fi

# Attempt 3: zero_damaged_pages + ignore_system_indexes.
if [ "${SERVER_UP:-0}" -ne 1 ]; then
  banner "Attempt 3 — start with zero_damaged_pages=on and ignore_system_indexes=on"
  rm -f "$LOGFILE"
  if su -p postgres -c "pg_ctl -D $WORK -l $LOGFILE -o \"-p $PORT -c listen_addresses=127.0.0.1 -c ssl=off -c zero_damaged_pages=on -c ignore_system_indexes=on\" -w -t 30 start" 2>&1; then
    echo "✓ Postgres started in tolerant mode."
    SERVER_UP=1
  else
    echo "✗ Attempt 3 failed. Postmaster log:"
    cat "$LOGFILE" 2>/dev/null || echo "(no log file produced)"
  fi
fi

if [ "${SERVER_UP:-0}" -ne 1 ]; then
  banner "All start attempts failed — keeping container alive for forensic work"
  echo "Diagnostic hints — run via Railway shell:"
  echo "  su -p postgres -c 'pg_controldata $WORK'"
  echo "  ls -la $WORK/global/"
  echo "  pg_filedump -i -f $WORK/global/<filename>"
  echo ""
  echo "Sleeping 24h."
  sleep 86400
  exit 1
fi

banner "Postgres is up — listing databases"
su -p postgres -c "psql -p $PORT -l" 2>&1 || true

banner "Dump every database with pg_dumpall"
if su -p postgres -c "pg_dumpall -p $PORT --clean --if-exists" > "$DUMPFILE" 2>/tmp/dump.err; then
  echo "✓ pg_dumpall succeeded."
else
  echo "✗ pg_dumpall returned non-zero. Errors:"
  cat /tmp/dump.err
  echo ""
  echo "Partial dump may still be usable — continuing."
fi

banner "Dump file stats"
DUMP_SIZE=$(stat -c%s "$DUMPFILE" 2>/dev/null || echo 0)
DUMP_LINES=$(wc -l < "$DUMPFILE" 2>/dev/null || echo 0)
DUMP_COPY_BLOCKS=$(grep -c "^COPY " "$DUMPFILE" 2>/dev/null || echo 0)
DUMP_TABLES=$(grep -c "^CREATE TABLE " "$DUMPFILE" 2>/dev/null || echo 0)
echo "Path:        $DUMPFILE"
ls -lah "$DUMPFILE"
echo "Size:        $DUMP_SIZE bytes (~$(echo "$DUMP_SIZE/1024/1024" | bc 2>/dev/null) MB)"
echo "Lines:       $DUMP_LINES"
echo "CREATE TABLE blocks: $DUMP_TABLES"
echo "COPY data blocks:    $DUMP_COPY_BLOCKS"
echo ""
echo "Per-table row counts in the dump (real numbers, parsed from COPY blocks):"
awk '/^COPY [^ ]+ /{tbl=$2; n=0; next} /^\\\.$/{print tbl, n; tbl=""; next} tbl!=""{n++}' "$DUMPFILE" | sort -k2 -n -r | head -40 || true

# Live-cluster stats too, for sanity. n_live_tup may be 0 because the
# server only just started — don't trust them, but they're a cheap
# second opinion.
banner "Live-cluster row counts via SELECT count(*) (slower but accurate)"
for t in app_users recipes ingredients sub_recipes storage_locations suppliers checklist_templates risk_assessments production_plans temperature_records batch_weight_records; do
  CNT=$(su -p postgres -c "psql -p $PORT -d railway -tAc 'SELECT count(*) FROM $t' 2>/dev/null" || echo "ERR")
  printf "  %-30s %s\n" "$t" "$CNT"
done

# Optional auto-restore. Gated by AUTO_RESTORE=yes so this doesn't
# accidentally clobber the live DB on every redeploy. Includes a size
# guard: refuses if the dump is suspiciously small.
if [ "${AUTO_RESTORE:-}" = "yes" ]; then
  banner "AUTO_RESTORE=yes — restoring into \$DATABASE_URL"
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL not set — aborting restore."
  elif [ "$DUMP_SIZE" -lt 100000 ]; then
    echo "Dump is only $DUMP_SIZE bytes — refusing to restore (likely empty/broken)."
  else
    echo "Target: $DATABASE_URL"
    echo "Restoring ($DUMP_SIZE bytes)..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=0 < "$DUMPFILE" > /tmp/restore.stdout 2> /tmp/restore.stderr
    RESTORE_EXIT=$?
    echo "psql exited with $RESTORE_EXIT"
    echo ""
    echo "stderr tail (errors during restore — some are expected from --clean):"
    tail -40 /tmp/restore.stderr
    echo ""
    banner "Post-restore verification — row counts in live DB"
    for t in app_users recipes ingredients sub_recipes storage_locations suppliers checklist_templates risk_assessments production_plans temperature_records batch_weight_records; do
      CNT=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo "ERR")
      printf "  %-30s %s\n" "$t" "$CNT"
    done
    echo ""
    echo "If row counts look right, the live app should now show real data."
    echo "Kitchen may need to refresh / re-login."
  fi
else
  banner "AUTO_RESTORE not set — no restore performed"
  echo "Dump is sitting at $DUMPFILE inside this container."
  echo "To restore: set Variable AUTO_RESTORE=yes on this service then Redeploy."
fi

echo ""
echo "Sleeping 24h so this container can be inspected later."
sleep 86400
