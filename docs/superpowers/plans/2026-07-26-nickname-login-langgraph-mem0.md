# 昵称登录 + LangGraph + mem0 用户记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 昵称即登录区分用户;核心规划 agent 从 hello-agents 重写为 LangGraph;集成 mem0 实现每用户长期记忆,并把记忆注入对话/推荐/规划提示词。

**Architecture:** 后端新增 user_service + auth 路由(文件存储 data/users.json,Header X-User-Id 传递身份);`MultiAgentTripPlanner` 重写为 LangGraph StateGraph(信息搜集直调高德 REST,LLM 只做规划,JSON 容错管线抽为 plan_parser);mem0 开源本地模式(qdrant path 本地向量库,LLM/embedder 复用 OpenAI 兼容中转配置),memory_service 封装并保证任何故障不阻塞主流程。前端 auth store + 登录页 + axios 拦截器注入身份 + 侧栏用户区/记忆弹窗。

**Tech Stack:** FastAPI、langgraph 1.x、langchain-openai、mem0ai 2.x(qdrant-client 本地模式)、openai 2.x、Vue 3 + vue-router 4 + ant-design-vue 4。

**Spec:** `docs/superpowers/specs/2026-07-26-nickname-login-langgraph-mem0-design.md`

## Global Constraints

- 后端测试用 `unittest`(现有风格),从 `backend/` 目录跑:`.venv/bin/python -m unittest <module> -v`;不引入 pytest。
- 所有 Bash 检索命令用 `command grep` / `command find`(shell 有 bun 别名劫持)。
- 记忆功能任何故障不得阻塞主流程:mem0 相关调用全部 try/except,失败记日志返回空。
- 无 `X-User-Id` 的请求保持向后兼容:业务端点不拒绝,仅跳过记忆与归属。
- 进度 stage 名保持不变:`attraction_search` / `weather_search` / `hotel_search` / `planning`(前端 WorkProgress 依赖)。
- localStorage key 前缀沿用 `tripstar.`;i18n 文案 zh/en/ja 三语齐全。
- 提交信息风格沿用仓库现状(如 `feat(auth): ...`、`refactor(agent): ...`);每个任务至少一次提交。
- 依赖版本:langgraph>=1.0、langchain-openai>=1.0、mem0ai>=2.0(已 dry-run 验证无冲突);移除 `hello-agents[protocols]`。
- Python 侧新增环境变量(均可选):`MEM0_EMBEDDING_MODEL`(默认 `text-embedding-3-small`)、`MEM0_EMBEDDING_BASE_URL`(默认同 LLM base_url)、`MEM0_EMBEDDING_DIMS`(默认 `1536`)。

---

### Task 1: 用户服务 user_service

**Files:**
- Create: `backend/app/services/user_service.py`
- Test: `backend/app/services/user_service_test.py`

**Interfaces:**
- Produces: `login(nickname: str) -> dict`(返回 `{"user_id","nickname","created_at","last_login_at"}`,昵称非法抛 `ValueError`)、`get_user(user_id: str) -> dict | None`、`clear_users_for_test()`(仅测试用,重置存储路径缓存)。存储路径:`get_data_dir() / "users.json"`。

- [ ] **Step 1: 写失败测试**

```python
# backend/app/services/user_service_test.py
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class UserServiceTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        patcher = patch(
            "app.services.user_service.get_data_dir",
            return_value=Path(self._tmp.name),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        from app.services import user_service
        user_service.clear_users_for_test()
        self.svc = user_service

    def test_login_creates_user_and_returns_stable_id(self):
        user = self.svc.login("小明")
        self.assertEqual(user["nickname"], "小明")
        self.assertTrue(user["user_id"])
        again = self.svc.login("小明")
        self.assertEqual(again["user_id"], user["user_id"])

    def test_login_normalizes_whitespace_and_casefold(self):
        a = self.svc.login("  Alice ")
        b = self.svc.login("alice")
        self.assertEqual(a["user_id"], b["user_id"])
        self.assertEqual(a["nickname"], "Alice")  # 保留首次输入的显示昵称

    def test_login_rejects_empty_and_too_long(self):
        with self.assertRaises(ValueError):
            self.svc.login("   ")
        with self.assertRaises(ValueError):
            self.svc.login("超" * 21)

    def test_get_user(self):
        user = self.svc.login("bob")
        self.assertEqual(self.svc.get_user(user["user_id"])["nickname"], "bob")
        self.assertIsNone(self.svc.get_user("nope"))

    def test_persisted_across_reload(self):
        user = self.svc.login("carol")
        self.svc.clear_users_for_test(keep_file=True)
        self.assertEqual(self.svc.login("carol")["user_id"], user["user_id"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && .venv/bin/python -m unittest app.services.user_service_test -v`
Expected: FAIL(ModuleNotFoundError: app.services.user_service)

- [ ] **Step 3: 实现 user_service**

```python
# backend/app/services/user_service.py
"""昵称用户服务:昵称即登录,同昵称(casefold)视为同一用户。

轻量身份区分,非安全鉴权;存储于 data/users.json,进程内加锁 + 原子写。
"""

import json
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..config import get_data_dir

MAX_NICKNAME_LEN = 20

_lock = threading.Lock()
_cache: Optional[List[Dict[str, Any]]] = None


def _users_file():
    return get_data_dir() / "users.json"


def _load_users() -> List[Dict[str, Any]]:
    global _cache
    if _cache is not None:
        return _cache
    path = _users_file()
    users: List[Dict[str, Any]] = []
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("users"), list):
                users = [u for u in data["users"] if isinstance(u, dict) and u.get("user_id")]
        except Exception as e:
            print(f"⚠️  读取用户文件失败,视为空: {e}")
    _cache = users
    return users


def _save_users(users: List[Dict[str, Any]]) -> None:
    path = _users_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def _normalize(nickname: str) -> str:
    return " ".join(str(nickname or "").split())


def login(nickname: str) -> Dict[str, Any]:
    """按昵称登录:存在(casefold 相同)即返回该用户,否则创建。"""
    display = _normalize(nickname)
    if not display:
        raise ValueError("昵称不能为空")
    if len(display) > MAX_NICKNAME_LEN:
        raise ValueError(f"昵称不能超过 {MAX_NICKNAME_LEN} 个字符")

    key = display.casefold()
    now = datetime.now().isoformat(timespec="seconds")
    with _lock:
        users = _load_users()
        for user in users:
            if str(user.get("nickname", "")).casefold() == key:
                user["last_login_at"] = now
                _save_users(users)
                return dict(user)
        user = {
            "user_id": uuid.uuid4().hex[:8],
            "nickname": display,
            "created_at": now,
            "last_login_at": now,
        }
        users.append(user)
        _save_users(users)
        return dict(user)


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    with _lock:
        for user in _load_users():
            if user.get("user_id") == user_id:
                return dict(user)
    return None


def clear_users_for_test(keep_file: bool = False) -> None:
    """重置内存缓存;keep_file=False 时连磁盘文件一起删(仅测试用)。"""
    global _cache
    with _lock:
        _cache = None
        if not keep_file:
            try:
                _users_file().unlink(missing_ok=True)
            except OSError:
                pass
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && .venv/bin/python -m unittest app.services.user_service_test -v`
Expected: 5 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/user_service.py backend/app/services/user_service_test.py
git commit -m "feat(auth): add nickname user service with file storage"
```

---

### Task 2: auth 路由(login / me)

**Files:**
- Create: `backend/app/api/routes/auth.py`
- Modify: `backend/app/api/main.py`(import + include_router)
- Test: `backend/app/api/routes/auth_endpoint_test.py`

**Interfaces:**
- Consumes: Task 1 的 `user_service.login/get_user`。
- Produces: `POST /api/auth/login {nickname} -> {success, user}`;`GET /api/auth/me`(Header `X-User-Id`)`-> {success, user}` / 404。`/auth/memories` 端点在 Task 7 加入本文件。

- [ ] **Step 1: 写失败测试**

```python
# backend/app/api/routes/auth_endpoint_test.py
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class AuthEndpointTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        patcher = patch(
            "app.services.user_service.get_data_dir",
            return_value=Path(self._tmp.name),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        from app.services import user_service
        user_service.clear_users_for_test()

        from fastapi import FastAPI
        from app.api.routes import auth
        app = FastAPI()
        app.include_router(auth.router, prefix="/api")
        self.client = TestClient(app)

    def test_login_success(self):
        resp = self.client.post("/api/auth/login", json={"nickname": "小星"})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["user"]["nickname"], "小星")
        self.assertTrue(body["user"]["user_id"])

    def test_login_same_nickname_same_user(self):
        first = self.client.post("/api/auth/login", json={"nickname": "Neo"}).json()
        second = self.client.post("/api/auth/login", json={"nickname": " neo "}).json()
        self.assertEqual(first["user"]["user_id"], second["user"]["user_id"])

    def test_login_invalid_nickname(self):
        resp = self.client.post("/api/auth/login", json={"nickname": "   "})
        self.assertEqual(resp.status_code, 422)

    def test_me_roundtrip(self):
        user = self.client.post("/api/auth/login", json={"nickname": "回环"}).json()["user"]
        ok = self.client.get("/api/auth/me", headers={"X-User-Id": user["user_id"]})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["user"]["nickname"], "回环")
        missing = self.client.get("/api/auth/me", headers={"X-User-Id": "ghost123"})
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && .venv/bin/python -m unittest app.api.routes.auth_endpoint_test -v`
Expected: FAIL(ModuleNotFoundError: app.api.routes.auth)。若报 `fastapi.testclient` 缺 httpx,先 `uv pip install --python .venv/bin/python httpx`(项目已有 httpx,一般不需要)。

- [ ] **Step 3: 实现 auth 路由并注册**

```python
# backend/app/api/routes/auth.py
"""昵称登录与用户身份路由(轻量身份区分,非安全鉴权)"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ...services import user_service

router = APIRouter(prefix="/auth", tags=["用户"])


class LoginPayload(BaseModel):
    nickname: str = Field(..., max_length=50, description="用户昵称,输入即登录")


@router.post("/login", summary="昵称登录", description="输入昵称即登录;同昵称视为同一用户")
async def login(payload: LoginPayload):
    try:
        user = user_service.login(payload.nickname)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"success": True, "user": user}


@router.get("/me", summary="校验当前用户", description="按 X-User-Id 返回用户信息,不存在时 404")
async def me(x_user_id: str = Header(default="")):
    user = user_service.get_user(x_user_id.strip())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在,请重新登录")
    return {"success": True, "user": user}
```

`backend/app/api/main.py` 两处修改:

```python
# 原: from .routes import trip, poi, map as map_routes, chat, settings as settings_routes, admin as admin_routes
from .routes import trip, poi, map as map_routes, chat, settings as settings_routes, admin as admin_routes, auth as auth_routes
```

```python
# 在 app.include_router(admin_routes.router, prefix="/api") 之后追加:
app.include_router(auth_routes.router, prefix="/api")
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && .venv/bin/python -m unittest app.api.routes.auth_endpoint_test -v && .venv/bin/python -c "import app.api.main"`
Expected: 4 个测试 PASS;import 无报错

- [ ] **Step 5: 提交**

```bash
git add backend/app/api/routes/auth.py backend/app/api/routes/auth_endpoint_test.py backend/app/api/main.py
git commit -m "feat(auth): add nickname login and me endpoints"
```

---

### Task 3: trip 任务归属与历史过滤

**Files:**
- Modify: `backend/app/api/routes/trip.py`(`_create_task_state`、`_normalize_loaded_task`、`_persist_task_state`、`_build_history_item`、`_load_history_items`、`/plan`、`/history`)
- Test: `backend/app/api/routes/trip_history_filter_test.py`

**Interfaces:**
- Consumes: 无新依赖(Header 直读)。
- Produces: 任务状态与持久化 JSON 新增 `user_id: str` 字段;`GET /api/trip/history` 按 `X-User-Id` 过滤(有 header → 只返回该用户任务;无 header → 只返回无主任务);`POST /api/trip/plan` 接受 `X-User-Id` 并写入任务;`_run_trip_planning(task_id, request, user_id)` 签名扩展(Task 6 的 planner 将消费 user_id)。

- [ ] **Step 1: 写失败测试**

```python
# backend/app/api/routes/trip_history_filter_test.py
import unittest

from app.api.routes.trip import _build_history_item


def _payload(user_id):
    return {
        "status": "completed",
        "user_id": user_id,
        "request_payload": {
            "city": "北京",
            "cities": [{"city": "北京", "days": 3}],
            "start_date": "2026-08-01",
            "end_date": "2026-08-03",
            "travel_days": 3,
        },
        "result": {"data": {"city": "北京", "days": []}},
    }


class HistoryFilterTest(unittest.TestCase):
    def test_item_carries_user_id(self):
        item = _build_history_item("t1", _payload("u123"), "2026-07-26T00:00:00")
        self.assertEqual(item["user_id"], "u123")

    def test_item_legacy_task_user_id_empty(self):
        payload = _payload("")
        payload.pop("user_id")
        item = _build_history_item("t2", payload, "2026-07-26T00:00:00")
        self.assertEqual(item["user_id"], "")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && .venv/bin/python -m unittest app.api.routes.trip_history_filter_test -v`
Expected: FAIL(KeyError: 'user_id')

- [ ] **Step 3: 实现任务归属**

`trip.py` 逐点修改(保持其余逻辑不动):

```python
# 1) _create_task_state 返回 dict 中新增一行:
        "user_id": "",

# 2) _normalize_loaded_task 的 task.update({...}) 中新增:
            "user_id": payload.get("user_id", ""),

# 3) _persist_task_state 的 payload dict 中新增:
            "user_id": task.get("user_id", ""),

# 4) _build_history_item 返回 dict 中新增:
        "user_id": str(payload.get("user_id") or ""),

# 5) _load_history_items 增加过滤参数:
def _load_history_items(limit: int = 10, user_id: str = "") -> list[Dict[str, Any]]:
    """按最近更新时间返回历史计划摘要;user_id 非空时只返回该用户的任务,否则只返回无主任务。"""
    # 循环内取得 item 后、append 之前加:
            if item:
                if (item.get("user_id") or "") != (user_id or ""):
                    continue
                items.append(item)

# 6) /plan 端点签名与任务创建(Header 导入:from fastapi import APIRouter, Header, ...):
async def plan_trip(request: TripRequest, x_user_id: str = Header(default="")):
    ...
    _tasks[task_id] = _create_task_state(task_id)
    _tasks[task_id]["user_id"] = x_user_id.strip()
    _tasks[task_id]["request_payload"] = request.model_dump(mode="json")
    ...
    asyncio.create_task(_run_trip_planning(task_id, request, x_user_id.strip()))

# 7) _run_trip_planning 签名扩展(user_id 本任务先透传不用,Task 6 消费):
async def _run_trip_planning(task_id: str, request: TripRequest, user_id: str = ""):

# 8) /history 端点:
async def get_trip_history(limit: int = 10, x_user_id: str = Header(default="")):
    safe_limit = max(1, min(int(limit or 10), 50))
    return {"items": _load_history_items(safe_limit, user_id=x_user_id.strip())}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && .venv/bin/python -m unittest app.api.routes.trip_history_filter_test app.api.routes.trip_confirmation_endpoint_test -v`
Expected: 新测试 PASS,现有 confirmation 端点测试不回归

- [ ] **Step 5: 提交**

```bash
git add backend/app/api/routes/trip.py backend/app/api/routes/trip_history_filter_test.py
git commit -m "feat(auth): scope trip tasks and history by user id"
```

---

### Task 4: llm_service 重写 + 非 planner 调用点迁移

**Files:**
- Modify: `backend/app/services/llm_service.py`(新增新接口,暂保留 `get_llm()` 兼容 planner)
- Modify: `backend/app/api/routes/trip.py`(parse / confirm-reply 两处 LLM 调用)
- Modify: `backend/app/services/amap_service.py`(`search_amap_attractions` 的 LLM 调用;删除文件顶部 `from hello_agents.tools import MCPTool` 与 `get_amap_mcp_tool()`)
- Modify: `backend/app/services/xhs_service.py`(LLM 调用)
- Test: 现有测试回归 + import 冒烟

**Interfaces:**
- Produces:
  - `get_llm_settings() -> dict`:`{"api_key","base_url","model","timeout"}`(每次实时读 settings,支持热更新)
  - `get_openai_client() -> openai.OpenAI` 单例(带浏览器 UA header)
  - `get_chat_model(temperature=0.2, timeout=None, max_tokens=None) -> ChatOpenAI`(langchain,Task 6 消费)
  - `reset_llm()` 保留(admin 路由在用)
- 调用点迁移模式:`llm = get_llm(); llm._client.chat.completions.create(model=llm.model, ...)` → `client = get_openai_client(); client.chat.completions.create(model=get_llm_settings()["model"], ...)`

- [ ] **Step 1: 安装新依赖并更新 requirements**

```bash
cd backend && uv pip install --python .venv/bin/python langgraph langchain-openai mem0ai
```

`backend/requirements.txt`:删除 `hello-agents[protocols]>=0.2.4,<=0.2.9` 之外先不动(Task 6 删),文件末尾新增:

```
langgraph>=1.0.0
langchain-openai>=1.0.0
mem0ai>=2.0.0
```

Expected: 安装成功(openai 升 2.x;dry-run 已验证)

- [ ] **Step 2: 重写 llm_service(保留 get_llm 兼容)**

```python
# backend/app/services/llm_service.py 整文件替换为:
"""LLM服务模块:OpenAI 兼容客户端(原生 + langchain),支持运行时热更新"""

import os
from typing import Any, Dict, Optional

from openai import OpenAI

from ..config import get_settings

# 伪装浏览器 UA:部分第三方中转开启了 Cloudflare/WAF 拦截 Python 默认客户端特征
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_client_instance: Optional[OpenAI] = None


def get_llm_settings() -> Dict[str, Any]:
    """实时读取 LLM 配置(支持前端设置页热更新)。"""
    settings = get_settings()
    api_key = (
        settings.openai_api_key
        or os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    base_url = (
        settings.openai_base_url
        or os.getenv("LLM_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    model = (
        settings.openai_model
        or os.getenv("LLM_MODEL_ID")
        or os.getenv("OPENAI_MODEL")
        or "gpt-4"
    )
    return {
        "api_key": api_key.strip(),
        "base_url": base_url.rstrip("/"),
        "model": model.strip(),
        "timeout": int(os.getenv("LLM_TIMEOUT", "60")),
    }


def get_openai_client() -> OpenAI:
    """获取原生 OpenAI 客户端(单例,带浏览器 UA)。"""
    global _client_instance
    if _client_instance is None:
        cfg = get_llm_settings()
        _client_instance = OpenAI(
            api_key=cfg["api_key"],
            base_url=cfg["base_url"],
            timeout=cfg["timeout"],
            default_headers={"User-Agent": _BROWSER_UA},
        )
        print(f"✅ LLM 客户端初始化成功: {cfg['base_url']} / {cfg['model']}")
    return _client_instance


def get_chat_model(
    temperature: float = 0.2,
    timeout: Optional[int] = None,
    max_tokens: Optional[int] = None,
):
    """获取 langchain ChatOpenAI 实例(LangGraph 节点用,轻量对象每次新建)。"""
    from langchain_openai import ChatOpenAI

    cfg = get_llm_settings()
    return ChatOpenAI(
        model=cfg["model"],
        api_key=cfg["api_key"],
        base_url=cfg["base_url"],
        temperature=temperature,
        timeout=timeout or cfg["timeout"],
        max_tokens=max_tokens,
        max_retries=1,
        default_headers={"User-Agent": _BROWSER_UA},
    )


def get_llm():
    """【过渡期兼容】返回 HelloAgentsLLM;Task 6 重写 planner 后删除本函数。"""
    from hello_agents import HelloAgentsLLM

    cfg = get_llm_settings()
    llm = HelloAgentsLLM(
        model=cfg["model"], api_key=cfg["api_key"],
        base_url=cfg["base_url"], timeout=cfg["timeout"],
    )
    llm._client = get_openai_client()
    return llm


def reset_llm():
    """重置客户端(配置热更新后调用)。"""
    global _client_instance
    _client_instance = None
```

- [ ] **Step 3: 迁移非 planner 调用点**

`trip.py` `/parse`(约 451 行)与 `/confirm-reply`(约 664 行)两处,同样的替换:

```python
# 原:
        from ...services.llm_service import get_llm      # 函数顶部的局部 import
        llm = get_llm()
        response = await asyncio.to_thread(
            lambda: llm._client.chat.completions.create(
                model=llm.model,
                ...
# 改为:
        from ...services.llm_service import get_openai_client, get_llm_settings
        client = get_openai_client()
        model_id = get_llm_settings()["model"]
        response = await asyncio.to_thread(
            lambda: client.chat.completions.create(
                model=model_id,
                ...
```

`amap_service.py`:
1. 删除第 4 行 `from hello_agents.tools import MCPTool` 与 `get_amap_mcp_tool()` 整个函数(12-48 行,确认无引用:`command grep -rn "get_amap_mcp_tool" backend/app --include="*.py"` 应只剩定义本身)。
2. `search_amap_attractions` 内(约 340/422 行):`from .llm_service import get_llm` → `from .llm_service import get_openai_client, get_llm_settings`;`llm = get_llm()` 与 `llm._client.chat.completions.create(model=llm.model, ...)` → `client = get_openai_client()` 与 `client.chat.completions.create(model=get_llm_settings()["model"], ...)`。

`xhs_service.py`(约 16/321/367 行):同样模式替换。

- [ ] **Step 4: 回归验证**

```bash
cd backend && .venv/bin/python -c "import app.api.main" \
  && .venv/bin/python -m unittest app.services.trip_confirmation_test app.api.routes.trip_confirmation_endpoint_test app.api.routes.trip_history_filter_test -v
```
Expected: import 成功、全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/llm_service.py backend/app/api/routes/trip.py backend/app/services/amap_service.py backend/app/services/xhs_service.py backend/requirements.txt
git commit -m "refactor(llm): replace HelloAgentsLLM with native openai + langchain clients"
```

---

### Task 5: plan_parser 抽取(JSON 容错管线)

**Files:**
- Create: `backend/app/agents/plan_parser.py`
- Test: `backend/app/agents/plan_parser_test.py`
- Modify: 无(旧 trip_planner_agent.py 在 Task 6 整体重写时改为调用本模块)

**Interfaces:**
- Produces: `parse_trip_plan(response: str, request: TripRequest) -> TripPlan`(抛 `ValueError` 表示不可修复)。内部函数从现有 `trip_planner_agent.py` 平移(逻辑零改动):`_sanitize_json_str` → `sanitize_json_str`、`_strip_comments_outside_strings` → `strip_comments_outside_strings`、`_remove_trailing_commas` → `remove_trailing_commas`、`_fix_unescaped_quotes` → `fix_unescaped_quotes`、`_error_guided_json_fix` → `error_guided_json_fix`、`_repair_truncated_json` → `repair_truncated_json`、`_llm_repair_json` → `llm_repair_json`、`_parse_response` 主体 → `parse_trip_plan`。

- [ ] **Step 1: 写失败测试**

```python
# backend/app/agents/plan_parser_test.py
import unittest

from app.agents.plan_parser import (
    fix_unescaped_quotes,
    parse_trip_plan,
    remove_trailing_commas,
    repair_truncated_json,
    sanitize_json_str,
)
from app.models.schemas import TripRequest

REQUEST = TripRequest(
    city="北京", start_date="2026-08-01", end_date="2026-08-03",
    travel_days=3, transportation="公共交通", accommodation="经济型酒店",
)

VALID_PLAN = """```json
{"city": "北京", "start_date": "2026-08-01", "end_date": "2026-08-03",
 "days": [{"date": "2026-08-01", "day_index": 0, "description": "第1天",
   "transportation": "公共交通", "accommodation": "经济型酒店",
   "attractions": [{"name": "故宫", "address": "东城区", 
     "location": {"longitude": 116.397, "latitude": 39.916},
     "visit_duration": 120, "description": "宫殿", "category": "历史"}],
   "meals": [{"type": "breakfast", "name": "早餐", "description": "豆浆"}]}],
 "weather_info": [], "overall_suggestions": "好好玩"}
```"""


class PlanParserTest(unittest.TestCase):
    def test_parse_valid_fenced_json(self):
        plan = parse_trip_plan(VALID_PLAN, REQUEST)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(len(plan.days), 1)

    def test_sanitize_strips_arithmetic_expressions(self):
        fixed = sanitize_json_str('{"total": 30+54+120=204}')
        self.assertIn('"total": 204', fixed)

    def test_remove_trailing_commas(self):
        self.assertEqual(remove_trailing_commas('{"a": 1,}'), '{"a": 1}')

    def test_fix_unescaped_quotes(self):
        fixed = fix_unescaped_quotes('{"d": "这是"好的"景点"}')
        self.assertEqual(fixed, '{"d": "这是\'好的\'景点"}')

    def test_repair_truncated_json(self):
        repaired = repair_truncated_json('{"a": [{"b": "text')
        import json
        self.assertEqual(json.loads(repaired), {"a": [{"b": "text"}]})

    def test_unparseable_raises_value_error(self):
        with self.assertRaises(ValueError):
            parse_trip_plan("完全不是JSON", REQUEST)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && .venv/bin/python -m unittest app.agents.plan_parser_test -v`
Expected: FAIL(ModuleNotFoundError: app.agents.plan_parser)

- [ ] **Step 3: 平移实现**

创建 `backend/app/agents/plan_parser.py`,模块 docstring `"""行程 JSON 容错解析:多层修复管线(从 MultiAgentTripPlanner 平移)"""`。把现有 `trip_planner_agent.py` 中 `_strip_comments_outside_strings`(799-834)、`_remove_trailing_commas`(836-869)、`_sanitize_json_str`(871-912)、`_fix_unescaped_quotes`(914-964)、`_error_guided_json_fix`(966-1028)、`_repair_truncated_json`(1030-1112)、`_llm_repair_json`(1114-1155)、`_parse_response`(1157-1306)复制为**模块级函数**(去掉 `self.` 前缀、去下划线改公开名,内部互调同步改名),逻辑保持零改动,仅两处调整:

1. `llm_repair_json` 用 Task 4 新接口:

```python
def llm_repair_json(broken_json: str) -> str:
    """使用 LLM 修复无法自动修复的 JSON(最后手段)"""
    from ..services.llm_service import get_llm_settings, get_openai_client
    client = get_openai_client()
    model_id = get_llm_settings()["model"]
    # ...(原函数体,llm._client → client、model=llm.model → model=model_id,其余不动)
```

2. `parse_trip_plan(response: str, request: TripRequest) -> TripPlan` 即原 `_parse_response` 主体(内部对上述函数的调用去掉 `self._` 前缀;失败落盘 debug 文件路径改为 `os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'debug')`,与原逻辑相同)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && .venv/bin/python -m unittest app.agents.plan_parser_test -v`
Expected: 6 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/agents/plan_parser.py backend/app/agents/plan_parser_test.py
git commit -m "refactor(agent): extract resilient plan JSON parser module"
```

---

### Task 6: LangGraph 规划器重写

**Files:**
- Rewrite: `backend/app/agents/trip_planner_agent.py`(整文件替换)
- Modify: `backend/app/services/llm_service.py`(删除过渡期 `get_llm()`)
- Modify: `backend/requirements.txt`(删除 `hello-agents[protocols]>=0.2.4,<=0.2.9`)
- Modify: `backend/app/api/routes/trip.py`(`_run_trip_planning` 传 user_id 给 plan_trip;`/trip/health` 改用新属性)
- Test: `backend/app/agents/langgraph_planner_test.py`

**Interfaces:**
- Consumes: Task 5 `parse_trip_plan`;Task 4 `get_chat_model`;现有 `search_amap_attractions`、`AmapService.get_weather/search_poi`;Task 7 将实现的 `memory_service.recall/remember`(本任务先写调用,Task 7 前用 try/except ImportError 保护 —— 见代码)。
- Produces: `LangGraphTripPlanner` 类,`async plan_trip(request, progress_callback=None, user_id="") -> TripPlan`;`get_trip_planner_agent()` / `reset_trip_planner_agent()` 签名不变;保留常量 `PLANNER_AGENT_PROMPT` 与函数 `_build_planner_query(request, attractions, weather, hotels, memory_context)`。

- [ ] **Step 1: 写失败测试(打桩全部外部依赖,验证图编排与修复循环)**

```python
# backend/app/agents/langgraph_planner_test.py
import asyncio
import json
import unittest
from unittest.mock import patch

from app.models.schemas import TripRequest

REQUEST = TripRequest(
    city="北京", start_date="2026-08-01", end_date="2026-08-03",
    travel_days=3, transportation="公共交通", accommodation="经济型酒店",
    preferences=["历史文化"],
)

PLAN_JSON = json.dumps({
    "city": "北京", "start_date": "2026-08-01", "end_date": "2026-08-03",
    "days": [{
        "date": "2026-08-01", "day_index": 0, "description": "第1天",
        "transportation": "公共交通", "accommodation": "经济型酒店",
        "attractions": [{"name": "故宫", "address": "东城区",
                         "location": {"longitude": 116.397, "latitude": 39.916},
                         "visit_duration": 120, "description": "宫殿", "category": "历史"}],
        "meals": [{"type": "breakfast", "name": "早餐", "description": "豆浆"}],
    }],
    "weather_info": [], "overall_suggestions": "祝旅途愉快",
}, ensure_ascii=False)


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChatModel:
    def __init__(self, replies):
        self._replies = list(replies)
        self.calls = []

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(messages)
        return _FakeMessage(self._replies.pop(0))


class LangGraphPlannerTest(unittest.TestCase):
    def _run(self, fake_model, recall_text=""):
        from app.agents import trip_planner_agent as tpa

        events = []

        async def cb(stage, message, progress, details=None):
            events.append((stage, progress))

        with patch.object(tpa, "get_chat_model", return_value=fake_model), \
             patch.object(tpa, "_fetch_attractions_text", return_value="故宫|天安门"), \
             patch.object(tpa, "_fetch_weather_text", return_value="晴 25°C"), \
             patch.object(tpa, "_fetch_hotels_text", return_value="如家酒店"), \
             patch.object(tpa, "_recall_memory", return_value=recall_text):
            planner = tpa.LangGraphTripPlanner()
            plan = asyncio.run(planner.plan_trip(REQUEST, progress_callback=cb, user_id="u1"))
        return plan, events, fake_model

    def test_happy_path_produces_plan_and_progress(self):
        plan, events, model = self._run(_FakeChatModel([PLAN_JSON]))
        self.assertEqual(plan.city, "北京")
        stages = [s for s, _ in events]
        for stage in ("attraction_search", "weather_search", "hotel_search", "planning"):
            self.assertIn(stage, stages)

    def test_memory_context_injected_into_planner_prompt(self):
        _, _, model = self._run(_FakeChatModel([PLAN_JSON]), recall_text="- 用户喜欢自然风光")
        prompt_text = str(model.calls[0])
        self.assertIn("用户喜欢自然风光", prompt_text)

    def test_repair_loop_recovers_from_bad_json(self):
        model = _FakeChatModel(["这不是JSON{{{", PLAN_JSON])
        plan, _, _ = self._run(model)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(len(model.calls), 2)  # 首次失败 → repair 重新规划


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && .venv/bin/python -m unittest app.agents.langgraph_planner_test -v`
Expected: FAIL(无 LangGraphTripPlanner / _fetch_attractions_text 等属性)

- [ ] **Step 3: 重写 trip_planner_agent.py**

整文件替换。**保留原文件的 `PLANNER_AGENT_PROMPT` 常量全文(77-177 行)与 `_build_planner_query` 函数主体(695-797 行,改为模块级函数并加 `memory_context` 参数)**,其余按下述代码实现:

```python
# backend/app/agents/trip_planner_agent.py
"""LangGraph 旅行规划工作流

图结构:
START → load_memories → fetch_attractions → fetch_weather → fetch_hotels
      → plan_itinerary → parse_plan ─(成功)→ save_memories → END
                              └─(失败且未重试)→ repair_plan → parse_plan
"""

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import RetryPolicy

from ..models.schemas import TripPlan, TripRequest
from ..services.llm_service import get_chat_model
from .plan_parser import parse_trip_plan

PLANNER_AGENT_PROMPT = """(原文件 77-177 行全文,一字不改)"""


class PlannerState(TypedDict, total=False):
    request_data: dict
    memory_context: str
    attractions: Dict[str, str]
    weather: Dict[str, str]
    hotels: Dict[str, str]
    planner_output: str
    trip_plan: Optional[dict]
    parse_error: str
    repair_attempts: int


class PlannerContext(TypedDict, total=False):
    progress_callback: Optional[Callable[..., Awaitable[None]]]
    user_id: str


# ---------- 可打桩的数据源适配层(测试直接 patch 这三个函数) ----------

def _fetch_attractions_text(city: str, keywords: str, language: str) -> str:
    from ..services.amap_service import search_amap_attractions
    return search_amap_attractions(city, keywords, language)


def _fetch_weather_text(city: str) -> str:
    from ..services.amap_service import get_amap_service
    try:
        items = get_amap_service().get_weather(city)
        if not items:
            return f"{city} 天气信息暂缺"
        return json.dumps([w.model_dump() for w in items], ensure_ascii=False)
    except Exception as e:
        return f"{city} 天气查询失败: {e}"


def _fetch_hotels_text(city: str, accommodation: str) -> str:
    from ..services.amap_service import get_amap_service
    try:
        pois = get_amap_service().search_poi(accommodation or "酒店", city)
        if not pois:
            pois = get_amap_service().search_poi("酒店", city)
        return json.dumps([p.model_dump() for p in pois[:10]], ensure_ascii=False)
    except Exception as e:
        return f"{city} 酒店搜索失败: {e}"


def _recall_memory(user_id: str, query: str) -> str:
    """读取用户长期记忆(Task 7 实装 memory_service;失败/缺席返回空串)。"""
    if not user_id:
        return ""
    try:
        from ..services.memory_service import recall_sync
        return recall_sync(user_id, query)
    except Exception:
        return ""


def _remember_plan(user_id: str, request: TripRequest, plan: TripPlan) -> None:
    if not user_id:
        return
    try:
        from ..services.memory_service import remember_background
        cities = " → ".join(cs.city for cs in request.cities)
        prefs = "、".join(request.preferences) if request.preferences else "无特别偏好"
        remember_background(
            user_id,
            [{"role": "user",
              "content": f"我生成了旅行计划:{cities},{request.start_date} 至 {request.end_date} 共 {request.travel_days} 天;偏好:{prefs};交通:{request.transportation};住宿:{request.accommodation}。"}],
            metadata={"source": "trip_planned"},
        )
    except Exception:
        pass


async def _emit(runtime: Runtime[PlannerContext], stage: str, message: str,
                progress: int, details: Optional[list] = None) -> None:
    cb = (runtime.context or {}).get("progress_callback")
    if cb is None:
        return
    result = cb(stage, message, progress, details) if details is not None else cb(stage, message, progress)
    if asyncio.iscoroutine(result):
        await result


def _request_from(state: PlannerState) -> TripRequest:
    return TripRequest(**state["request_data"])


# ---------- 图节点 ----------

async def load_memories(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    request = _request_from(state)
    user_id = (runtime.context or {}).get("user_id") or ""
    cities = " ".join(cs.city for cs in request.cities)
    query = f"旅行偏好 兴趣 口味 出行习惯 {cities}"
    memory_context = await asyncio.to_thread(_recall_memory, user_id, query)
    if memory_context:
        print(f"🧠 已载入用户记忆 {len(memory_context)} 字")
    return {"memory_context": memory_context, "repair_attempts": 0,
            "attractions": {}, "weather": {}, "hotels": {}}


async def fetch_attractions(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    import time as _time
    request = _request_from(state)
    keywords = request.preferences[0] if request.preferences else "景点"
    lang = (getattr(request, "language", "zh") or "zh").strip().lower().split("-")[0]
    total = len(request.cities)
    result: Dict[str, str] = {}
    for idx, cs in enumerate(request.cities):
        progress = int(10 + (idx / total) * 25)
        await _emit(runtime, "attraction_search", f"🔍 正在搜索 {cs.city} 的景点...", progress,
                    details=[{"type": "searching", "title": f"🔍 正在搜索 {cs.city} 的{keywords}景点...",
                              "content": f"使用高德地图搜索 {cs.city} 的 {keywords} 相关景点信息",
                              "timestamp": int(_time.time() * 1000)}])
        text = await asyncio.to_thread(_fetch_attractions_text, cs.city, keywords, lang)
        result[cs.city] = text
        await _emit(runtime, "attraction_search", f"✅ {cs.city} 景点搜索完毕", progress,
                    details=[{"type": "found", "title": f"📍 {cs.city} 景点搜索完成",
                              "content": (text or "")[:200], "timestamp": int(_time.time() * 1000)}])
    return {"attractions": result}


async def fetch_weather(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    import time as _time
    request = _request_from(state)
    total = len(request.cities)
    result: Dict[str, str] = {}
    for idx, cs in enumerate(request.cities):
        progress = int(35 + (idx / total) * 20)
        await _emit(runtime, "weather_search", f"🌤️ 正在查询 {cs.city} 的天气...", progress,
                    details=[{"type": "searching", "title": f"🌤️ 正在查询 {cs.city} 未来天气预报...",
                              "content": f"调用高德天气 API 获取 {cs.city} 的预报数据",
                              "timestamp": int(_time.time() * 1000)}])
        text = await asyncio.to_thread(_fetch_weather_text, cs.city)
        result[cs.city] = text
        await _emit(runtime, "weather_search", f"✅ {cs.city} 天气查询完毕", progress,
                    details=[{"type": "found", "title": f"🌤️ {cs.city} 天气查询完成",
                              "content": (text or "")[:200], "timestamp": int(_time.time() * 1000)}])
    return {"weather": result}


async def fetch_hotels(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    import time as _time
    request = _request_from(state)
    total = len(request.cities)
    result: Dict[str, str] = {}
    for idx, cs in enumerate(request.cities):
        progress = int(55 + (idx / total) * 20)
        await _emit(runtime, "hotel_search", f"🏨 正在搜索 {cs.city} 的酒店...", progress,
                    details=[{"type": "searching", "title": f"🏨 正在搜索 {cs.city} 的{request.accommodation}...",
                              "content": f"根据住宿偏好「{request.accommodation}」搜索 {cs.city} 合适的酒店",
                              "timestamp": int(_time.time() * 1000)}])
        text = await asyncio.to_thread(_fetch_hotels_text, cs.city, request.accommodation)
        result[cs.city] = text
        await _emit(runtime, "hotel_search", f"✅ {cs.city} 酒店搜索完毕", progress,
                    details=[{"type": "found", "title": f"🏨 {cs.city} 酒店搜索完成",
                              "content": (text or "")[:200], "timestamp": int(_time.time() * 1000)}])
    return {"hotels": result}


async def plan_itinerary(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    import os as _os
    import time as _time
    request = _request_from(state)
    city_names = [cs.city for cs in request.cities]
    await _emit(runtime, "planning",
                "📋 正在生成多城市行程计划..." if len(city_names) > 1 else "📋 正在生成旅行计划...", 85,
                details=[{"type": "planning",
                          "title": f"🧠 正在综合分析 {' → '.join(city_names)} 的景点、天气和酒店信息...",
                          "content": "AI 正在结合你的偏好记忆规划最优行程路线",
                          "timestamp": int(_time.time() * 1000)}])
    query = _build_planner_query(
        request, state.get("attractions", {}), state.get("weather", {}),
        state.get("hotels", {}), state.get("memory_context", ""),
    )
    if state.get("parse_error"):
        query += ("\n\n**补充要求:** 上次输出的 JSON 解析失败"
                  f"({state['parse_error'][:200]}),请重新输出完整、严格合法的 JSON,不要输出解释文字。")
    timeout = int(_os.getenv("TRIP_PLANNER_TIMEOUT", "180"))
    model = get_chat_model(temperature=0.2, timeout=timeout)
    response = await model.ainvoke([
        {"role": "system", "content": PLANNER_AGENT_PROMPT},
        {"role": "user", "content": query},
    ])
    return {"planner_output": str(response.content)}


async def parse_plan(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    request = _request_from(state)
    try:
        plan = await asyncio.to_thread(parse_trip_plan, state.get("planner_output", ""), request)
        return {"trip_plan": plan.model_dump(mode="json"), "parse_error": ""}
    except ValueError as e:
        return {"trip_plan": None, "parse_error": str(e),
                "repair_attempts": state.get("repair_attempts", 0) + 1}


def route_after_parse(state: PlannerState) -> str:
    if state.get("trip_plan") is not None:
        return "save_memories"
    if state.get("repair_attempts", 0) <= 1:
        return "plan_itinerary"  # 带 parse_error 重新规划一次
    raise ValueError(f"行程 JSON 解析失败: {state.get('parse_error', '未知错误')}")


async def save_memories(state: PlannerState, runtime: Runtime[PlannerContext]) -> dict:
    request = _request_from(state)
    user_id = (runtime.context or {}).get("user_id") or ""
    plan = TripPlan(**state["trip_plan"])
    _remember_plan(user_id, request, plan)
    return {}


def _build_graph():
    builder = StateGraph(PlannerState, context_schema=PlannerContext)
    builder.add_node("load_memories", load_memories)
    builder.add_node("fetch_attractions", fetch_attractions)
    builder.add_node("fetch_weather", fetch_weather)
    builder.add_node("fetch_hotels", fetch_hotels)
    builder.add_node("plan_itinerary", plan_itinerary, retry_policy=RetryPolicy(max_attempts=2))
    builder.add_node("parse_plan", parse_plan)
    builder.add_node("save_memories", save_memories)
    builder.add_edge(START, "load_memories")
    builder.add_edge("load_memories", "fetch_attractions")
    builder.add_edge("fetch_attractions", "fetch_weather")
    builder.add_edge("fetch_weather", "fetch_hotels")
    builder.add_edge("fetch_hotels", "plan_itinerary")
    builder.add_edge("plan_itinerary", "parse_plan")
    builder.add_conditional_edges("parse_plan", route_after_parse,
                                  ["save_memories", "plan_itinerary"])
    builder.add_edge("save_memories", END)
    return builder.compile()


class LangGraphTripPlanner:
    """LangGraph 旅行规划工作流(替代 hello-agents 多智能体实现)。"""

    def __init__(self):
        print("🔄 初始化 LangGraph 旅行规划工作流...")
        self.graph = _build_graph()
        self.name = "LangGraph 行程规划"
        print("✅ LangGraph 工作流就绪(7 节点,含解析修复循环)")

    async def plan_trip(
        self,
        request: TripRequest,
        progress_callback: Optional[Callable[..., Awaitable[None] | None]] = None,
        user_id: str = "",
    ) -> TripPlan:
        city_names = [cs.city for cs in request.cities]
        print(f"\n{'='*60}\n🚀 LangGraph 规划开始: {' → '.join(city_names)} "
              f"({request.start_date} ~ {request.end_date}, 用户={user_id or '匿名'})\n{'='*60}")
        try:
            final_state = await self.graph.ainvoke(
                {"request_data": request.model_dump(mode="json")},
                context={"progress_callback": progress_callback, "user_id": user_id},
            )
        except Exception as e:
            print(f"❌ 生成旅行计划失败: {e}")
            raise RuntimeError(f"旅行计划生成失败: {e}") from e

        plan = TripPlan(**final_state["trip_plan"])
        # 补全 cities / 每日 city 字段(LLM 可能遗漏,与原实现一致)
        if not plan.cities:
            plan.cities = city_names
        if len(city_names) == 1:
            for day in plan.days:
                if not day.city:
                    day.city = city_names[0]
        print(f"{'='*60}\n✅ 旅行计划生成完成!\n{'='*60}\n")
        return plan


def _build_planner_query(request, attractions, weather, hotels, memory_context=""):
    """(原文件 _build_planner_query 695-797 行主体平移为模块级函数,唯一改动:
    在 `**基本信息:**` 段之后插入记忆段)"""
    # ... 原函数体,在 query 首段拼接后加入:
    #     if memory_context:
    #         query += f"""
    # **用户偏好(长期记忆,请在选择景点/餐饮/节奏时优先满足):**
    # {memory_context}
    # """
    # 其余(逐城市信息、要求、多城市要求、语言要求)原样保留


# 全局单例(接口与旧实现一致)
_planner = None


def get_trip_planner_agent() -> LangGraphTripPlanner:
    global _planner
    if _planner is None:
        _planner = LangGraphTripPlanner()
    return _planner


def reset_trip_planner_agent() -> None:
    global _planner
    _planner = None
```

注意:`_build_planner_query` 上方注释块必须替换为真实平移代码(原 695-797 行),不能留注释占位。

- [ ] **Step 4: 收尾清理**

1. `llm_service.py`:删除 `get_llm()` 整个函数(确认无引用:`command grep -rn "get_llm\b" backend/app --include="*.py" | command grep -v "get_llm_settings"` 应无结果)。
2. `requirements.txt`:删除首行 `hello-agents[protocols]>=0.2.4,<=0.2.9`;执行 `cd backend && uv pip uninstall --python .venv/bin/python hello-agents`。
3. `trip.py` `_run_trip_planning` 内:`trip_plan = await agent.plan_trip(request, progress_callback=progress_callback)` → `trip_plan = await agent.plan_trip(request, progress_callback=progress_callback, user_id=user_id)`。
4. `trip.py` `/trip/health` 端点:`"agent_name": agent.planner_agent.name` → `"agent_name": agent.name`;`"tools_count": len(...)+len(...)` → `"graph_nodes": 7`。

- [ ] **Step 5: 跑测试确认通过**

```bash
cd backend && .venv/bin/python -m unittest app.agents.langgraph_planner_test app.agents.plan_parser_test -v \
  && .venv/bin/python -c "import app.api.main" \
  && command grep -rn "hello_agents\|hello-agents" app/ requirements.txt --include="*.py" || echo "hello-agents 清除干净"
```
Expected: 测试 PASS;import 成功;grep 无残留(requirements.txt 中也无)

- [ ] **Step 6: 提交**

```bash
git add backend/app/agents/trip_planner_agent.py backend/app/agents/langgraph_planner_test.py backend/app/services/llm_service.py backend/requirements.txt backend/app/api/routes/trip.py
git commit -m "refactor(agent): rewrite trip planner as LangGraph workflow, drop hello-agents"
```

---

### Task 7: mem0 记忆服务 + 注入点 + 记忆管理端点

**Files:**
- Create: `backend/app/services/memory_service.py`
- Modify: `backend/app/api/routes/auth.py`(新增 memories 端点)
- Modify: `backend/app/api/routes/trip.py`(`/parse` 注入记忆 + 写记忆)
- Modify: `backend/app/services/chat_service.py`(ask/edit 注入记忆;edit 写记忆)
- Modify: `backend/app/api/routes/chat.py`(透传 user_id)
- Modify: `backend/app/models/schemas.py`(`TripChatRequest` 加 `user_id`——chat 路由从 Header 读也可,统一用 Header,见代码)
- Modify: `backend/app/api/routes/admin.py`(保存配置后 `reset_memory_service()`)
- Test: `backend/app/services/memory_service_test.py`

**Interfaces:**
- Produces:
  - `get_memory() -> Memory | None`(懒加载;失败标记后不再重试)
  - `recall_sync(user_id, query, limit=5) -> str`(格式化要点列表;失败返回 "")
  - `remember_background(user_id, messages, metadata=None) -> None`(线程投递 fire-and-forget)
  - `list_memories(user_id) -> list[dict]` / `delete_memory(memory_id, user_id) -> bool`
  - `reset_memory_service()`
- Consumes: Task 4 `get_llm_settings`。

- [ ] **Step 1: 写失败测试(降级行为,不依赖真实 mem0 网络)**

```python
# backend/app/services/memory_service_test.py
import unittest
from unittest.mock import MagicMock, patch


class MemoryServiceDegradeTest(unittest.TestCase):
    def setUp(self):
        from app.services import memory_service
        memory_service.reset_memory_service()
        self.ms = memory_service
        self.addCleanup(memory_service.reset_memory_service)

    def test_recall_returns_empty_when_memory_unavailable(self):
        with patch.object(self.ms, "get_memory", return_value=None):
            self.assertEqual(self.ms.recall_sync("u1", "偏好"), "")

    def test_recall_formats_results(self):
        fake = MagicMock()
        fake.search.return_value = {"results": [
            {"id": "m1", "memory": "喜欢自然风光"},
            {"id": "m2", "memory": "不吃辣"},
        ]}
        with patch.object(self.ms, "get_memory", return_value=fake):
            text = self.ms.recall_sync("u1", "偏好")
        self.assertIn("- 喜欢自然风光", text)
        self.assertIn("- 不吃辣", text)

    def test_recall_swallow_exceptions(self):
        fake = MagicMock()
        fake.search.side_effect = RuntimeError("embeddings 404")
        with patch.object(self.ms, "get_memory", return_value=fake):
            self.assertEqual(self.ms.recall_sync("u1", "偏好"), "")

    def test_remember_background_noops_without_user(self):
        with patch.object(self.ms, "get_memory", return_value=MagicMock()) as m:
            self.ms.remember_background("", [{"role": "user", "content": "hi"}])
        m.return_value.add.assert_not_called()

    def test_get_memory_returns_none_without_api_key(self):
        with patch.object(self.ms, "get_llm_settings",
                          return_value={"api_key": "", "base_url": "x", "model": "m", "timeout": 60}):
            self.ms.reset_memory_service()
            self.assertIsNone(self.ms.get_memory())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && .venv/bin/python -m unittest app.services.memory_service_test -v`
Expected: FAIL(ModuleNotFoundError: app.services.memory_service)

- [ ] **Step 3: 实现 memory_service**

```python
# backend/app/services/memory_service.py
"""mem0 用户长期记忆服务(开源本地模式)。

铁律:记忆功能的任何故障都不得阻塞或破坏主流程 —— 所有公开函数
在异常时降级(recall 返回空串 / remember 静默丢弃),仅记日志。
"""

import concurrent.futures
import os
import threading
from typing import Any, Dict, List, Optional

from ..config import get_data_dir
from .llm_service import get_llm_settings

_lock = threading.Lock()
_memory = None
_memory_failed = False
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="mem0")


def _build_config() -> Dict[str, Any]:
    cfg = get_llm_settings()
    memory_dir = get_data_dir() / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    embedding_model = os.getenv("MEM0_EMBEDDING_MODEL", "text-embedding-3-small")
    embedding_base = os.getenv("MEM0_EMBEDDING_BASE_URL", cfg["base_url"])
    embedding_dims = int(os.getenv("MEM0_EMBEDDING_DIMS", "1536"))
    return {
        "llm": {"provider": "openai", "config": {
            "model": cfg["model"], "api_key": cfg["api_key"],
            "openai_base_url": cfg["base_url"],
            "temperature": 0.1, "max_tokens": 2000,
        }},
        "embedder": {"provider": "openai", "config": {
            "model": embedding_model, "api_key": cfg["api_key"],
            "openai_base_url": embedding_base,
            "embedding_dims": embedding_dims,
        }},
        "vector_store": {"provider": "qdrant", "config": {
            "collection_name": "tripstar_memories",
            "path": str(memory_dir / "qdrant"),
            "on_disk": True,
            "embedding_model_dims": embedding_dims,
        }},
        "history_db_path": str(memory_dir / "history.db"),
    }


def get_memory():
    """懒加载 mem0 Memory 单例;不可用返回 None(失败后本进程不再重试)。"""
    global _memory, _memory_failed
    if _memory is not None:
        return _memory
    if _memory_failed:
        return None
    with _lock:
        if _memory is not None or _memory_failed:
            return _memory
        cfg = get_llm_settings()
        if not cfg["api_key"]:
            print("⚠️  LLM API Key 未配置,用户记忆功能停用")
            _memory_failed = True
            return None
        try:
            from mem0 import Memory
            _memory = Memory.from_config(_build_config())
            print("🧠 mem0 用户记忆服务初始化成功")
        except Exception as e:
            print(f"⚠️  mem0 初始化失败,用户记忆功能停用: {e}")
            _memory_failed = True
    return _memory


def recall_sync(user_id: str, query: str, limit: int = 5) -> str:
    """检索用户记忆并格式化为提示词要点;任何异常返回空串。"""
    if not user_id:
        return ""
    memory = get_memory()
    if memory is None:
        return ""
    try:
        result = memory.search(query=query, user_id=user_id, limit=limit)
        items = result.get("results", result) if isinstance(result, dict) else result
        lines = []
        for item in items or []:
            text = str(item.get("memory") or "").strip() if isinstance(item, dict) else str(item).strip()
            if text:
                lines.append(f"- {text}")
        return "\n".join(lines)
    except Exception as e:
        print(f"⚠️  记忆检索失败(已降级): {e}")
        return ""


def remember_background(user_id: str, messages: List[Dict[str, str]],
                        metadata: Optional[Dict[str, Any]] = None) -> None:
    """后台线程写入记忆(fire-and-forget);无 user_id 或服务不可用时直接跳过。"""
    if not user_id or not messages:
        return
    if get_memory() is None:
        return

    def _do_add():
        try:
            memory = get_memory()
            if memory is not None:
                memory.add(messages, user_id=user_id, metadata=metadata or {})
        except Exception as e:
            print(f"⚠️  记忆写入失败(已忽略): {e}")

    _executor.submit(_do_add)


def list_memories(user_id: str) -> List[Dict[str, Any]]:
    if not user_id:
        return []
    memory = get_memory()
    if memory is None:
        return []
    try:
        result = memory.get_all(user_id=user_id)
        items = result.get("results", result) if isinstance(result, dict) else result
        return [
            {"id": str(it.get("id", "")), "memory": str(it.get("memory", "")),
             "created_at": str(it.get("created_at", ""))}
            for it in (items or []) if isinstance(it, dict)
        ]
    except Exception as e:
        print(f"⚠️  记忆列表读取失败: {e}")
        return []


def delete_memory(memory_id: str, user_id: str) -> bool:
    memory = get_memory()
    if memory is None or not memory_id:
        return False
    try:
        owned = {m["id"] for m in list_memories(user_id)}
        if memory_id not in owned:
            return False
        memory.delete(memory_id=memory_id)
        return True
    except Exception as e:
        print(f"⚠️  记忆删除失败: {e}")
        return False


def reset_memory_service() -> None:
    """配置热更新后重置(与 reset_llm 一起调用)。"""
    global _memory, _memory_failed
    with _lock:
        _memory = None
        _memory_failed = False
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && .venv/bin/python -m unittest app.services.memory_service_test -v`
Expected: 5 个测试 PASS

- [ ] **Step 5: 接线注入点与端点**

1. `auth.py` 追加(文件顶部补 `from ...services import memory_service`):

```python
@router.get("/memories", summary="我的记忆", description="返回 AI 对当前用户的长期记忆")
async def my_memories(x_user_id: str = Header(default="")):
    user = user_service.get_user(x_user_id.strip())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在,请重新登录")
    import asyncio
    items = await asyncio.to_thread(memory_service.list_memories, user["user_id"])
    return {"success": True, "items": items}


@router.delete("/memories/{memory_id}", summary="删除一条记忆")
async def remove_memory(memory_id: str, x_user_id: str = Header(default="")):
    user = user_service.get_user(x_user_id.strip())
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在,请重新登录")
    import asyncio
    ok = await asyncio.to_thread(memory_service.delete_memory, memory_id, user["user_id"])
    if not ok:
        raise HTTPException(status_code=404, detail="记忆不存在或无法删除")
    return {"success": True}
```

2. `trip.py` `/parse`:
   - 端点签名加 `x_user_id: str = Header(default="")`。
   - prompt 组装前:`memory_text = await asyncio.to_thread(memory_service.recall_sync, x_user_id.strip(), payload.text)`(顶部 import `from ...services import memory_service`)。
   - prompt 中"对话历史(旧的在前):"段之前插入:

```python
    memory_block = memory_text or "(暂无,可正常对话)"
    # prompt f-string 中加入:
【用户长期记忆】(来自该用户过往对话与行程,用于个性化推荐):
{memory_block}

记忆使用规则:
- action=recommend 时优先推荐符合用户偏好的目的地,并在 reason 里自然引用记忆(如"你之前提过喜欢海边")
- 避免把用户近期已规划/已去过的城市当新推荐,除非用户主动提出重去
- action=plan 时用记忆补全用户没说的偏好(preferences 等),并列入 inferred_fields
```

   - 端点 return 前(成功路径,两个 return 都要),写记忆:

```python
        _reply_for_memory = str(data.get("reply") or "")
        if x_user_id.strip():
            memory_service.remember_background(
                x_user_id.strip(),
                [{"role": "user", "content": payload.text},
                 {"role": "assistant", "content": _reply_for_memory[:500]}],
                metadata={"source": "parse"},
            )
```

3. `chat_service.py`:`chat_with_trip_context` 与 `chat_edit_trip` 均加参数 `user_id: str = ""`;messages 组装处,在 system 之后插入(有记忆时):

```python
    from .memory_service import recall_sync
    memory_text = recall_sync(user_id, message) if user_id else ""
    if memory_text:
        messages.insert(1, {"role": "system",
                            "content": f"【用户长期记忆】回答时可自然引用:\n{memory_text}"})
```

   `chat_edit_trip` 成功且 `changes` 非空时,末尾追加:

```python
    if user_id and changes:
        from .memory_service import remember_background
        remember_background(user_id,
            [{"role": "user", "content": message},
             {"role": "assistant", "content": "已修改行程:" + ";".join(changes)}],
            metadata={"source": "trip_edit"})
```

4. `chat.py` 两个端点签名加 `x_user_id: str = Header(default="")`(import Header),调用处传 `user_id=x_user_id.strip()`。`schemas.py` 不改(身份走 Header)。

5. `admin.py` `save_admin_settings` 的 reset 列表加一行:

```python
        from ...services.memory_service import reset_memory_service
        reset_memory_service()
```

- [ ] **Step 6: 回归全部后端测试**

```bash
cd backend && .venv/bin/python -m unittest discover -s app -p "*_test.py" -v \
  && .venv/bin/python -c "import app.api.main"
```
Expected: 全部 PASS(user_service / auth / trip_history / plan_parser / langgraph_planner / memory_service / trip_confirmation × 2),import 成功

- [ ] **Step 7: 提交**

```bash
git add backend/app/services/memory_service.py backend/app/services/memory_service_test.py backend/app/api/routes/auth.py backend/app/api/routes/trip.py backend/app/services/chat_service.py backend/app/api/routes/chat.py backend/app/api/routes/admin.py
git commit -m "feat(memory): integrate mem0 per-user memory with graceful degradation"
```

---

### Task 8: 前端 auth store + 登录页 + 路由守卫 + api 身份注入

**Files:**
- Create: `frontend/src/stores/auth.ts`
- Create: `frontend/src/views/LoginView.vue`
- Modify: `frontend/src/main.ts`(路由 + 守卫)
- Modify: `frontend/src/services/api.ts`(拦截器注入 X-User-Id;新增 authLogin/authMe/getUserMemories/deleteUserMemory)
- Modify: `frontend/src/types/index.ts`(UserInfo / UserMemoryItem)
- Modify: `frontend/src/i18n/locales/{zh,en,ja}.json`(login.* 文案)

**Interfaces:**
- Produces:
  - store:`currentUser: Ref<UserInfo|null>`、`loginWithNickname(nickname): Promise<UserInfo>`、`logout()`、`restoreSession(): Promise<void>`、`getStoredUserId(): string`(api.ts 消费,避免循环依赖用 localStorage 直读)
  - api:`authLogin(nickname): Promise<UserInfo>`、`authMe(): Promise<UserInfo|null>`、`getUserMemories(): Promise<UserMemoryItem[]>`、`deleteUserMemory(id): Promise<void>`
  - localStorage key:`tripstar.user`(JSON 序列化 UserInfo)
- Consumes: Task 2/7 的后端端点。

- [ ] **Step 1: types 与 api**

`frontend/src/types/index.ts` 末尾追加:

```typescript
// ===== 用户身份(昵称登录) =====
export interface UserInfo {
  user_id: string
  nickname: string
  created_at?: string
  last_login_at?: string
}

export interface UserMemoryItem {
  id: string
  memory: string
  created_at?: string
}
```

`frontend/src/services/api.ts`:
1. 常量区加 `const USER_STORAGE_KEY = 'tripstar.user'`,并导出:

```typescript
export const getStoredUser = (): UserInfo | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && parsed.user_id ? (parsed as UserInfo) : null
  } catch {
    return null
  }
}

export const setStoredUser = (user: UserInfo | null): void => {
  if (typeof window === 'undefined') return
  if (user) window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
  else window.localStorage.removeItem(USER_STORAGE_KEY)
}
```

2. 请求拦截器(`config.baseURL = getRuntimeApiBaseUrl()` 之后)加:

```typescript
    const user = getStoredUser()
    if (user?.user_id) {
      config.headers['X-User-Id'] = user.user_id
    }
```

3. 类型 import 区补 `UserInfo`、`UserMemoryItem`;文件末尾新增函数:

```typescript
// ===== 用户身份(昵称即登录) =====

export async function authLogin(nickname: string): Promise<UserInfo> {
  try {
    const response = await apiClient.post<{ success: boolean; user: UserInfo }>(
      '/api/auth/login', { nickname },
    )
    return response.data.user
  } catch (error: any) {
    throw new Error(error.response?.data?.detail || error.message || t('login.failed'))
  }
}

export async function authMe(): Promise<UserInfo | null> {
  try {
    const response = await apiClient.get<{ success: boolean; user: UserInfo }>('/api/auth/me')
    return response.data.user
  } catch (error: any) {
    if (error.response?.status === 404) return null
    // 网络异常时不强制登出,保留本地会话
    return getStoredUser()
  }
}

export async function getUserMemories(): Promise<UserMemoryItem[]> {
  try {
    const response = await apiClient.get<{ success: boolean; items: UserMemoryItem[] }>(
      '/api/auth/memories',
    )
    return response.data.items ?? []
  } catch {
    return []
  }
}

export async function deleteUserMemory(memoryId: string): Promise<void> {
  await apiClient.delete(`/api/auth/memories/${encodeURIComponent(memoryId)}`)
}
```

- [ ] **Step 2: auth store**

```typescript
// frontend/src/stores/auth.ts
import { ref } from 'vue'
import type { UserInfo } from '@/types'
import { authLogin, authMe, getStoredUser, setStoredUser } from '@/services/api'

export const AUTH_UPDATED_EVENT = 'tripstar:auth-updated'

export const currentUser = ref<UserInfo | null>(getStoredUser())

const emitAuthUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_UPDATED_EVENT))
  }
}

export async function loginWithNickname(nickname: string): Promise<UserInfo> {
  const user = await authLogin(nickname)
  setStoredUser(user)
  currentUser.value = user
  emitAuthUpdated()
  return user
}

export function logout(): void {
  setStoredUser(null)
  currentUser.value = null
  emitAuthUpdated()
}

/** 启动时静默校验本地会话;用户已被后端删除时清除本地状态 */
export async function restoreSession(): Promise<void> {
  if (!currentUser.value) return
  const user = await authMe()
  if (!user) {
    logout()
  } else {
    setStoredUser(user)
    currentUser.value = user
  }
}
```

- [ ] **Step 3: LoginView**

```vue
<!-- frontend/src/views/LoginView.vue -->
<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">🌏</div>
      <h1 class="login-title">{{ t('app.brand') }}</h1>
      <p class="login-subtitle">{{ t('login.subtitle') }}</p>
      <a-input
        v-model:value="nickname"
        class="login-input"
        size="large"
        :maxlength="20"
        :placeholder="t('login.placeholder')"
        @pressEnter="submit"
      />
      <a-button
        type="primary"
        size="large"
        block
        class="login-button"
        :loading="loading"
        :disabled="!nickname.trim()"
        @click="submit"
      >
        {{ t('login.enter') }}
      </a-button>
      <p class="login-hint">{{ t('login.hint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { loginWithNickname } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const nickname = ref('')
const loading = ref(false)

const submit = async () => {
  const name = nickname.value.trim()
  if (!name || loading.value) return
  loading.value = true
  try {
    const user = await loginWithNickname(name)
    message.success(t('login.welcome', { name: user.nickname }))
    router.replace('/')
  } catch (error: any) {
    message.error(error?.message || t('login.failed'))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 20px;
  padding: 40px 32px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}
.login-logo { font-size: 48px; margin-bottom: 8px; }
.login-title { font-size: 24px; font-weight: 700; margin: 0 0 4px; color: #1f2937; }
.login-subtitle { color: #6b7280; margin: 0 0 24px; font-size: 14px; }
.login-input { margin-bottom: 16px; border-radius: 12px; }
.login-button { border-radius: 12px; height: 44px; font-weight: 600; }
.login-hint { margin: 16px 0 0; color: #9ca3af; font-size: 12px; }
</style>
```

- [ ] **Step 4: 路由与守卫(main.ts)**

```typescript
// import 区新增:
import LoginView from './views/LoginView.vue'
import { currentUser, restoreSession } from './stores/auth'

// routes 数组 ChatHome 之前插入:
    { path: '/login', name: 'Login', component: LoginView },

// createRouter 之后新增守卫:
router.beforeEach((to) => {
  const isAdmin = to.path.startsWith('/admin')
  if (!currentUser.value && to.path !== '/login' && !isAdmin) {
    return { path: '/login' }
  }
  if (currentUser.value && to.path === '/login') {
    return { path: '/' }
  }
  return true
})

// app.mount('#app') 之前:
restoreSession()
```

- [ ] **Step 5: i18n 文案**

三个 locale 文件的顶层各新增 `login` 对象(与现有 key 风格一致,插在 `app` 段之后):

```jsonc
// zh.json
"login": {
  "subtitle": "输入昵称,开启你的专属旅程",
  "placeholder": "你的昵称",
  "enter": "进入游伴",
  "hint": "无需密码,同一昵称即可找回你的行程与记忆",
  "welcome": "欢迎回来,{name}!",
  "failed": "登录失败,请重试"
}
// en.json
"login": {
  "subtitle": "Enter a nickname to start your journey",
  "placeholder": "Your nickname",
  "enter": "Let's go",
  "hint": "No password needed — the same nickname brings back your trips and memories",
  "welcome": "Welcome back, {name}!",
  "failed": "Login failed, please try again"
}
// ja.json
"login": {
  "subtitle": "ニックネームを入力して旅を始めましょう",
  "placeholder": "ニックネーム",
  "enter": "はじめる",
  "hint": "パスワード不要。同じニックネームで旅の記録と記憶を呼び戻せます",
  "welcome": "おかえりなさい、{name}さん!",
  "failed": "ログインに失敗しました。もう一度お試しください"
}
```

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npx vite build`
Expected: 构建成功无报错(vue-tsc 全量类型检查在 Task 10 统一跑)

- [ ] **Step 7: 提交**

```bash
git add frontend/src/stores/auth.ts frontend/src/views/LoginView.vue frontend/src/main.ts frontend/src/services/api.ts frontend/src/types/index.ts frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json
git commit -m "feat(auth): nickname login page, auth store, route guard and user header"
```

---

### Task 9: 前端用户区 + 记忆弹窗 + 按用户隔离本地任务

**Files:**
- Create: `frontend/src/components/UserBadge.vue`
- Create: `frontend/src/components/MemoryModal.vue`
- Modify: `frontend/src/App.vue`(侧栏与移动端 topbar 挂 UserBadge;登录态变化刷新计划列表)
- Modify: `frontend/src/views/ChatHome.vue`(localStorage `tripstar.active_task` 改为按 user 命名空间)
- Modify: `frontend/src/i18n/locales/{zh,en,ja}.json`(user.* 文案)

**Interfaces:**
- Consumes: Task 8 store(`currentUser`、`logout`、`AUTH_UPDATED_EVENT`)、api(`getUserMemories`、`deleteUserMemory`);现有 `stores/plans.ts` 的 `refreshPlans`。
- Produces: `<UserBadge />`(自包含,无 props;内部管理 MemoryModal 开关)。

- [ ] **Step 1: MemoryModal 组件**

```vue
<!-- frontend/src/components/MemoryModal.vue -->
<template>
  <a-modal
    :open="open"
    :title="t('user.memoriesTitle')"
    :footer="null"
    width="480px"
    @cancel="emit('close')"
  >
    <a-spin :spinning="loading">
      <template v-if="items.length">
        <div v-for="item in items" :key="item.id" class="memory-item">
          <span class="memory-text">{{ item.memory }}</span>
          <a-button type="text" size="small" danger @click="remove(item.id)">
            {{ t('user.memoryDelete') }}
          </a-button>
        </div>
      </template>
      <a-empty v-else-if="!loading" :description="t('user.memoriesEmpty')" />
    </a-spin>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import type { UserMemoryItem } from '@/types'
import { deleteUserMemory, getUserMemories } from '@/services/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()

const loading = ref(false)
const items = ref<UserMemoryItem[]>([])

watch(() => props.open, async (open) => {
  if (!open) return
  loading.value = true
  try {
    items.value = await getUserMemories()
  } finally {
    loading.value = false
  }
})

const remove = async (id: string) => {
  try {
    await deleteUserMemory(id)
    items.value = items.value.filter((it) => it.id !== id)
    message.success(t('user.memoryDeleted'))
  } catch {
    message.error(t('user.memoryDeleteFailed'))
  }
}
</script>

<style scoped>
.memory-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.memory-text { flex: 1; font-size: 13px; color: #374151; line-height: 1.5; }
</style>
```

- [ ] **Step 2: UserBadge 组件**

```vue
<!-- frontend/src/components/UserBadge.vue -->
<template>
  <div v-if="currentUser" class="user-badge">
    <a-dropdown placement="topLeft" :trigger="['click']">
      <button class="user-badge-btn" type="button">
        <span class="user-avatar">{{ initial }}</span>
        <span class="user-nickname">{{ currentUser.nickname }}</span>
      </button>
      <template #overlay>
        <a-menu>
          <a-menu-item key="memories" @click="memoryOpen = true">
            🧠 {{ t('user.myMemories') }}
          </a-menu-item>
          <a-menu-item key="logout" @click="handleLogout">
            🚪 {{ t('user.switchUser') }}
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
    <MemoryModal :open="memoryOpen" @close="memoryOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { currentUser, logout } from '@/stores/auth'
import MemoryModal from '@/components/MemoryModal.vue'

const { t } = useI18n()
const router = useRouter()
const memoryOpen = ref(false)

const initial = computed(() =>
  (currentUser.value?.nickname || '?').trim().charAt(0).toUpperCase(),
)

const handleLogout = () => {
  logout()
  router.replace('/login')
}
</script>

<style scoped>
.user-badge { width: 100%; }
.user-badge-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 0.2s ease;
}
.user-badge-btn:hover { background: rgba(255, 255, 255, 0.16); }
.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.user-nickname {
  flex: 1;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

注意:UserBadge 背景色按 App.vue 侧栏实际底色微调(浅色侧栏则把 `rgba(255,255,255,...)` 换成 `rgba(0,0,0,0.04)`/`0.08`,昵称颜色继承侧栏文字色)。

- [ ] **Step 3: 挂载到 App.vue 并联动计划列表**

1. `<script setup>` 区新增 import:

```typescript
import UserBadge from '@/components/UserBadge.vue'
import { AUTH_UPDATED_EVENT } from '@/stores/auth'
```

2. 侧栏模板(desktop sidebar 根元素内部末尾、语言切换下拉附近)插入 `<UserBadge />`;移动端 topbar 右侧同样插入 `<UserBadge />`(具体插入点以现场 DOM 结构为准:侧栏纵向 flex 的最后一个子元素,必要时给外层加 `margin-top: auto` 使其贴底)。
3. 监听登录态变化刷新历史列表 —— App.vue 中已有挂载/卸载生命周期(它监听 PLANS_UPDATED_EVENT 等),同处新增:

```typescript
const onAuthUpdated = () => { refreshPlans() }
// onMounted 内: window.addEventListener(AUTH_UPDATED_EVENT, onAuthUpdated)
// onUnmounted 内: window.removeEventListener(AUTH_UPDATED_EVENT, onAuthUpdated)
```

(`refreshPlans` 若未在 App.vue 中 import,则从 `@/stores/plans` 补 import;历史接口已按 X-User-Id 过滤,刷新即生效。)

- [ ] **Step 4: ChatHome 本地任务按用户隔离**

`frontend/src/views/ChatHome.vue`:找到 `'tripstar.active_task'` 常量定义(探索确认存在,形如 `const ACTIVE_TASK_STORAGE_KEY = 'tripstar.active_task'`),替换为按用户命名空间的函数,并把所有 `ACTIVE_TASK_STORAGE_KEY` 读写点改为调用该函数:

```typescript
import { currentUser } from '@/stores/auth'

const activeTaskStorageKey = (): string => {
  const uid = currentUser.value?.user_id || 'anonymous'
  return `tripstar.active_task.${uid}`
}
```

(读写示例:`localStorage.getItem(activeTaskStorageKey())` / `localStorage.setItem(activeTaskStorageKey(), ...)` / `localStorage.removeItem(activeTaskStorageKey())`;若常量在多个文件出现,以 `command grep -rn "tripstar.active_task" frontend/src` 结果为准逐一替换。)

- [ ] **Step 5: i18n 文案**

三个 locale 顶层新增 `user` 对象:

```jsonc
// zh.json
"user": {
  "myMemories": "我的记忆",
  "switchUser": "切换用户",
  "memoriesTitle": "AI 记住了你的这些偏好",
  "memoriesEmpty": "陪我聊聊旅行,我会慢慢记住你的喜好",
  "memoryDelete": "删除",
  "memoryDeleted": "已删除",
  "memoryDeleteFailed": "删除失败,请重试"
}
// en.json
"user": {
  "myMemories": "My memories",
  "switchUser": "Switch user",
  "memoriesTitle": "What the AI remembers about you",
  "memoriesEmpty": "Chat with me about travel and I'll learn your tastes",
  "memoryDelete": "Delete",
  "memoryDeleted": "Deleted",
  "memoryDeleteFailed": "Delete failed, please retry"
}
// ja.json
"user": {
  "myMemories": "わたしの記憶",
  "switchUser": "ユーザー切替",
  "memoriesTitle": "AIが覚えているあなたの好み",
  "memoriesEmpty": "旅の話をすると、少しずつ好みを覚えていきます",
  "memoryDelete": "削除",
  "memoryDeleted": "削除しました",
  "memoryDeleteFailed": "削除に失敗しました"
}
```

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npx vite build`
Expected: 构建成功

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/UserBadge.vue frontend/src/components/MemoryModal.vue frontend/src/App.vue frontend/src/views/ChatHome.vue frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json
git commit -m "feat(auth): sidebar user badge, memory viewer modal and per-user task scope"
```

---

### Task 10: 全量验证与收尾

**Files:**
- 无新文件;验证 + 可能的小修复

- [ ] **Step 1: 后端全量测试**

```bash
cd backend && .venv/bin/python -m unittest discover -s app -p "*_test.py" -v
```
Expected: 全部 PASS

- [ ] **Step 2: 后端启动冒烟(无 LLM Key 也应能起服务)**

```bash
cd backend && timeout 15 .venv/bin/python -c "
import asyncio
from fastapi.testclient import TestClient
from app.api.main import app
client = TestClient(app)
print(client.get('/health').json())
print(client.post('/api/auth/login', json={'nickname': '冒烟测试'}).json())
print(client.get('/api/trip/history', headers={'X-User-Id': 'nonexist'}).json())
"
```
Expected: 三行 JSON 正常输出;`history` 为空列表;无异常栈

- [ ] **Step 3: 前端类型检查 + 构建**

```bash
cd frontend && npx vue-tsc --noEmit && npx vite build
```
Expected: 类型检查与构建均通过(若 vue-tsc 暴露的是本改动无关的历史类型错误,记录但不修;本改动引入的类型错误必须修复)

- [ ] **Step 4: 手动验收清单(需要真实 LLM Key,记录结果)**

1. `cd backend && .venv/bin/python run.py` + `cd frontend && npm run dev`。
2. 打开前端 → 自动跳 /login → 输入昵称"验收A"进入 → 侧栏底部出现用户徽章。
3. 对话:"我特别喜欢自然风光,不爱逛博物馆" → 收到回应;稍候点开"我的记忆"应出现偏好条目(mem0 异步提取,可能延迟数秒;若中转不支持 embeddings,后端日志出现"mem0 初始化失败"且主流程不受影响 —— 记录该降级)。
4. 对话:"给我推荐个周末去处" → 推荐理由应体现"自然风光"偏好。
5. 生成一次行程(确认草稿 → 生成)→ 进度条各阶段正常 → 行程页正常。
6. 侧栏"切换用户" → 登录"验收B" → 历史列表为空、记忆为空。
7. 重新登录"验收A" → 历史与记忆恢复。

- [ ] **Step 5: 提交收尾(如有修复)并汇总**

```bash
git add -A && git commit -m "chore: final fixes from full verification" # 仅当有修复时
git log --oneline feat/youban-chat-redesign -15
```

## Self-Review 记录

- **Spec 覆盖**:昵称登录(Task 1/2/8)、用户区分(Task 3/9)、LangGraph 替换(Task 4/5/6)、mem0 每用户记忆(Task 7)、记忆推荐注入(Task 7 的 parse 注入 + Task 6 的 load_memories)、记忆查看(Task 7 端点 + Task 9 Modal)、配置热更新联动(Task 7 admin reset)、非目标未越界。✓
- **占位符**:Task 6 中 `PLANNER_AGENT_PROMPT`/`_build_planner_query` 标注"原文平移,零改动 + 单点插入",是明确的搬移指令而非 TBD。✓
- **类型一致性**:`recall_sync`/`remember_background` 在 Task 6(消费,带 try/except 保护先行)与 Task 7(定义)命名一致;`getStoredUser`/`setStoredUser` 在 Task 8 内自洽;`AUTH_UPDATED_EVENT` Task 8 定义、Task 9 消费。✓
- **顺序风险**:Task 6 在 Task 7 之前引用 memory_service —— 已用局部 import + 异常吞并保护,Task 6 单独可测(测试打桩 `_recall_memory`)。✓
