# check=skip=SecretsUsedInArgOrEnv
# VITE_AMAP_* values are browser-visible public keys embedded by Vite.
ARG BUN_IMAGE_PREFIX=oven
FROM ${BUN_IMAGE_PREFIX}/bun:1.4 AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
ARG VITE_AMAP_WEB_JS_KEY=""
ARG VITE_AMAP_WEB_KEY=""
ENV VITE_API_BASE_URL="" \
    VITE_AMAP_WEB_JS_KEY=${VITE_AMAP_WEB_JS_KEY} \
    VITE_AMAP_WEB_KEY=${VITE_AMAP_WEB_KEY}
RUN bunx vite build

FROM ${BUN_IMAGE_PREFIX}/bun:1.4 AS backend-builder
WORKDIR /app/backend-ts
COPY backend-ts/package.json backend-ts/bun.lock ./
RUN bun install --frozen-lockfile
COPY backend-ts/ ./
RUN bun run typecheck \
    && bun test \
    && bun -e "await import('@earendil-works/pi-coding-agent'); await import('pi-subagents')" \
    && bun install --frozen-lockfile --production

FROM ${BUN_IMAGE_PREFIX}/bun:1.4-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=7860
COPY --from=backend-builder /app/backend-ts/package.json /app/backend-ts/bun.lock ./backend-ts/
COPY --from=backend-builder /app/backend-ts/node_modules ./backend-ts/node_modules
COPY --from=backend-builder /app/backend-ts/src ./backend-ts/src
COPY --from=backend-builder /app/backend-ts/scripts ./backend-ts/scripts
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/data
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "const r=await fetch('http://127.0.0.1:7860/health'); if(!r.ok) process.exit(1)"]
CMD ["bun", "run", "backend-ts/src/index.ts"]
