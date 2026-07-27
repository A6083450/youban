# 游伴 · 聊天式旅行规划重构设计

日期：2026-07-24
状态：已获用户确认

## 背景

TripStar（旅途星辰）是基于 FastAPI + Vue3 的 AI 旅行规划应用。本次重构将项目更名为「游伴」，界面改为 Codex 式聊天布局，数据源从小红书切换为高德，并统一数据落盘到根目录 `data/`。

## 已确认决策

1. 整体布局：单页三区块（左侧计划列表 = 会话记录，中间 = 计划详情 / 新建计划对话）
2. 输入方式：自然语言一句话输入 + LLM 解析 + 确认卡片
3. 图片：高德 POI 图片下载缓存到 `data/images/`
4. 小红书代码：保留文件仅停用（不再被调用）
5. 地图引擎：仅保留高德，停用 Google 双引擎回退
6. 缺少日期/天数：智能默认值（明天出发 / 3 天）+ 确认卡片展示
7. 详情区：保留现有 Result 页全部内容（概览/每日行程/地图/预算/知识图谱/AI 伴游问答）
8. 改名范围：仅显示层（标题、Logo、README），目录/包名/容器名不动

## 1. 整体布局（Codex 式单页三区块）

```
┌────────────┬──────────────────────────────────┐
│  游伴 Logo  │  计划详情（选中计划时）              │
│  + 新建计划  │  - 概览/每日行程/地图/预算/知识图谱  │
│            │     （复用现有 Result 页内容）        │
│  计划列表    │                                  │
│  · 西安3日游 │  或：新建计划对话（未选中时）         │
│  · 北京5日游 │  - 底部聊天输入框（一句话描述旅行）    │
│  · ...      │  - AI 确认卡片（解析出的城市/日期/偏好）│
│            │  - 生成进度（实时进度条+阶段文案）      │
│  ⚙ 设置     │                                  │
└────────────┴──────────────────────────────────┘
```

- 左侧栏：历史计划列表（`/api/trip/history`，limit 提升到 50），含进行中/失败状态标记，点击切换中间内容
- 中间区：复用现有 Result.vue 的全部详情组件，路由跳转改为组件切换
- 路由简化为 `/`（聊天主页）+ `/plan/:id`（同一布局选中计划），删除 Landing 页
- 导航栏简化，去掉 GitHub 链接
- AI 伴游问答（AIChat 悬浮窗）保留在计划详情视图

## 2. 自然语言一句话输入

- 底部聊天输入框，如「下周末去西安玩 3 天，喜欢美食和历史文化」
- 新增 `POST /api/trip/parse`：LLM 解析为结构化 TripRequest
  - 未提日期 → 默认明天出发；未提天数 → 默认 3 天；相对日期（下周末等）解析为具体日期
  - 返回解析结果 + confidence
- 前端展示确认卡片（可点选修改城市/日期/偏好 chips），点「生成计划」走现有 `/trip/plan` 流程
- 缺关键信息（无城市）→ AI 对话内追问，不直接生成
- 对话记录与计划关联，存入 `data/conversations/`

## 3. 数据源：小红书 → 高德

- `xhs_service.py`、`xhs_sign/` 保留但停用；设置页隐藏 XHS_COOKIE 项
- 新增 `search_amap_attractions(city, keywords, lang)`：
  - 调高德 `v5/place/text`（types=旅游景点，show_fields 含 photos）
  - POI 名称/地址/坐标/评分交给 LLM 提纯为现有 schema 兼容的景点 JSON（name/name_zh/name_en、duration、reservation_required/tips 推断）
  - 在 `trip_planner_agent.py` 中替代 `search_xhs_attractions`
- 图片：`/poi/photo` 只走高德 `get_poi_photo`，下载到 `data/images/`（文件名 = hash(name+city)），命中缓存直接返回 `/api/images/<file>` 静态服务
- 地图引擎仅保留高德：`map_dispatcher` 停用 google 分支，`google_map_service.py` 保留但停用，前端地图组件只渲染高德

## 4. data 目录与 Docker

- 项目根新增 `data/`：
  - `data/trip_tasks/`：计划 JSON（从 `backend/data` 迁移）
  - `data/images/`：景点图片缓存
  - `data/conversations/`：新建计划对话记录
- 后端 data 路径统一为可配置 `DATA_DIR`（默认项目根 `./data`）
- `docker-compose.yaml`：卷映射改为 `./data:/app/data`，移除 `XHS_COOKIE` 环境变量；dev compose 同步
- `.gitignore` 增加 `data/`

## 5. 改名「游伴」与界面清理（仅显示层）

- 浏览器标题、导航 Logo、README 主标题改为「游伴」
- 去掉主界面所有 GitHub 链接（NavBar、Result、global.css）
- 视觉：现有暖色系基础上调整为 Codex 式简洁聊天风（左侧素净栏、中间白底、圆角大输入框）
- i18n（中/英/日）保留，新增文案补全三语言

## 涉及文件

后端：
- `backend/app/agents/trip_planner_agent.py`（换用高德景点搜索）
- `backend/app/services/amap_service.py`（新增景点搜索/图片下载）
- `backend/app/api/routes/trip.py`（新增 /parse 接口、DATA_DIR、对话持久化）
- `backend/app/api/routes/poi.py`（图片缓存服务）
- `backend/app/api/routes/settings.py`（隐藏 XHS 项）
- `backend/app/api/main.py`（静态挂载 /api/images）
- `backend/app/config.py`（DATA_DIR 配置）
- `backend/app/services/map_dispatcher.py`（停用 google 分支）

前端：
- `frontend/src/App.vue`、`main.ts`（路由/布局）
- 新增 `components/PlanSidebar.vue`、`components/PlanComposer.vue`（聊天输入+确认卡片）
- `views/Home.vue` → 重写为聊天主页；`views/Result.vue` 改为嵌入组件
- `components/NavBar.vue`（简化、去 GitHub）
- `i18n/locales/{zh,en,ja}.json`（新文案）
- `types/index.ts`、`services/api.ts`（parse 接口）

配置：
- `docker-compose.yaml`、`docker-compose.dev.yaml`、`.gitignore`、`README.md`

## 错误处理

- 高德 Key 未配置：/parse 与景点搜索返回明确错误文案，前端确认卡片提示去设置页配置
- LLM 解析失败：降级为把整句当作 free_text_input + 默认参数
- 图片下载失败：返回空 URL，前端用占位图
- 服务重启：沿用现有「处理中任务标记失败」逻辑

## 测试

- 后端：手动验证 /parse、/plan、/poi/photo、/history 全链路；高德 key 缺失时的降级路径
- 前端：`vite build` 通过；浏览器手动验证侧边栏切换、一句话生成、确认卡片、图片缓存
