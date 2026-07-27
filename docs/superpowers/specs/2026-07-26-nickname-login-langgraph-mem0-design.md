# 昵称登录 + LangGraph 重构 + mem0 用户记忆 设计文档

日期:2026-07-26
状态:已定稿(后台自治会话,关键决策以合理默认值敲定,假设清单见文末)

## 1. 目标

1. **昵称即登录**:用户输入昵称即完成登录,同一昵称视为同一用户,系统以此区分用户。
2. **Agent 技术栈换成 LangGraph**:核心行程规划多智能体(现基于 `hello-agents` 的 SimpleAgent + MCP 文本协议)重写为 LangGraph StateGraph,彻底移除 `hello-agents` 依赖。
3. **mem0 每用户记忆**:集成开源 mem0(本地嵌入模式),按 user_id 隔离长期记忆。
4. **基于记忆的个性化推荐**:对话与规划的 LLM 提示词注入用户长期记忆,推荐目的地/生成行程时体现用户偏好。

### 非目标(YAGNI)

- 不做密码、JWT、OAuth 等真实鉴权 —— 昵称登录是"轻量身份区分",防君子不防小人;管理后台(/admin,密码登录)保持原样。
- 不做用户资料编辑、头像上传。
- 不引入 LangGraph checkpointer 持久化、token 级流式输出(现有 WebSocket 进度推送已满足)。
- 不迁移历史任务归属:旧任务(无 user_id)不出现在任何登录用户的历史列表中。

## 2. 方案对比与选择

### 2.1 登录形态

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 后端用户注册表(选定) | POST /api/auth/login {nickname} → 后端在 data/users.json 查/建用户,返回稳定 user_id;前端 localStorage 持久化 | user_id 稳定、可展示昵称、mem0 有唯一键;同昵称回归即找回记忆,正是"登录"语义 |
| B. 纯前端昵称即 ID | 昵称 slug 直接当 user_id,零后端 | 改昵称即丢记忆、无法列用户、规范化冲突难处理,弃 |

### 2.2 LangGraph 重构范围

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 规划器图化 + LLM 服务统一(选定) | `MultiAgentTripPlanner` 重写为 StateGraph;`llm_service` 改为 langchain ChatOpenAI + 原生 openai client;其余单轮 LLM 端点(parse/confirm-reply/景点提纯等)换用新 client,不强行套图 | 图用在真正有编排的地方;移除 hello-agents 与 MCP 子进程(`uvx amap-mcp-server`),天气/酒店直接走 `AmapService` REST,消灭脆弱的 `[TOOL_CALL:...]` 文本协议 |
| B. 所有 LLM 调用都建图 | parse 等单轮调用也做成小图 | 过度工程,弃 |
| C. 只换 planner,保留 hello-agents 的天气/酒店 agent | 依赖没移除,文本协议仍在 | 半吊子,弃 |

### 2.3 mem0 形态

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 开源 mem0ai 本地模式(选定) | LLM/embedder 复用项目的 OpenAI 兼容配置(`openai_base_url` 字段已确认支持);向量库用 mem0 自带 qdrant-client 的本地 path 模式;零外部服务 | 数据本地、与现有"第三方中转 + runtime_settings 热更新"体系一致 |
| B. mem0 Platform 托管 API | 需 MEM0_API_KEY,记忆数据出境 | 弃 |

依赖解析已验证(uv dry-run 无冲突):`langgraph 1.2.9`、`langchain-openai 1.4.1`、`mem0ai 2.0.14`(携带 qdrant-client);`openai` 升至 2.x;移除 `hello-agents[protocols]`。

## 3. 架构设计

### 3.1 用户与登录(后端)

**新文件 `app/services/user_service.py`**
- 存储:`data/users.json`,结构 `{"users": [{"user_id", "nickname", "created_at", "last_login_at"}]}`;`threading.Lock` + tmp 文件原子写。
- `login(nickname) -> User`:昵称 `strip()` 后非空、≤20 字符;按 `casefold()` 规范化查重 —— 命中即更新 last_login_at 返回(登录),未命中创建(`uuid4().hex[:8]` 作 user_id)。
- `get_user(user_id) -> User | None`。

**新文件 `app/api/routes/auth.py`**(注册到 main.py,prefix=/api)
- `POST /auth/login` `{nickname}` → `{success, user}`;非法昵称 422。
- `GET /auth/me`(Header `X-User-Id`)→ `{success, user}` / 404 —— 前端启动时校验本地会话有效性。
- `GET /auth/memories`(Header `X-User-Id`)→ `{items: [{id, memory, created_at}]}` —— "AI 记住了我什么"。
- `DELETE /auth/memories/{memory_id}`(Header `X-User-Id`,校验记忆归属)。

**用户身份传递**:前端在 `api.ts` 统一请求层注入 Header `X-User-Id`。后端在 `/trip/plan`、`/trip/parse`、`/trip/history`、`/chat/ask`、`/chat/edit`、`/auth/*` 读取(FastAPI `Header(default="")`,缺省不报错,保持向后兼容)。WebSocket 不校验(task_id 即凭证)。

**任务归属**:`/trip/plan` 把 user_id 写入任务状态与持久化 JSON;`/trip/history` 有 X-User-Id 时只返回该用户的任务,无 header 时只返回无主(legacy)任务。

### 3.2 LangGraph 规划器(后端)

**重写 `app/agents/trip_planner_agent.py`**,对外接口基本不变:`get_trip_planner_agent()` / `reset_trip_planner_agent()` 保留;`plan_trip` 签名扩展为 `plan_trip(request, progress_callback, user_id="") -> TripPlan`(`trip.py` 的 `_run_trip_planning` 把任务归属的 user_id 传入,供记忆读写)。

```
PlannerState(TypedDict):
  request_data: dict            # TripRequest dump
  memory_context: str           # 用户长期记忆文本
  attractions/weather/hotels: dict[str, str]   # city → 信息文本
  planner_output: str
  trip_plan: dict | None
  parse_error: str
  repair_attempts: int

ContextSchema(runtime context):progress_callback、user_id、language
```

图结构(全部 async 节点):

```
START → load_memories → fetch_attractions → fetch_weather → fetch_hotels
      → plan_itinerary → parse_plan ──(成功)→ save_memories → END
                              │(失败且 repair_attempts < 1)
                              └→ repair_plan → parse_plan(条件边循环)
                              │(仍失败)→ 抛 ValueError(沿用现有错误路径)
```

- `load_memories`:`memory_service.recall(user_id, 城市+偏好摘要)`,失败返回空串。
- `fetch_attractions`:逐城市 `asyncio.to_thread(search_amap_attractions, ...)`(现有函数,含 LLM 提纯);进度事件与现有 stage 名对齐(`attraction_search`)。
- `fetch_weather` / `fetch_hotels`:逐城市直调 `AmapService.get_weather` / `search_poi`(REST),不再经过 LLM agent 与 MCP;stage 名保持 `weather_search` / `hotel_search`,前端 WorkProgress 展示零改动。
- `plan_itinerary`:langchain `ChatOpenAI.ainvoke`(temperature 0.2,超时沿用 `TRIP_PLANNER_TIMEOUT`);提示词 = 现有 `PLANNER_AGENT_PROMPT` + `_build_planner_query`(保留),新增【用户偏好(长期记忆)】段;LangGraph `RetryPolicy(max_attempts=2)` 兜底超时重试。
- `parse_plan` / `repair_plan`:现有 ~500 行 JSON 容错修复管线整体抽到新文件 `app/agents/plan_parser.py`(纯函数化,保留全部策略:sanitize → 引号修复 → 截断修复 → 正则提取 → literal_eval → 错误引导 → LLM 修复)。
- `save_memories`:fire-and-forget 写入行程摘要记忆。
- 进度回调经 runtime context 传入,节点内 emit,百分比区间与现状一致(10→75 搜集、85 规划、95 图谱在 trip.py 保持不动)。

**重写 `app/services/llm_service.py`**(移除 HelloAgentsLLM):
- `get_llm_settings() -> {api_key, base_url, model, timeout}`(热更新实时读)。
- `get_openai_client() -> openai.OpenAI` 单例,带浏览器 UA header(保留反 WAF 逻辑)。
- `get_chat_model(**kwargs) -> ChatOpenAI`(langgraph 节点用,default_headers 同样带 UA)。
- `reset_llm()` 签名保留(settings 路由在用)。

**调用点迁移**(`llm._client.chat.completions.create` → `get_openai_client().chat.completions.create`):`trip.py` parse/confirm-reply、`amap_service.search_amap_attractions`、`xhs_service`、`plan_parser` 的 LLM 修复。`amap_service.py` 顶部的 `from hello_agents.tools import MCPTool` 与 `get_amap_mcp_tool()` 一并删除。

### 3.3 mem0 记忆服务(后端)

**新文件 `app/services/memory_service.py`**:

```python
config = {
  "llm":      {"provider": "openai", "config": {"model": <openai_model>, "api_key": <key>,
               "openai_base_url": <base_url>, "temperature": 0.1, "max_tokens": 2000}},
  "embedder": {"provider": "openai", "config": {"model": MEM0_EMBEDDING_MODEL 默认 text-embedding-3-small,
               "api_key": <key>, "openai_base_url": MEM0_EMBEDDING_BASE_URL 默认同 LLM}},
  "vector_store": {"provider": "qdrant", "config": {"collection_name": "tripstar_memories",
               "path": data/memory/qdrant, "on_disk": True,
               "embedding_model_dims": MEM0_EMBEDDING_DIMS 默认 1536}},
  "history_db_path": data/memory/history.db,
}
```

- `get_memory() -> Memory | None`:懒加载单例;初始化失败(未配 key、包缺失、embeddings 不可用)→ 记警告、返回 None,标记 failed 不反复重试。
- `async remember(user_id, messages, metadata=None)`:`asyncio.create_task(to_thread(mem0.add, ...))` fire-and-forget,异常只记日志。
- `async recall(user_id, query, limit=5) -> str`:`mem0.search` 结果格式化为提示词可用的要点列表;任何异常返回 ""。
- `list_memories(user_id)` / `delete_memory(memory_id, user_id)`:供 auth 路由。
- `reset_memory_service()`:settings 热更新时与 reset_llm 一起调用。

**铁律:记忆功能任何故障都不得阻塞或破坏主流程**(无 user_id 时全部跳过)。

### 3.4 记忆读写点与个性化推荐

| 场景 | 读(recall 注入) | 写(remember) |
|---|---|---|
| `/trip/parse`(游伴对话) | prompt 新增【用户长期记忆】段 + 推荐规则:优先符合偏好的目的地、避免重复推荐近期去过的城市、可自然引用记忆(如"你上次说喜欢海边") | 每轮把 user 消息 + assistant reply 交给 mem0 提取事实 |
| LangGraph 规划 | `load_memories` → 规划 prompt【用户偏好(长期记忆)】段(如口味、节奏、亲子) | 完成后写入"规划了 X 城市 N 天,偏好 Y"摘要(metadata: task_id) |
| `/chat/ask` `/chat/edit`(行程内对话) | system prompt 注入记忆段 | edit 产生 changes 时写入修改偏好 |
| `/trip/confirm-reply` | 不注入(纯意图判断,省 token) | 不写 |

“根据记忆推荐”的主落点是 `/trip/parse` 的 `action=recommend` 分支:LLM 拿到记忆后自然输出个性化目的地推荐。

### 3.5 前端

- **新文件 `src/stores/auth.ts`**(沿用模块级 ref store 惯例):`user = ref<UserInfo|null>`,初始化读 localStorage `tripstar.user`;`login(nickname)` 调 `/api/auth/login` 成功后写 storage;`logout()` 清除并跳 /login;启动时静默调 `/auth/me` 校验,失效则登出。
- **新文件 `src/views/LoginView.vue`**:居中卡片(品牌 + 一个昵称输入框 + 进入按钮,回车提交),风格与现有渐变/圆角体系一致;i18n(zh/en/ja)。
- **路由与守卫(main.ts)**:新增 `/login`;`router.beforeEach`:未登录且目标非 `/login`、非 `/admin*` → 重定向 `/login`;已登录访问 `/login` → 回 `/`。
- **`src/services/api.ts`**:统一请求层注入 Header `X-User-Id`;新增 `authLogin` / `authMe` / `getUserMemories` / `deleteUserMemory`。
- **`App.vue` 侧栏底部新增用户区**:圆形头像(昵称首字符)+ 昵称 + "我的记忆"入口 + 登出;移动端 topbar 同步;登录/登出后刷新 plans store(历史列表按用户变化)。
- **"我的记忆" Modal**(ant-design-vue Modal):列出 mem0 记忆条目,支持删除单条;空态文案"陪我聊聊旅行,我会慢慢记住你的喜好"。
- **ChatHome**:欢迎语带昵称;localStorage `tripstar.active_task` 改为按 user 命名空间(`tripstar.active_task.<user_id>`)避免切用户串任务。
- **类型**:`types/index.ts` 增加 `UserInfo`、记忆条目类型。

### 3.6 配置与部署

- `requirements.txt`:移除 `hello-agents[protocols]`;新增 `langgraph`、`langchain-openai`、`mem0ai`。
- 新数据落盘均在 data 卷内:`data/users.json`、`data/memory/`(远程 Docker 部署卷映射无需变化)。
- 可选环境变量:`MEM0_EMBEDDING_MODEL`、`MEM0_EMBEDDING_BASE_URL`、`MEM0_EMBEDDING_DIMS`(默认值见 3.3)。

## 4. 错误处理

- 昵称非法(空/超长):422 + 前端表单校验提示。
- `X-User-Id` 无效或缺失:业务端点不拒绝(向后兼容),仅跳过记忆与归属;`/auth/me` 404 触发前端登出。
- mem0 初始化/调用失败:降级为无记忆模式,规划与对话照常;日志警告一次。
- LangGraph 规划失败:错误路径与现状一致(任务 failed + 前端可重试);JSON 解析失败经 repair 循环仍失败时抛 `ValueError("行程 JSON 解析失败: ...")`,failed 响应落盘 debug 文件逻辑保留。

## 5. 测试策略

- 单测(沿用现有 `*_test.py` 风格):`user_service`(规范化/查重/并发写)、`plan_parser`(把现有 JSON 修复路径用固定样例覆盖:截断/单引号/算术表达式/尾逗号)、auth 端点(login/me/memories 降级)。
- 集成冒烟:mem0 不可用时 `/trip/parse` 正常返回;LangGraph 图 `ainvoke` 用打桩 LLM/amap 跑通全节点与 repair 循环。
- 构建验证:`backend/.venv` 装依赖后 `python -c "import app.api.main"`;前端 `npx vite build`。
- 手动验收:登录 A → 聊"我喜欢自然风光" → 生成一次行程 → 重开会话说"推荐个地方" → 推荐应引用偏好;登录 B → 历史为空、推荐无 A 的偏好。

## 6. 实施阶段(供 writing-plans 展开)

1. 后端基础:user_service + auth 路由 + trip 任务归属/历史过滤。
2. LLM 服务重写 + 各调用点迁移(此步后 hello-agents 仅剩 planner 引用)。
3. plan_parser 抽取 + LangGraph 规划器重写 + 移除 hello-agents 依赖。
4. memory_service + 各注入点/写入点 + auth 记忆端点。
5. 前端:auth store + LoginView + 守卫 + api 注入 + 侧栏用户区 + 记忆 Modal + i18n。
6. 测试 + 构建验证 + 文档。

## 7. 自主决策假设清单(后台会话,未逐条与用户确认)

1. 同昵称(casefold 后)= 同一用户,直接找回其记忆与历史 —— 无密码,存在冒用可能,视为产品接受项。
2. mem0 选开源本地模式(非 Platform);embedder 走与 LLM 相同的中转 base_url,默认 `text-embedding-3-small`;中转不支持 embeddings 时记忆功能自动降级停用。
3. 旧历史任务不迁移归属,登录用户历史从零开始。
4. `/trip/parse` 等单轮 LLM 调用不套 LangGraph 图,仅核心规划器图化。
5. 天气/酒店信息搜集由"LLM agent + MCP 工具"改为直调高德 REST(输出信息等价、更稳定),LLM 只负责行程规划本身。
