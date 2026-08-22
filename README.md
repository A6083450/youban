# 游伴 AI 旅行助手

<p align="center">
  <img src="frontend/public/favicon.svg" alt="游伴 Logo" width="120">
</p>

<p align="center">
  <strong>🤖 基于大语言模型的智能旅行规划助手</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-1.4-black?logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/Vue.js-3-4FC08D?logo=vue.js&logoColor=white" alt="Vue.js">
  <img src="https://img.shields.io/badge/Elysia-1.4-7C3AED" alt="Elysia">
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License">
</p>

<p align="center">
  <a href="#-功能特性">功能特性</a> •
  <a href="#-应用展示">应用展示</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-技术架构">技术架构</a> •
  <a href="#-部署指南">部署指南</a>
</p>

---

## 📖 项目简介

**游伴** 是一款基于 AI 的智能旅行规划助手，通过自然语言对话帮助用户轻松规划完美旅程。只需告诉游伴你的旅行需求，AI 就会自动生成包含景点、美食、住宿、交通的详细行程，并在地图上直观展示路线。

### 🎯 核心亮点

| 特性 | 描述 |
|------|------|
| 🧠 **AI 智能规划** | Pi SDK 与 `pi-subagents` 真实子 Agent 协作，确定性编排守住状态和权限边界 |
| 💬 **自然语言交互** | 像聊天一样描述行程，AI 实时响应调整 |
| 🧭 **旅行蓝图** | 按阶段呈现路线主题、规划逻辑、节奏与代表体验 |
| 🗓️ **自适应日程** | 按行程长度自动选择日/周/月分组，完整展示每日时间线 |
| 🗺️ **地图可视化** | 高德/Google Maps 双引擎，行程路线一目了然 |
| 🌤️ **天气智能** | 实时天气集成，自动优化行程安排 |
| 📱 **安全分享** | 显式发布高熵分享码，支持只读链接、二维码与图片导出 |
| 🔐 **数据安全** | 本地部署，数据完全掌控 |

---

## 🆕 本次更新

- **规划首页**：进行中旅程可以直接回到今日行程。
- **今日行程**：按实际执行进度打卡、跳过并查看当天回响。
- **行程总览**：旅行蓝图、路线脉络和代表体验集中展示。
- **出行衔接**：每日地点支持一键导航，完整行程可导出为日历文件。
- **生成体验**：使用当前品牌化加载状态，并保留任务恢复与失败重试能力。

---

## 🖼️ 应用展示

### PC 端

#### 1. 开始使用 - 昵称登录，无需密码

<p align="center">
  <img src="imgs/pc/login.png" alt="开始使用" width="800">
</p>

#### 2. 规划首页 - 描述旅程，继续进行中的行程

<p align="center">
  <img src="imgs/pc/planning-home.png" alt="规划首页" width="800">
</p>

#### 3. 对话确认 - 游伴理解需求并与你确认

<p align="center">
  <img src="imgs/pc/requirements-confirmation.png" alt="对话确认" width="800">
</p>

#### 4. 生成行程 - 清晰展示当前规划进度

<p align="center">
  <img src="imgs/pc/generation-progress.png" alt="生成行程" width="800">
</p>

#### 5. 行程总览 - 从旅行蓝图把握整段旅程

<p align="center">
  <img src="imgs/pc/trip-overview.png" alt="行程总览" width="800">
</p>

#### 6. 详细日程 - 查看安排、发起导航并加入日历

<p align="center">
  <img src="imgs/pc/daily-itinerary.png" alt="详细日程" width="800">
</p>

---

### 移动端

<p align="center">
  <img src="imgs/mobile/planning-home.png" alt="随时开始规划" width="200">
  &nbsp;&nbsp;
  <img src="imgs/mobile/planning-progress.png" alt="查看规划进度" width="200">
  &nbsp;&nbsp;
  <img src="imgs/mobile/today-trip.png" alt="跟随今日行程" width="200">
  &nbsp;&nbsp;
  <img src="imgs/mobile/trip-details-share.png" alt="查看并分享完整计划" width="200">
</p>

---

## ✨ 功能特性

### 🗺️ 智能行程规划
- **多日行程自动生成** - 根据目的地和天数自动规划
- **景点智能推荐** - 基于用户偏好推荐景点
- **路线优化** - 自动计算最优游览顺序
- **多城市支持** - 支持跨城市行程规划
- **旅行蓝图** - 展示阶段主题、路线逻辑、节奏与代表体验
- **自适应日程** - 按日/周/月组织长短不同行程，所有日期保持完整展开
- **参考时间线** - 统一展示城际移动、景点起止时间和用餐时间，不冒充实时班次或预约结果

### 💬 对话式交互
- **自然语言理解** - 用日常语言描述需求
- **实时流式响应** - 边生成边展示，体验流畅
- **上下文记忆** - 记住用户偏好和历史对话
- **行程调整** - 随时通过对话修改行程

### 🌤️ 天气集成
- **实时天气** - 展示目的地天气预报
- **智能建议** - 根据天气调整行程安排
- **穿衣提示** - 提供出行穿衣建议

### 📍 地图可视化
- **双地图引擎** - 高德地图（国内）+ Google Maps（海外）
- **路线展示** - 直观展示行程路线
- **POI 搜索** - 景点、餐厅、酒店搜索
- **距离计算** - 自动计算景点间距离和交通时间

### 💰 可审计预算
- **人均与合计切换** - 预算台账统一保存合计金额，页面可随时切换人均口径
- **酒店预算边界** - 只接受可信上游明确提供的金额，不由 LLM 推测酒店价格
- **真实来源降级** - 保留高德可信酒店 POI；没有报价时金额显示待填写
- **用户 DIY** - 用户可新增、修改、删除和恢复预算条目，手动价格优先于自动同步

### 🔖 行程管理
- **历史记录** - 保存所有行程规划
- **行程编辑** - 随时修改已规划行程
- **收藏功能** - 收藏喜欢的行程
- **导出功能** - 导出行程为图片
- **一键导航** - 从每日地点直接发起导航
- **日历导出** - 将完整行程加入日历
- **今日反馈** - 记录打卡和跳过后的当天回响

### 📱 分享功能
- **显式发布** - 仅计划拥有者可以为已完成行程创建分享码
- **安全分享码** - 使用 32 位高熵随机码，不直接公开内部计划编号
- **只读分享页** - 访客只能读取最终行程，不能修改预算或发起对话
- **链接与二维码** - 支持复制分享链接、分享码和下载二维码

### 🔐 后台管理
- **用户管理** - 查看和管理用户
- **行程管理** - 管理所有行程数据
- **系统配置** - 运行时配置调整
- **数据统计** - 用户和行程统计

---

## 🛠️ 技术架构

### 前端技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| [Vue 3](https://vuejs.org/) | 3.5+ | 渐进式 JavaScript 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 5.7+ | 类型安全的 JavaScript 超集 |
| [Vite](https://vitejs.dev/) | 6.0+ | 下一代前端构建工具 |
| [Ant Design Vue](https://antdv.com/) | 4.2+ | 企业级 UI 组件库 |
| [Vue Router](https://router.vuejs.org/) | 4.5+ | 官方路由管理器 |
| [Pinia](https://pinia.vuejs.org/) | - | 状态管理库 |
| [Axios](https://axios-http.com/) | 1.7+ | HTTP 客户端 |
| [高德地图 JS API](https://lbs.amap.com/) | - | 国内地图服务 |
| [Google Maps](https://developers.google.com/maps) | - | 海外地图服务 |
| [vue-i18n](https://vue-i18n.intlify.dev/) | 9.14+ | 国际化插件 |
| [Playwright](https://playwright.dev/) | 1.62+ | 端到端与响应式布局测试 |

### 后端技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| [Bun](https://bun.sh/) | 1.4 | TypeScript 运行时、测试、SQLite 与性能分析 |
| [Elysia](https://elysiajs.com/) | 1.4+ | Bun 原生 HTTP、SSE、WebSocket 与 TypeBox 校验 |
| [Pi SDK](https://github.com/badlogic/pi-mono) | 0.84.2 | 模型、Agent 会话与扩展宿主 |
| `pi-subagents` | 0.53.0 | 真实子 Agent、结构化输出、并行与取消 |
| `pi-hermes-memory` | 0.9.6 | 用户偏好记忆与隔离存储 |
| [Drizzle ORM](https://orm.drizzle.team/) | 0.45+ | `bun:sqlite` 类型安全持久化 |

酒店和景点链路只使用高德可信 POI。Agent 只能选择服务端分配的候选 ID；身份、坐标和价格不能由 LLM 生成，没有真实报价时保留待填写状态。

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    前端 (Vue 3 + Vite)                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ 对话界面 │  │ 行程展示 │  │ 地图组件 │  │ 管理后台 │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP/WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 后端 (Bun 1.4 + Elysia)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    API 路由层                        │   │
│  │  /api/trip  /api/chat  /api/poi  /api/map  /admin  │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  服务层 (Services)                    │   │
│  │  LLM 服务 │ 地图服务 │ 天气服务 │ 记忆服务 │ 用户服务│   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            Pi Agent + 确定性编排层                    │   │
│  │  持久父 Agent │ pi-subagents │ 分段规划与检查点       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ LLM API  │   │ 地图 API │   │ 数据存储  │
    │ (OpenAI) │   │ (高德/   │   │ (SQLite)  │
    │          │   │ Google)  │   │          │
    └──────────┘   └──────────┘   └──────────┘
```

---

## 🚀 快速开始

### 环境要求

- Bun 1.4+
- LLM API Key（OpenAI 或兼容 API）
- 高德地图 API Key（可选，国内地图服务）

### 1. 克隆项目

```bash
git clone https://github.com/A6083450/youban.git
cd youban
```

### 2. 配置环境变量

复制环境变量示例文件并填写配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下必要参数：

```env
# LLM API 配置（必填；LLM_* 别名仍兼容）
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4

# 高德地图 API（必填，用于国内地图服务）
VITE_AMAP_WEB_JS_KEY=your_amap_web_js_key
VITE_AMAP_WEB_KEY=your_amap_web_key
```

### 3. 启动后端

```bash
cd backend-ts
bun install --frozen-lockfile
bun run dev
```

### 4. 启动前端

```bash
cd frontend

# 安装依赖
bun install --frozen-lockfile

# 启动开发服务器
bun run dev
```

访问 http://localhost:5173 即可使用。

### 5. 运行验证

```bash
# 后端模型、真实子 Agent、HTTP/WS 与迁移回归测试
cd backend-ts
bun run test
bun run typecheck
bun run audit:python-tests

# 前端类型检查、构建、工具测试与端到端测试
cd ../frontend
bun run test
bun run build
bun run test:e2e
```

---

## 🐳 Docker 部署

TypeScript 镜像使用并行保留的 `Dockerfile.ts`；本地开发和测试直接运行 Bun，无需容器。

```bash
docker build -f Dockerfile.ts -t youban-trip-planner-ts \
  --build-arg VITE_AMAP_WEB_JS_KEY=your_key \
  --build-arg VITE_AMAP_WEB_KEY=your_key .

docker run -p 7860:7860 \
  -e OPENAI_API_KEY=your_key \
  -e OPENAI_BASE_URL=https://api.openai.com/v1 \
  -e OPENAI_MODEL=gpt-4 \
  -v "$PWD/data:/app/data" \
  youban-trip-planner-ts
```

---

## 📁 项目结构

```
youban/
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── components/         # Vue 组件
│   │   │   ├── PlanChatPanel.vue      # 聊天面板
│   │   │   ├── TripFlow.vue           # 旅行蓝图
│   │   │   ├── DailyItinerary.vue     # 自适应每日行程
│   │   │   ├── ShareCodeEntry.vue     # 分享码输入
│   │   │   ├── WeatherDayCard.vue     # 天气卡片
│   │   │   ├── SharePlanModal.vue     # 分享弹窗
│   │   │   └── ...
│   │   ├── views/              # 页面视图
│   │   │   ├── ChatHome.vue           # 主聊天界面
│   │   │   ├── Result.vue             # 行程结果页
│   │   │   ├── ShareView.vue          # 只读分享页
│   │   │   ├── AdminView.vue          # 管理后台
│   │   │   └── LoginView.vue          # 登录页
│   │   ├── stores/             # Pinia 状态管理
│   │   ├── services/           # API 服务
│   │   ├── utils/              # 工具函数
│   │   └── i18n/               # 国际化配置
│   └── package.json
├── backend-ts/                  # Bun 1.4 / Elysia 后端
│   ├── src/
│   │   ├── agents/             # Pi 父 Agent、真实子 Agent 与白名单 Skills
│   │   ├── config/             # 环境变量与原子运行时配置
│   │   ├── domain/             # SQLite、任务状态和确定性业务规则
│   │   ├── http/               # Elysia HTTP、SSE、WebSocket 与 SPA 托管
│   │   ├── runtime/            # 内存压力与优雅关停
│   │   └── services/           # 高德与 Hermes 适配层
│   ├── scripts/                # JSON/SQLite 迁移、回滚导出、基准与冒烟
│   ├── tests/                  # Bun 单元、契约和真实 Pi 插件测试
│   └── package.json
├── backend/                     # Python 旧后端，切换观察期内仅作回滚参考
├── data/                        # 数据存储目录
│   ├── conversations/          # 对话历史
│   ├── images/                 # 图片缓存
│   ├── memory/                 # 用户记忆
│   └── users.json              # 用户数据
├── imgs/                        # 截图资源
│   ├── pc/                     # PC 端截图
│   └── mobile/                 # 移动端截图
├── Dockerfile.ts               # Bun/TypeScript 候选生产镜像
└── Dockerfile                  # Python 回滚镜像（观察期保留）
```

---

## ⚙️ 配置说明

### LLM 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `OPENAI_API_KEY` | LLM API 密钥；兼容 `LLM_API_KEY` | - |
| `OPENAI_BASE_URL` | API 基础 URL；兼容 `LLM_BASE_URL` | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型 ID；兼容 `LLM_MODEL_ID` | `gpt-4` |
| `LLM_API_STYLE` | Pi 模型 API 风格 | `responses` |

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

---

## 📖 API 文档

启动后端服务后，访问以下地址查看 API 文档：

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### 主要 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/trip/plan` | POST | 生成行程规划 |
| `/api/trip/parse/stream` | POST | 流式理解旅行需求 |
| `/api/trip/ws/{task_id}` | WebSocket | 订阅规划进度和最终结果 |
| `/api/trip/share/{task_id}` | POST | 计划拥有者生成或复用分享码 |
| `/api/trip/share/{share_code}` | GET | 凭分享码读取只读最终行程 |
| `/api/chat/ask` | POST | 针对已有计划问答 |
| `/api/chat/edit/stream` | POST | 流式修改已有计划 |
| `/api/poi/search` | GET | POI 搜索 |
| `/api/admin/settings` | GET/PUT | 管理员运行时配置 |

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 开发规范

- 前端代码遵循 Vue 3 Composition API 规范
- 后端代码遵循 TypeScript 严格类型和 Bun 测试约束
- 提交信息遵循 Conventional Commits

---

## 📄 开源协议

本项目基于 [Apache License 2.0](LICENSE) 开源。

---

<p align="center">
  <strong>游伴</strong> - 让每一次旅行都成为美好回忆 ✈️
</p>

<p align="center">
  Made with ❤️ by YouBan Team
</p>
