# 游伴 AI 旅行助手

<p align="center">
  <strong>🤖 基于大语言模型的智能旅行规划助手</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10+-blue?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js&logoColor=white" alt="Vue.js">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License">
</p>

---

## ✨ 功能特性

- 🗺️ **智能行程规划** - 基于 LangGraph 的多 Agent 协作，自动生成个性化旅行计划
- 💬 **对话式交互** - 通过自然语言对话完善行程细节，支持流式响应
- 🌤️ **天气集成** - 实时天气信息展示，帮助合理安排出行
- 📍 **地图可视化** - 支持高德地图和 Google Maps，直观展示行程路线
- 🔖 **行程管理** - 保存、编辑、分享旅行计划，支持历史记录
- 📱 **分享功能** - 生成二维码分享行程，支持图片导出
- 🔐 **后台管理** - 完整的管理后台，支持用户和行程管理
- 🌍 **多语言支持** - 内置国际化支持（中文/英文）

## 🛠️ 技术栈

### 前端

| 技术 | 说明 |
|------|------|
| [Vue 3](https://vuejs.org/) | 渐进式 JavaScript 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全的 JavaScript 超集 |
| [Vite](https://vitejs.dev/) | 下一代前端构建工具 |
| [Ant Design Vue](https://antdv.com/) | 企业级 UI 组件库 |
| [高德地图 JS API](https://lbs.amap.com/) | 国内地图服务 |
| [Google Maps](https://developers.google.com/maps) | 海外地图服务 |

### 后端

| 技术 | 说明 |
|------|------|
| [FastAPI](https://fastapi.tiangolo.com/) | 高性能 Python Web 框架 |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | LLM Agent 编排框架 |
| [LangChain](https://langchain.com/) | LLM 应用开发框架 |
| [Mem0](https://mem0.ai/) | AI 记忆层，持久化用户偏好 |
| [Pydantic](https://docs.pydantic.dev/) | 数据验证和设置管理 |

## 🚀 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- npm 或 pnpm

### 1. 克隆项目

```bash
git clone https://github.com/your-username/youban.git
cd youban
```

### 2. 配置环境变量

复制环境变量示例文件并填写配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下必要参数：

```env
# LLM API 配置（必填）
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_ID=gpt-4

# 高德地图 API（必填，用于国内地图服务）
VITE_AMAP_WEB_JS_KEY=your_amap_web_js_key
VITE_AMAP_WEB_KEY=your_amap_web_key
```

### 3. 启动后端

```bash
cd backend

# 安装 uv 包管理器（如未安装）
pip install uv

# 安装依赖
uv sync

# 启动开发服务器
uvicorn app.api.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:5173 即可使用。

## 🐳 Docker 部署

### 使用 Docker Compose（推荐）

```bash
# 配置环境变量
export LLM_API_KEY=your_api_key
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL_ID=gpt-4
export VITE_AMAP_WEB_JS_KEY=your_key
export VITE_AMAP_WEB_KEY=your_key

# 启动服务
docker-compose up -d
```

访问 http://localhost:7860 即可使用。

### 单独构建 Docker 镜像

```bash
docker build -t youban-trip-planner \
  --build-arg VITE_AMAP_WEB_JS_KEY=your_key \
  --build-arg VITE_AMAP_WEB_KEY=your_key .

docker run -p 7860:7860 \
  -e LLM_API_KEY=your_key \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -e LLM_MODEL_ID=gpt-4 \
  youban-trip-planner
```

## 📁 项目结构

```
youban/
├── frontend/                # 前端项目
│   ├── src/
│   │   ├── components/     # Vue 组件
│   │   ├── views/          # 页面视图
│   │   ├── stores/         # Pinia 状态管理
│   │   ├── services/       # API 服务
│   │   ├── utils/          # 工具函数
│   │   └── i18n/           # 国际化配置
│   └── package.json
├── backend/                 # 后端项目
│   ├── app/
│   │   ├── agents/         # LangGraph Agent
│   │   ├── api/            # FastAPI 路由
│   │   ├── models/         # 数据模型
│   │   ├── services/       # 业务逻辑
│   │   └── config.py       # 配置管理
│   └── pyproject.toml
├── data/                    # 数据存储目录
├── Dockerfile              # 生产环境镜像
├── Dockerfile.dev          # 开发环境镜像
├── docker-compose.yaml     # 生产环境编排
├── docker-compose.dev.yaml # 开发环境编排
└── start.sh                # 启动脚本
```

## ⚙️ 配置说明

### LLM 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `LLM_API_KEY` | LLM API 密钥 | - |
| `LLM_BASE_URL` | API 基础 URL | `https://api.openai.com/v1` |
| `LLM_MODEL_ID` | 模型 ID | `gpt-4` |

### 地图配置

| 环境变量 | 说明 |
|---------|------|
| `VITE_AMAP_WEB_JS_KEY` | 高德地图 Web JS API Key |
| `VITE_AMAP_WEB_KEY` | 高德地图 Web 服务 Key |
| `GOOGLE_MAPS_API_KEY` | Google Maps API Key（可选） |

### 服务配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `7860` |
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `DATA_DIR` | 数据存储目录 | `./data` |

## 📖 API 文档

启动后端服务后，访问以下地址查看 API 文档：

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 开源协议

本项目基于 [Apache License 2.0](LICENSE) 开源。

---

<p align="center">
  Made with ❤️ by YouBan Team
</p>
