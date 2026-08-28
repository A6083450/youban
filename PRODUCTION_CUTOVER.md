# Bun 生产切换与全新微信账号启用

本文用于 `youban.me` 从 Python/Uvicorn 切换到 Bun/Elysia，并按已确认范围删除本地及生产业务数据。新服务只接受微信身份，不导入旧用户、任务、对话、图片或记忆。

## 1. 切换前验收

1. 记录待发布提交、当前 Python 进程或容器、Caddyfile 路径与哈希、生产数据挂载的真实绝对路径。
2. 使用独立空目录在备用端口启动 Bun，确认 SQLite 自动创建为 schema 6。
3. 验证健康检查、微信登录模拟、Bearer/HttpOnly 会话、网页挑战、SSE、WebSocket、规划恢复、公开分享和头像上传。
4. 确认 `WECHAT_APP_SECRET`、`AUTH_PEPPER` 只存在于服务器密钥环境；`AUTH_PEPPER` 至少 32 字节。

## 2. 精确列出删除范围

先只预览，不删除：

```bash
cd backend-ts
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
cd backend-ts
bun run purge:business-data \
  --data-dir=/生产数据真实绝对路径 \
  --execute \
  --confirm-dir=/生产数据真实绝对路径
```

此操作不创建旧业务数据备份，删除后不可通过游伴工具恢复。

## 4. 启动与切流

```bash
export YOUBAN_DATA_DIR=/生产数据真实绝对路径
export BUN_CANDIDATE_PORT=7861
docker compose -f docker-compose.bun.yaml up -d --build
cd backend-ts
bun run smoke:deployment --base-url=http://127.0.0.1:7861 --health-only
```

确认新建数据库 `PRAGMA user_version` 为 6、`PRAGMA quick_check` 为 `ok` 后，将 Caddy 上游切到 Bun 端口并 reload。

## 5. 真实验收

必须通过以下真实流程：

1. 新微信账号首次登录并主动选择微信头像；网页扫码登录后显示同一头像。
2. 小程序完成多轮对话、生成行程、杀进程后按任务恢复。
3. 国内可信坐标可打开原生导航，无可信坐标时保留行程并降级提示。
4. 生成 32 位分享令牌，由第二个微信账号匿名只读打开。
5. 昵称登录、旧账号迁移、伪造 `x-user-id` 和 WebSocket 查询参数身份均不可用。

## 回切边界

可以把 Caddy 上游切回旧服务二进制或端口，但旧业务数据已按确认删除，不能回滚。若微信登录、头像、规划、恢复或分享任一核心流程失败，应停止新写入、回切上游并修复代码；不得重新引入昵称身份或旧数据导入作为临时方案。
