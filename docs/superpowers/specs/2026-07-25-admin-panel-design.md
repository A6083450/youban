# 后台管理页面设计（配置迁移 + 文件密码校验）

日期：2026-07-25
分支：feat/youban-chat-redesign

## 需求（来自用户原话）

1. 增加一个后台页面，进入密码为 `admin@123`
2. 把密码写到 /data 目录下，Docker 部署时可映射出来
3. 每次登录后台都校验这个文件里的密码，明文即可
4. 将左下角的配置（侧边栏齿轮按钮 + 设置弹窗）放到后台配置里

## 自主决策记录（后台会话无法逐题确认）

- 密码文件路径：`get_data_dir()/admin_password.txt`。`get_data_dir()` 优先读 `DATA_DIR` 环境变量（Docker 中为 `/app/data`，compose 已映射 `./data:/app/data`），本地开发落在项目根 `./data/`。文件不存在时后端自动创建并写入默认密码 `admin@123`，运维改文件即时生效。
- 鉴权方式（方案比较）：
  - A. 登录发临时 token 存内存 —— 重启失效、多 worker 不共享，复杂度高；
  - B.（选定）登录接口校验文件密码；登录后前端把密码存 sessionStorage，后续管理请求带 `X-Admin-Token` 头，后端**每次请求都重读文件比对**。无状态、最简单、密码改动即时生效，完全符合“每次登录都校验文件密码、明文即可”的要求；
  - C. HTTP Basic —— 浏览器原生弹窗无法 i18n、体验差。
- 公开 `GET /api/settings` 不能删除：Result.vue 用它拉取高德 REST Key / Google Maps Key 绘制路线。改为**只返回地图相关字段**（amap web/js key、google key/proxy），LLM Key、小红书 Cookie 等敏感项只能通过带密码头的管理接口读取；公开 `PUT /api/settings` 移除（否则密码保护形同虚设）。
- `/admin` 不在侧边栏放入口（后台页面按惯例走直链），并且该路由下隐藏侧边栏/移动端顶栏，呈现独立后台页。
- 明文密码、明文传输是用户明确要求（内部工具级别），不做 hash / HTTPS 强制。

## 后端改动

- 新增 `backend/app/api/routes/admin.py`：
  - `read_admin_password()`：读/自动创建密码文件；
  - `POST /api/admin/login`：body `{password}`，与文件明文比对；
  - `GET /api/admin/settings`（需 `X-Admin-Token`）：返回完整运行时配置；
  - `PUT /api/admin/settings`（需 `X-Admin-Token`）：保存配置并重置 LLM/地图/Agent 单例（沿用原 settings.py PUT 逻辑）。
- `backend/app/config.py`：新增 `get_public_runtime_settings()`（地图字段子集）。
- `backend/app/api/routes/settings.py`：公开 GET 改用子集；删除公开 PUT。
- `backend/app/api/main.py`：注册 admin 路由；startup 时确保密码文件存在并打印路径。

## 前端改动

- 新增 `frontend/src/views/AdminView.vue`：未登录显示密码卡片；登录成功显示配置表单（字段与原弹窗一致：后端地址、高德 JS Key、高德 Web Key、OpenAI Base URL / Model / API Key）+ 退出登录。密码存 sessionStorage（关标签页即失效）。
- `frontend/src/main.ts`：注册 `/admin` 路由。
- `frontend/src/App.vue`：移除侧边栏齿轮按钮、设置弹窗与相关脚本；`/admin` 路由下隐藏侧边栏与移动端顶栏。
- `frontend/src/services/api.ts`：新增 `adminLogin` / `getAdminRuntimeSettings` / `saveAdminRuntimeSettings`（带 `X-Admin-Token`；保存后保留原副作用：localStorage 地图 Key 同步 + `RUNTIME_SETTINGS_UPDATED_EVENT`）；移除旧 `getRuntimeSettings` / `saveRuntimeSettings` / `updateBackendRuntimeSettings`（唯一消费方是被移除的弹窗）。
- i18n（zh/ja/en）：新增 `admin.*` 键；表单标签复用 `settings.labels.*`。

## 数据 / 部署

- 本仓库 `./data/admin_password.txt` 写入 `admin@123`（`data/` 已 gitignore，不入库；容器内自动创建兜底）。
- docker-compose 无需改动（已有 `./data:/app/data` 与 `DATA_DIR=/app/data`）。

## 验证计划

- 后端：启动 uvicorn，curl 验证 login 正/误密码、无头/带头访问管理接口、公开接口只含地图字段。
- 前端:`npx vite build` 通过；浏览器走一遍 /admin 登录 → 读配置 → 保存。
