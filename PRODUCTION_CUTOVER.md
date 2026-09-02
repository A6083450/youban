# Bun + unibest 生产切换与全新微信账号启用

本文用于 `youban.me` 从 `backend.bak/` 的 Python/Uvicorn 与 `frontend.bak/` 的旧 Vue/PWA 前端切换到 `backend/` 的 Bun/Elysia 和 `frontend/` 的统一客户端。默认保留生产业务数据并通过 SQLite 迁移升级；只有用户另行明确批准时才执行本文的数据清理步骤。

## 1. 切换前验收

1. 记录待发布提交、当前 Python 进程或容器、Caddyfile 路径与哈希、生产数据挂载的真实绝对路径。
2. 使用独立空目录在备用端口启动 Bun，确认 SQLite 自动创建为 schema 7。
3. 验证健康检查、微信登录模拟、Bearer/HttpOnly 会话、小程序码创建/确认/单次兑换、SSE、WebSocket、规划恢复、公开分享和头像上传。
4. 确认 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`AUTH_PEPPER` 只存在于服务器密钥环境；`AUTH_PEPPER` 至少 32 字节。网页扫码登录复用现有小程序凭据，不配置网站应用 AppID、AppSecret 或 OAuth 回调。
5. 执行 `pnpm type-check && pnpm lint && pnpm test:run`，分别构建 `build:h5:prod` 与 `build:mp-weixin`；H5 必须使用同源空 API 基址。
6. 从全新浏览器请求验证 `/#/pages/admin/index`，并验证旧 `/plan/:id`、`/share/:code`、`/privacy`、`/admin` 路径以 308 保留查询参数进入对应 hash 页面。

## 2. 精确列出删除范围

先只预览，不删除：

```bash
cd backend
bun run purge:business-data --data-dir=/生产数据绝对路径
```

输出中的 `dataDir` 是规范化后的真实路径。清理器仅处理：

```text
youban.db  youban.db-wal  youban.db-shm  tasks.db  users.json
trip_tasks  conversations  images  avatars  memory  pi-runtime
tool_audit  migration-backups  skills
```

以下运行配置保留：

```text
runtime_settings.json  admin_password.txt
```

Caddy 配置、证书和服务器密钥环境不在数据目录清理范围内。

## 3. 停写并清理

1. 进入维护窗口，停止 Python 服务及所有可能写入该数据目录的任务。
2. 再次核对挂载目标、进程打开文件和清理器预览。
3. 使用上一步输出的规范化路径进行双重确认：

```bash
cd backend
bun run purge:business-data \
  --data-dir=/生产数据真实绝对路径 \
  --execute \
  --confirm-dir=/生产数据真实绝对路径
```

此操作不创建旧业务数据备份，删除后不可通过游伴工具恢复。

## 4. 启动与切流

先上传并真机验证包含 `pages/web-login/index` 的小程序体验版。只有该页面正式发布、且服务端 `check_path=true` 能生成 release 小程序码后，才能切换生产 H5 与后端；禁止先切 H5 再等待小程序审核。

```bash
export YOUBAN_DATA_DIR=/生产数据真实绝对路径
export BUN_CANDIDATE_PORT=7861
docker compose -f docker-compose.bun.yaml up -d --build
cd backend
bun run smoke:deployment --base-url=http://127.0.0.1:7861 --health-only
```

确认新建数据库 `PRAGMA user_version` 为 7、`PRAGMA quick_check` 为 `ok` 后，将 Caddy 上游切到 Bun 端口并 reload。切流后确认 `/sw.js`、`/registerSW.js`、`/manifest.webmanifest` 均返回 404，避免旧 PWA 再次接管页面。

## 5. 真实验收

必须通过以下真实流程：

1. 网站创建五分钟浏览器绑定挑战并展示真实小程序码；微信扫码打开原生确认页，不出现短码、挑战 ID、分享码输入或 WebView。
2. 新用户先主动选择微信头像完成注册，再返回确认页显式点击确认；电脑随后以 HttpOnly 会话进入同一业务账号，重复兑换失败。
3. 小程序完成多轮对话、生成行程、杀进程后按任务恢复。
4. 国内可信坐标可打开原生导航，无可信坐标时保留行程并降级提示。
5. 生成 32 位分享令牌，由第二个微信账号匿名只读打开。
6. 昵称登录、旧账号迁移、伪造 `x-user-id` 和 WebSocket 查询参数身份均不可用。
7. PC 与移动 H5 的首页、登录、行程总览、每日行程、天气、预算、地图、分享、导出和后台页面与切换前基线一致。
8. 微信开发者工具与真机分别验证原生登录、首页、行程、今日、天气、预算、`<map>`、分享、相册和日历；主流程不得打开旧 WebView 页面。

## 7 天观察与旧前端退役

1. 切流时记录 `T0`、发布提交、H5 资源哈希和微信上传版本；`frontend/`、`miniprogram/` 在 `T0 + 7 天` 前只作源码回切参考，不参与任何构建、镜像或上传。
2. 观察期每天核对登录成功率、规划终态、分享读取、静态资源 404、前端异常和小程序版本；发现核心回归时回切提交或镜像，不把生产入口重新指向旧前端目录。
3. `T0 + 7 天` 且上述指标无阻断后，在单独清理提交中删除 `frontend/`、`miniprogram/`、旧 PWA 文件和仅服务旧前端的脚本；删除前再次用 `rg` 确认没有生产引用。
4. Git 历史和切流镜像是回切来源，生产仓库不再长期维护两套前端实现。

## 回切边界

可以把 Caddy 上游切回上一版服务镜像或端口，但旧业务数据已按确认删除，不能回滚。若微信登录、头像、规划、恢复或分享任一核心流程失败，应停止新写入、回切上游并修复代码；不得重新引入昵称身份、旧数据导入或旧前端生产构建作为临时方案。
