FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Run the Node process in UTC so `new Date()` / `.toISOString()` always emit
# UTC instants. The Postgres session is also pinned to UTC in lib/db/src/index.ts.
# Frontend code auto-localises to the iPad's timezone, which handles BST <-> GMT.
ENV TZ=UTC

# Copy workspace config and lockfile first for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY lib/ lib/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/production-planner/package.json artifacts/production-planner/

# Install ALL dependencies (including dev, needed for tsx and build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY artifacts/api-server/ artifacts/api-server/
COPY artifacts/production-planner/ artifacts/production-planner/
COPY attached_assets/ attached_assets/

# Build frontend
ENV PORT=5173
ENV BASE_PATH=/
RUN cd artifacts/production-planner && pnpm run build

# Copy .git so the System Updates morning-meeting slide can run
# `git log` at runtime. Placed late so commit-only changes don't
# invalidate the pnpm install / frontend build cache layers above.
# Also install git itself — node:22-slim doesn't include it.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY .git ./.git

# Expose port and set production mode
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# Run from the api-server directory where tsx is available
WORKDIR /app/artifacts/api-server
CMD ["pnpm", "run", "start"]
