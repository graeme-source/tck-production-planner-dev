#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Sync code to GitHub after every merge (non-fatal if connector is unavailable)
pnpm github:sync || echo "[post-merge] GitHub sync skipped (connector unavailable)"
