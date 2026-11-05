#!/bin/bash
# Make a change to LIVE data, all or nothing. Only run when Graeme asks.
#   live-change.sh --dry-run before.sql change.sql   shows what it would do, then undoes it
#   live-change.sh before.sql change.sql             does it
# before.sql selects the rows about to change; they're saved first, so the
# change can be undone. Everything goes in ~/TCK-Backups/live-changes/.
# Schema changes belong in a migration file, so they're refused here.
set -euo pipefail
source "$HOME/TCK-Backups/bin/railway-db.sh"
END=COMMIT
if [ "${1:-}" = "--dry-run" ]; then END=ROLLBACK; shift; fi
BEFORE="${1:-}"; CHANGE="${2:-}"
[ -f "$BEFORE" ] && [ -f "$CHANGE" ] || { echo "Usage: live-change.sh [--dry-run] before.sql change.sql" >&2; exit 2; }
if grep -qiE '\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COMMIT|ROLLBACK|BEGIN|VACUUM|COPY)\b' "$CHANGE"; then
  echo "Refused: only INSERT, UPDATE and DELETE belong in a live change." >&2; exit 2
fi
if grep -qiE '^\s*\\' "$CHANGE"; then echo "Refused: psql commands aren't allowed." >&2; exit 2; fi
STAMP=$(date '+%Y-%m-%d_%H%M%S')
DIR="$HOME/TCK-Backups/live-changes"
PREFIX="$DIR/$STAMP$([ "$END" = ROLLBACK ] && echo -dry-run)"
cp "$CHANGE" "$PREFIX.change.sql"
"$HOME/TCK-Backups/bin/live-read.sh" "$BEFORE" > "$PREFIX.before.csv"
echo "Rows before the change: $(($(wc -l < "$PREFIX.before.csv") - 1)) (saved to $PREFIX.before.csv)"
SQL=$( { echo "BEGIN;"; cat "$CHANGE"; echo; echo "$END;"; } | base64 | tr -d '\n')
on_db "echo $SQL | base64 -d | psql -h /var/run/postgresql -U postgres -d railway -X -v ON_ERROR_STOP=1" | tee "$PREFIX.result.txt"
[ "$END" = ROLLBACK ] && echo "Dry run: nothing was changed."
