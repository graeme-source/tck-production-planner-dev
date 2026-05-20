# Postgres recovery from a corrupted Railway volume

Built after the live Postgres died on 2026-05-20 and no off-Railway
backups existed. The original `postgres-volume` was intact, but the
managed Postgres container's entrypoint was missing (`catatonit:
failed to exec pid1`). Several auto-attempts via the Railway agent
failed because they (a) mixed Postgres major versions (17 vs 18) and
(b) never surfaced the postmaster's startup log.

## What this does

Image: `postgres:18-bookworm` — same major version as the corrupt data.

Script (`recover.sh`):
1. Inventory the mounted source at `/mnt/old-data/pgdata`
2. Copy it to a writable working directory (the source volume is left
   untouched in case we need to try again)
3. Run `pg_controldata` to check cluster metadata
4. Try to start Postgres as-is on port 5433
5. If that fails, run `pg_resetwal -f` and try again
6. If that fails, retry with `zero_damaged_pages=on` and
   `ignore_system_indexes=on`
7. If we got it up, `pg_dumpall` to `/tmp/recovered.sql`
8. Sleep 24h so the dump can be retrieved via Railway shell
9. If every start attempt failed, also sleep 24h so the container can
   be poked at with `pg_filedump`

It deliberately does **not** auto-restore into the live database, since
the kitchen is using it. A human reviews the dump and runs the restore
manually.

## Deploying to Railway

1. Make sure the `postgres-recovery` service has the **old**
   `postgres-volume` mounted at `/mnt/old-data` (Railway agent already
   set this up).
2. In the service Settings, point Source → Repository at this repo's
   `tools/postgres-recovery` directory. Set the Dockerfile path to
   `tools/postgres-recovery/Dockerfile`.
3. Set env `DATABASE_URL` to the Postgres-lYTL connection URL (the
   agent already set this).
4. Deploy. Watch the logs.

## Reading the logs

Each phase prints a `========== HEADER ==========` banner. The
critical bit is the postmaster log — that's what previous attempts
never showed and is the actual reason a start fails.
