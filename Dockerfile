ARG NODE_IMAGE_PREFIX=docker.m.daocloud.io/library
ARG BUN_IMAGE_PREFIX=docker.m.daocloud.io/oven
FROM ${NODE_IMAGE_PREFIX}/node:20-slim AS frontend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
COPY shared/contracts ./shared/contracts
WORKDIR /app/shared/contracts
RUN pnpm install --frozen-lockfile --ignore-scripts
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/
WORKDIR /app/frontend
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY frontend/ ./
ENV CI=true \
    SKIP_OPEN_DEVTOOLS=true \
    VITE_API_BASE_URL="" \
    VITE_SERVER_BASEURL=""
RUN pnpm build:h5

FROM ${BUN_IMAGE_PREFIX}/bun:1.4 AS backend-builder
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY shared/contracts ./shared/contracts
WORKDIR /app/shared/contracts
RUN bun install --production
WORKDIR /app
COPY backend/package.json backend/bun.lock ./backend/
WORKDIR /app/backend
RUN bun install --frozen-lockfile
COPY backend/ ./
WORKDIR /app
COPY Dockerfile Dockerfile.dev Dockerfile.ts docker-compose.dev.yaml start-dev.sh .dockerignore ./
COPY --from=frontend-builder /app/frontend/dist/build/h5 ./frontend/dist/build/h5
WORKDIR /app/backend
RUN bun run typecheck \
    && bun test \
    && bun -e "await import('@earendil-works/pi-coding-agent'); await import('pi-subagents')" \
    && bun install --frozen-lockfile --production \
    && rm -rf node_modules/@youban/contracts \
    && cp -R /app/shared/contracts node_modules/@youban/contracts \
    && rm -rf node_modules/@youban/contracts/node_modules

FROM ${BUN_IMAGE_PREFIX}/bun:1.4-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=7860
COPY --from=backend-builder /app/backend/package.json /app/backend/bun.lock ./backend/
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/src ./backend/src
COPY --from=backend-builder /app/backend/scripts ./backend/scripts
COPY --from=backend-builder /app/shared/contracts ./shared/contracts
COPY --from=frontend-builder /app/frontend/dist/build/h5 ./frontend/dist/build/h5
RUN mkdir -p /app/data
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:7860/health'); if(!r.ok) process.exit(1)"]
CMD ["bun", "run", "backend/src/index.ts"]
