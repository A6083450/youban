#!/bin/bash
set -e

BIND_PORT=${PORT:-7860}

echo "启动游伴开发环境"
echo "后端地址: http://0.0.0.0:${BIND_PORT}"
echo "前端地址: http://0.0.0.0:9000"

cd /app/frontend
VITE_SERVER_BASEURL="http://localhost:${BIND_PORT}" pnpm dev:h5 --host 0.0.0.0 &

cd /app/backend
exec bun run dev
