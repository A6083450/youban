# Bun 1.4 运行时性能优化设计

日期：2026-08-22

状态：已批准设计，待编写实施计划

## 背景

TypeScript 后端已经运行在 Bun 1.4.0，并使用 Elysia、标准 `ReadableStream`、`Bun.file`、SQLite/WAL、Pi SDK、`pi-subagents` 和持久化父 Agent 会话。现有实现已经获得 Bun 1.4 的基础运行时改进，但常驻父会话只增不减，SSE 客户端断开没有独立的流取消边界，服务关闭也没有等待 Bun 1.4 的异步 `server.stop()`。

本设计参考 [Bun 1.4 发布说明](https://bun.com/blog/bun-v1.4)，只采用能对应当前热路径并且可测量的新能力：`process.on("memoryPressure")`、原生 Stream 背压、可等待的服务关闭、Markdown CPU/Heap Profile、Bun 原生 Playwright，以及选择性并行测试。

## 目标

1. 限制空闲 Pi 父 Agent 会话占用的常驻内存，同时不打断正在执行或排队的请求。
2. 客户端终止 SSE 后尽快取消对应的模型或 Agent 工作，避免继续消耗 CPU、内存和上游额度。
3. 关闭服务时先停止接收请求，再等待运行中请求，最后释放规划器、Agent 会话和 SQLite 资源。
4. 用 Bun 1.4 的 Markdown Profile 和现有 Pi benchmark 建立可复现的本地性能证据。
5. 本地开发和全部验收直接运行 Bun，不依赖 Docker。

## 非目标

- 不启用实验性 HTTP/3 或实验性 HTTP/2/3 `fetch`。
- 不为没有现存图像处理热路径的代码引入 `Bun.Image`。
- 不把业务持久化格式改成 JSONL；SQLite 继续是业务真相源。
- 不改动 30 天行程的业务编排拓扑，也不把本地 mock benchmark 宣称为真实模型 SLA。
- 不在本地验收流程中构建或启动容器。生产镜像检查属于独立部署步骤。

## 方案选择

采用“运行时优先、工具链跟进”的方案：先解决常驻会话、断流取消和关闭顺序，再通过 Profile 和测试计时验证效果。仅做工具链优化不能改善生产常驻内存；全面套用 Bun 1.4 API 会增加无关改造和实验性风险。

## 设计

### 1. 有界父 Agent 会话池

`PersistentPiParentAgent` 继续按用户或计划作用域复用 Pi 会话，但每个条目增加以下元数据：

- `lastUsedAt`：最近一次操作完成时间。
- `queuedOperations`：正在执行或等待同一作用域串行锁的操作数。
- `persistent`：是否计入常驻池；超过软上限时创建的条目为临时会话。

默认参数：

- `pi_parent_session_limit = 64`
- `pi_parent_session_idle_seconds = 1800`
- 清扫周期 60 秒，计时器调用 `unref()`，不阻止进程退出。

两个参数加入运行时配置和对应环境变量 `PI_PARENT_SESSION_LIMIT`、`PI_PARENT_SESSION_IDLE_SECONDS`。有效范围分别为 `1..1024` 和 `60..86400`；非法运行时覆盖被忽略并回退到环境变量或默认值。

回收规则：

1. 只有 `queuedOperations === 0` 的条目可以被回收。
2. 周期清扫回收超过空闲时间的条目，再按最久未使用顺序将常驻条目压到软上限以内。
3. 创建新作用域前先执行一次同样的空闲回收。
4. 达到软上限且没有可回收条目时，不拒绝请求；创建临时会话。临时会话在存活期间仍按 scope 放入同一索引，因此并发到达的同 scope 操作继续复用同一会话并串行执行；其排队操作全部完成后才从索引移除并释放。
5. 会话释放只 dispose 内存中的 SDK 宿主，不删除 `DATA_DIR` 中的 transcript。后续访问同一作用域时，由 `SessionManager` 恢复原会话文件。
6. `close()` 停止清扫计时器，等待所有会话创建 Promise settled，然后 dispose 全部宿主并释放运行时 API key。

会话池暴露一个只读快照，用于测试和结构化日志：常驻数、临时数、忙碌数和本次回收数。它不是新的公共 HTTP API。

### 2. Bun 内存压力处理

进程入口只注册一个 `process.on("memoryPressure")` 监听器，避免每个测试 runtime 或服务重载重复注册。监听器调用 `runtime.releaseIdleResources("memory-pressure")`：

- 立即回收所有空闲父 Agent 会话，不等待空闲 TTL。
- 不回收忙碌或有排队操作的会话。
- 不清空 `SqliteTaskStore`，因为它当前承担同步读取、订阅和恢复语义，不能把核心业务状态当作无关缓存释放。
- 输出一条结构化日志，包含压力等级和回收前后会话计数，不输出用户、计划、prompt 或 API key。

关闭时移除该监听器。测试通过显式调用 `releaseIdleResources()` 覆盖行为，不伪造操作系统内存压力。

### 3. SSE 取消与背压

保留标准 `ReadableStream` Response，让 Bun 1.4 的原生 Stream 和 `Bun.serve()` 背压处理负责网络写入，不引入实验性协议或自定义缓冲器。

`sseResponse` 为每条流创建内部 `AbortController`，并向执行函数传递由以下信号合成的 `AbortSignal`：

- 原始 HTTP request 的 signal；
- `ReadableStream.cancel()` 触发的 signal；
- 服务 runtime 的全局关闭 signal。

所有流式 parse、confirm 和 edit 路由只使用该合成信号。正常完成及业务错误继续保持现有帧协议：`delta`、`final` 或 `error`，最后 `[DONE]`。客户端取消后不再 enqueue `error` 或 `[DONE]`，也不再触碰已经关闭的 controller；取消信号继续传到 Pi session、子 Agent 和上游 LLM。

本轮不宣称模型事件生产端具备可暂停背压。Bun 1.4 负责响应写入背压，本项目负责断开即取消和禁止无界的应用层重放缓存。

### 4. 优雅关闭

`SIGTERM` 和 `SIGINT` 共用一次性关闭流程：

1. 设置 stopping 标记，拒绝重复关闭。
2. `await server.stop(false)`，停止接收新连接并等待 Bun 管理的在途请求。
3. `await runtime.close()`，触发全局 abort，等待 `activeRuns`，再关闭 planner、chat service、父 Agent 和 SQLite repository。
4. 设置非零 `process.exitCode` 仅用于关闭异常；正常关闭不直接 `process.exit(0)`，让 Bun 在资源释放后自然退出。

关闭流程设置 30 秒保护超时。超时记录仍未完成的资源类别，然后对当前服务进程执行 `process.exit(1)`，让进程管理器明确识别异常关闭；不使用强制递归终止子进程的宽泛命令。

### 5. 性能证据与测试工具链

后端新增直接运行的脚本：

```sh
bun run bench:pi-subagents
bun --cpu-prof-md --cpu-prof-dir=profiles scripts/benchmark-pi-subagents.ts
bun --heap-prof-md --heap-prof-dir=profiles scripts/benchmark-pi-subagents.ts
```

`backend-ts/profiles/` 加入 gitignore。Profile 产物用于本地比较，不提交仓库；benchmark 报告保留原始样本、冷启动、warm p50/p95 和运行时版本。

测试并行采用验证后启用策略：

1. 保留 `bun test` 作为稳定基线。
2. 增加 `bun test --parallel=4 --isolate --timings=tests/timings.json --update-timings` 候选命令。
3. 候选命令连续运行三次，必须全部通过且相对串行中位数至少缩短 20%，才替换默认后端测试命令；否则只保留为可选脚本。
4. `timings.json` 可提交，用于稳定分配慢测试文件；不得包含环境变量或业务数据。
5. 前端 Playwright 改为通过 `bunx playwright test --workers=1` 执行，`webServer.command` 改成 `bun run dev -- --host 127.0.0.1 --port 4173 --strictPort`。
6. E2E 继续单 worker，避免共享用户、端口和计划 fixture 发生竞态。

## 错误处理

- 单个会话 dispose 失败不阻止其他会话回收；聚合结果写入结构化错误日志。
- 会话创建失败必须从池中移除，后续请求可重试，不缓存 rejected Promise。
- SSE 取消被视为正常结束，不返回 500；真正的业务异常仍输出 `error` 帧和 `[DONE]`。
- `memoryPressure` 回收失败不能使进程崩溃，也不能关闭忙碌会话。
- 关闭阶段聚合资源错误，在全部清理尝试结束后统一设置退出码。

## 测试设计

### 会话池

- 相同 scope 复用同一 session 文件。
- 超过 TTL 的空闲会话被回收，忙碌和排队会话不回收。
- 软上限内使用常驻会话；上限全部忙碌时使用临时会话，完成后释放。
- memory pressure 立即回收所有空闲会话。
- 创建失败不污染池，close 幂等并清除计时器和 API key 租约。

时间、session factory 和清扫调度通过小型内部依赖注入测试，避免真实等待 30 分钟。

### SSE 与关闭

- 正常流保持 `delta -> final -> [DONE]`。
- 业务异常保持 `error -> [DONE]`。
- 取消 reader 或 HTTP request 后，上游 signal 被 abort，且不再 enqueue 帧。
- 服务关闭等待在途请求和 runtime 资源释放，重复 signal 不执行第二次关闭。
- 现有 SSE、WebSocket、恢复和所有权契约测试必须继续通过。

### 本地验收

本地直接运行，不启动容器：

```sh
cd backend-ts
bun test
bun run typecheck
bun run audit:python-tests
bun run bench:pi-subagents

cd ../frontend
bun test src
bun run build
bun run test:e2e
```

完成条件：

- 新增会话池、内存压力、SSE 取消和关闭测试全部通过。
- 现有后端、前端与 E2E 契约无回归。
- Profile 能生成非空 Markdown；heap 报告包含非空的 retained-object 汇总，且 profile 运行期间 Pi session benchmark 正常完成。
- 空闲回收测试证明池可降到配置上限或零；忙碌请求不被回收。
- Pi mock benchmark 报告优化前后原始样本；本地结果只标注为快速验收，不替代真实模型 10 次 benchmark 或生产 soak。

## 预期改动边界

主要涉及：

- `backend-ts/src/agents/persistent-parent-agent.ts`
- `backend-ts/src/http/app.ts`
- `backend-ts/src/index.ts`
- `backend-ts/src/config/settings.ts`
- 对应 Bun 测试与 benchmark/package scripts
- `frontend/playwright.config.ts` 和 `frontend/package.json`
- `.gitignore`

不修改旧 Python 后端，不恢复 FlyAI，不改变 Pi SDK、`pi-subagents` 或 skills 的产品边界，也不改动生产部署配置。
