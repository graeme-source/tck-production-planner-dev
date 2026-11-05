#!/bin/bash
# Shared by backup.sh, live-read.sh and live-change.sh: run a command on the
# live database server over Railway SSH. The database stays closed to the
# internet; the logins used here only work from inside that server.
RAILWAY_PROJECT="f1416c9d-3e93-408d-a350-a5d69283f00e"
RAILWAY_DB_SERVICE="Postgres-lYTL"
PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
on_db() {
  railway ssh --project "$RAILWAY_PROJECT" --environment production --service "$RAILWAY_DB_SERVICE" \
    -i "$HOME/.ssh/id_ed25519" -- "$1"
}
