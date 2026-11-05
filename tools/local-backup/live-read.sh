#!/bin/bash
# Run a SQL file against LIVE, read only. Logs in as claude_read, which the
# database itself stops from changing anything.
#   live-read.sh query.sql
set -euo pipefail
source "$HOME/TCK-Backups/bin/railway-db.sh"
[ -f "${1:-}" ] || { echo "Usage: live-read.sh query.sql" >&2; exit 2; }
SQL=$(base64 < "$1" | tr -d '\n')
on_db "echo $SQL | base64 -d | psql -h /var/run/postgresql -U claude_read -d railway -X -q -v ON_ERROR_STOP=1 --csv"
