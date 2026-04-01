FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

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

# Expose port and set production mode
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# Run with tsx directly (available from devDependencies)
CMD ["node", "--import", "tsx/esm", "artifacts/api-server/src/index.ts"]
