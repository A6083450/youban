#!/bin/bash

cd /app

BIND_PORT=${PORT:-7860}

echo "🚀 启动游伴 AI 旅行助手..."
echo "   绑定的地址: [::]:${BIND_PORT} (双栈，支持IPv4+IPv6)"
echo "   工作目录: $(pwd)"

exec gunicorn backend.app.api.main:app \
  --bind [::]:${BIND_PORT} \
  --workers 1 \
  --worker-class uvicorn.workers.UvicornWorker \
  --timeout 600 \
  --access-logfile - \
  --error-logfile -
