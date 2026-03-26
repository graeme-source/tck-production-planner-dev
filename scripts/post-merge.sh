#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database migrations are handled automatically at API server startup via runStartupMigrations().
# Do NOT run drizzle-kit push here — it requires interactive confirmation for new tables/enums
# and will time out in the automated post-merge environment.
# Sync code to GitHub after every merge (non-fatal if connector is unavailable)
pnpm github:sync || echo "[post-merge] GitHub sync skipped (connector unavailable)"
