#!/bin/bash
set -e

cd /app

BIND_PORT=${PORT:-7860}

echo "🚀 启动游伴 [开发模式]..."
echo "   后端地址: http://0.0.0.0:${BIND_PORT}"
echo "   前端地址: http://0.0.0.0:5173"

# 后台启动前端 Vite dev server（带 HMR）
# VITE_DEV_PROXY_TARGET 让 vite 代理 /api 请求到后端
cd /app/frontend
VITE_DEV_PROXY_TARGET="http://localhost:${BIND_PORT}" \
  VITE_AMAP_WEB_JS_KEY="${VITE_AMAP_WEB_JS_KEY:-}" \
  VITE_AMAP_WEB_KEY="${VITE_AMAP_WEB_KEY:-}" \
  npx vite --host 0.0.0.0 --port 5173 &
FRONTEND_PID=$!

cd /app

# 前台启动后端 uvicorn（--reload 监听代码变化自动重启）
exec uvicorn backend.app.api.main:app \
  --host 0.0.0.0 \
  --port ${BIND_PORT} \
  --reload \
  --reload-dir /app/backend \
  --log-level info
