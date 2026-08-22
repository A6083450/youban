import { relative, resolve } from "node:path";

type Disposition = "port" | "replace" | "retire";

interface Rule {
  disposition: Disposition;
  evidence: string;
  rationale: string;
}

const backendRoot = resolve(import.meta.dir, "../../backend");
const outputPath = resolve(import.meta.dir, "../tests/python-test-disposition.md");

function port(evidence: string, rationale: string): Rule {
  return { disposition: "port", evidence, rationale };
}

function replace(evidence: string, rationale: string): Rule {
  return { disposition: "replace", evidence, rationale };
}

function retire(rationale: string): Rule {
  return { disposition: "retire", evidence: "-", rationale };
}

const rules: Record<string, Rule> = {
  "app/agents/plan_parser_test.py": port("tests/plan-parser.test.ts", "JSON 修复链由 TS 纯函数逐类覆盖"),
  "app/agents/stream_json_test.py": port("tests/stream-json.test.ts", "增量字符串提取由 TS 前缀单调性测试覆盖"),
  "app/agents/trip_parallel_research_test.py": replace("tests/pi-trip-planner.test.ts", "研究预取与分段并发由确定性 Pi 编排器覆盖"),
  "app/agents/trip_plan_orchestrator_test.py": port("tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts", "分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移"),
  "app/agents/trip_responses_content_test.py": replace("tests/pi-llm-client.test.ts", "旧 Responses 内容块解析由 pi-ai 流式适配层替代"),
  "app/api/routes/admin_trips_endpoint_test.py": port("tests/admin-http.test.ts", "管理鉴权和跨用户列表 HTTP 契约已迁移"),
  "app/api/routes/auth_endpoint_test.py": port("tests/http-contract.test.ts", "登录、身份复用和校验 HTTP 契约已迁移"),
  "app/api/routes/trip_attractions_endpoint_test.py": port("tests/trip-attractions-http.test.ts", "可信 POI 行程项 CRUD 与联动更新已迁移"),
  "app/api/routes/trip_budget_items_endpoint_test.py": port("tests/budget-http.test.ts, tests/budget-guard.test.ts", "预算明细、口径、缓冲和权限契约已迁移"),
  "app/api/routes/trip_confirmation_endpoint_test.py": replace("tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts", "确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试"),
  "app/api/routes/trip_conversation_endpoint_test.py": replace("tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts", "会话、分享、所有权和历史读取按 TS 路由边界重组"),
  "app/api/routes/trip_history_filter_test.py": port("tests/http-contract.test.ts, tests/task-store.test.ts", "用户历史隔离和旧任务兼容已迁移"),
  "app/api/routes/trip_item_ids_test.py": replace("tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts", "稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖"),
  "app/api/routes/trip_item_status_endpoint_test.py": port("tests/trip-task-mutations-http.test.ts", "执行状态、所有权和持久化在统一 mutation 端点测试覆盖"),
  "app/api/routes/trip_retry_endpoint_test.py": port("tests/trip-planning-http.test.ts, tests/task-store.test.ts", "同 task_id 重试、状态限制和 checkpoint 恢复已迁移"),
  "app/api/routes/trip_stream_endpoint_test.py": port("tests/trip-assistant-http.test.ts", "parse/confirm SSE delta、final 和 DONE 契约已迁移"),
  "app/models/schemas_test.py": replace("tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs", "DTO 严格性与展示蓝图兼容分别在后端和前端边界验证"),
  "app/services/amap_service_test.py": port("tests/amap-research-sources.test.ts", "可信 POI、酒店、无 key 和上游故障降级已迁移"),
  "app/services/budget_guard_test.py": port("tests/budget-guard.test.ts", "预算上限、待报价缓冲和餐饮调整逐例迁移"),
  "app/services/budget_ledger_test.py": port("tests/budget-http.test.ts", "人数、房间、晚数、待报价和用户覆盖口径已迁移"),
  "app/services/chat_service_test.py": replace("tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts", "整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径"),
  "app/services/flyai_provider_test.py": retire("FlyAI 已按用户决策从 TS 配置、依赖和运行时删除"),
  "app/services/hotel_search_service_test.py": replace("tests/amap-research-sources.test.ts", "酒店来源统一为高德可信 POI，不推测价格"),
  "app/services/itinerary_scheduler_test.py": port("tests/itinerary-scheduler.test.ts, tests/pi-trip-planner.test.ts", "调度纯函数逐例迁移并接入最终计划"),
  "app/services/llm_service_test.py": replace("tests/pi-llm-client.test.ts", "旧 OpenAI SDK 封装由 pi-ai provider/stream 适配层替代"),
  "app/services/memory_service_test.py": replace("tests/hermes-memory-bridge.test.ts, tests/hermes-compatibility.test.ts, tests/auth-memory-http.test.ts", "mem0 适配由用户隔离的 pi-hermes-memory 双存储桥替代"),
  "app/services/trip_confirmation_test.py": port("tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts", "签名语义、数值归一、过期和单次消费已迁移"),
  "app/services/user_service_test.py": replace("tests/http-contract.test.ts, tests/task-store.test.ts", "用户持久化并入 SQLite users 表和 auth HTTP 契约"),
};

function specificRule(path: string, testName: string, fallback: Rule): Rule {
  if (path === "app/agents/langgraph_planner_test.py") {
    const graphOnly = /checkpoint_callback|future_returned|review_prompt|review_revises|does_not_review_again|invalidates_completed_summary|invalid_completed_summary|multiple_segment_revision/;
    if (graphOnly.test(testName)) return retire("LangGraph callback/revision-loop implementation no longer exists");
    return replace("tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts", "有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖");
  }
  if (path === "app/services/hotel_search_service_test.py" && /flyai/i.test(testName)) {
    return retire("FlyAI 酒店库存与补全链已删除；TS 仅接受高德可信酒店 POI");
  }
  return fallback;
}

const cases: Array<{ path: string; line: number; name: string; rule: Rule }> = [];
for await (const absolutePath of new Bun.Glob("app/**/*_test.py").scan({ cwd: backendRoot, absolute: true })) {
  const path = relative(backendRoot, absolutePath).replaceAll("\\", "/");
  const fallback = rules[path] ?? (path === "app/agents/langgraph_planner_test.py"
    ? replace("tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts", "LangGraph 被无图 Pi 编排器替代")
    : null);
  if (!fallback) throw new Error(`未映射 Python 测试文件: ${path}`);
  const lines = (await Bun.file(absolutePath).text()).split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = /^\s*(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/.exec(line);
    if (match) cases.push({ path, line: index + 1, name: match[1]!, rule: specificRule(path, match[1]!, fallback) });
  });
}
cases.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
if (cases.length !== 242) throw new Error(`Python 测试基线应为 242，实际为 ${cases.length}`);

const counts = cases.reduce((result, item) => {
  result[item.rule.disposition] += 1;
  return result;
}, { port: 0, replace: 0, retire: 0 });
const table = cases.map((item, index) => {
  const source = `${item.path}:${item.line}::${item.name}`;
  return `| ${index + 1} | \`${source}\` | \`${item.rule.disposition}\` | ${item.rule.evidence} | ${item.rule.rationale} |`;
}).join("\n");
const document = `# Python 242-Test Disposition\n\n`
  + `> 由 \`bun run scripts/generate-python-test-disposition.ts\` 生成。不要手工编辑。\n\n`
  + `基线：242/242 已处置；\`port=${counts.port}\`，\`replace=${counts.replace}\`，\`retire=${counts.retire}\`。\n\n`
  + `- \`port\`：业务行为与契约直接迁入 TypeScript 测试。\n`
  + `- \`replace\`：旧实现被新架构替代，等价风险由所列 TS 测试承担。\n`
  + `- \`retire\`：能力按已确认决策删除；必须给出删除理由。\n\n`
  + `| # | Python case | 处置 | TS 证据 | 理由 |\n`
  + `|---:|---|---|---|---|\n${table}\n`;

if (process.argv.includes("--check")) {
  const existing = await Bun.file(outputPath).text().catch(() => "");
  if (existing !== document) throw new Error("python-test-disposition.md 已过期，请重新生成");
} else {
  await Bun.write(outputPath, document);
  console.log(`wrote ${relative(process.cwd(), outputPath)} (${cases.length} cases)`);
}
