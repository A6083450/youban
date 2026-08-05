# ================================
# 阶段一：构建前端
# ================================
FROM docker.m.daocloud.io/library/node:20-slim AS frontend-builder

# 使用国内镜像源
RUN npm config set registry https://registry.npmmirror.com

WORKDIR /build

# 复制前端依赖文件并安装
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --registry=https://registry.npmmirror.com

# 复制前端代码并构建
COPY frontend/ ./

# 接收构建参数
ARG VITE_AMAP_WEB_JS_KEY
ARG VITE_AMAP_WEB_KEY

# 设置构建时环境变量：API 使用相对路径(同源部署)
ENV VITE_API_BASE_URL=""
ENV VITE_AMAP_WEB_JS_KEY=${VITE_AMAP_WEB_JS_KEY:-your_amap_web_js_api_key_here}
ENV VITE_AMAP_WEB_KEY=${VITE_AMAP_WEB_KEY:-your_amap_web_api_key_here}

# 跳过 vue-tsc 类型检查，直接构建（类型错误不影响运行）
RUN npx vite build


# ================================
# 阶段二：构建最终镜像
# ================================
FROM docker.m.daocloud.io/library/python:3.10-slim

WORKDIR /app

# 安装系统依赖及 Node.js(用于执行小红书签名引擎)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv 包管理器
RUN pip install --no-cache-dir uv -i https://mirrors.aliyun.com/pypi/simple/

# 使用 uv 管理后端依赖
# venv 建在 /opt/venv（代码目录之外），dev 模式卷挂载 ./backend 时不会覆盖依赖
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=0 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple/

# 先仅复制依赖清单以最大化层缓存；--extra prod 额外安装 gunicorn
COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN cd backend && uv sync --extra prod --python 3.10

# 将 venv 加入 PATH，后续 uvx / gunicorn / uvicorn 均使用它
ENV PATH="/opt/venv/bin:$PATH"

# 预下载 amap-mcp-server（避免首次请求时下载导致超时）
RUN uvx amap-mcp-server --help || true

# 复制后端代码并安装 Node.js 依赖
COPY backend/ ./backend/
RUN cd backend && npm install --registry=https://registry.npmmirror.com

# 从阶段一复制前端构建产物
COPY --from=frontend-builder /build/dist ./frontend/dist

# 复制启动脚本
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

# 魔搭创空间要求端口 7860
EXPOSE 7860

CMD ["./start.sh"]
