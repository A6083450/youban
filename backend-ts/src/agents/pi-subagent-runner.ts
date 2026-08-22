import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { BROWSER_USER_AGENT } from "./llm/providers.ts";
import type { StructuredAgentRequest, StructuredAgentRunner } from "./pi-trip-planner.ts";
import { createYoubanAgentSession, type YoubanAgentSessionHost } from "./session-host.ts";
import { createBuiltinSkillCatalogSnapshot } from "./skill-registry.ts";
import type { SkillCatalogSnapshot } from "./skill-types.ts";

export const PI_RUNTIME_API_KEY_ENV = "YOUBAN_PI_RUNTIME_API_KEY";

interface ApiKeyLease {
  value: string;
  count: number;
  previous: string | undefined;
}

let activeApiKeyLease: ApiKeyLease | undefined;

export function acquirePiRuntimeApiKey(value: string): () => void {
  if (activeApiKeyLease) {
    if (activeApiKeyLease.value !== value) {
      throw new Error("Pi runtime API key is already leased by another runtime");
    }
    activeApiKeyLease.count += 1;
  } else {
    activeApiKeyLease = {
      value,
      count: 1,
      previous: process.env[PI_RUNTIME_API_KEY_ENV],
    };
    process.env[PI_RUNTIME_API_KEY_ENV] = value;
  }
  let released = false;
  return () => {
    if (released || !activeApiKeyLease) return;
    released = true;
    activeApiKeyLease.count -= 1;
    if (activeApiKeyLease.count > 0) return;
    if (activeApiKeyLease.previous === undefined) delete process.env[PI_RUNTIME_API_KEY_ENV];
    else process.env[PI_RUNTIME_API_KEY_ENV] = activeApiKeyLease.previous;
    activeApiKeyLease = undefined;
  };
}

export function writeRuntimeModelConfig(
  runtimeDir: string,
  config: {
    baseUrl: string;
    model: string;
    apiStyle: "responses" | "completions";
  },
): string {
  const agentDir = join(runtimeDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const path = join(agentDir, "models.json");
  const api = config.apiStyle === "responses" ? "openai-responses" : "openai-completions";
  writeFileSync(path, JSON.stringify({
    providers: {
      "youban-runtime": {
        baseUrl: config.baseUrl.replace(/\/+$/, ""),
        api,
        apiKey: `$${PI_RUNTIME_API_KEY_ENV}`,
        headers: { "User-Agent": BROWSER_USER_AGENT },
        compat: api === "openai-completions" ? {
          supportsDeveloperRole: false,
          supportsReasoningEffort: config.model === "deepseek-v4-flash",
        } : undefined,
        models: [{
          id: config.model,
          reasoning: config.model === "deepseek-v4-flash",
        }],
      },
    },
  }, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

interface PiSubagentRunnerOptions {
  cwd: string;
  runtimeDir: string;
  model: Model<Api>;
  subagentModel: string;
  apiKey?: string;
  timeoutMs?: number;
  skillSnapshot?: SkillCatalogSnapshot;
  hostFactory?: () => Promise<YoubanAgentSessionHost>;
}

export class PiSubagentRunner implements StructuredAgentRunner {
  private hostPromise: Promise<YoubanAgentSessionHost> | undefined;
  private releaseApiKey: (() => void) | undefined;
  private closed = false;
  private readonly skillSnapshot: SkillCatalogSnapshot;

  constructor(private readonly options: PiSubagentRunnerOptions) {
    this.skillSnapshot = options.skillSnapshot ?? createBuiltinSkillCatalogSnapshot();
  }

  private host(): Promise<YoubanAgentSessionHost> {
    if (this.closed) return Promise.reject(new Error("Pi subagent runner is closed"));
    if (!this.hostPromise) {
      if (this.options.apiKey !== undefined) this.releaseApiKey = acquirePiRuntimeApiKey(this.options.apiKey);
      this.hostPromise = this.options.hostFactory?.() ?? createYoubanAgentSession({
        cwd: this.options.cwd,
        runtimeDir: this.options.runtimeDir,
        model: this.options.model,
        subagentModel: this.options.subagentModel,
        skillSnapshot: this.skillSnapshot,
        tools: ["subagent"],
      }).catch((error) => {
        this.releaseApiKey?.();
        this.releaseApiKey = undefined;
        throw error;
      });
    }
    return this.hostPromise;
  }

  async run(request: StructuredAgentRequest): Promise<unknown> {
    if (request.signal.aborted) throw request.signal.reason ?? new Error("旅行规划已取消");
    const host = await this.host();
    if (request.signal.aborted) throw request.signal.reason ?? new Error("旅行规划已取消");
    const identity = {
      requestId: crypto.randomUUID(),
      ownerRunId: crypto.randomUUID(),
      nodeId: request.nodeId,
    };
    const cancel = () => host.cancel(identity);
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (request.signal.aborted) {
        cancel();
        throw request.signal.reason ?? new Error("旅行规划已取消");
      }
      const response = await host.delegate({
        ...identity,
        agent: request.agent,
        task: [
          "Use only the following server-provided structured input.",
          "Return one value matching the requested JSON schema.",
          JSON.stringify(request.input),
        ].join("\n\n"),
        context: "fresh",
        cwd: this.options.cwd,
        thinking: "off",
        timeoutMs: this.options.timeoutMs ?? 120_000,
        turnBudget: { maxTurns: 1 },
        toolBudget: {
          hard: 0,
          block: ["read", "bash", "edit", "write", "grep", "find", "ls"],
        },
        skill: false,
        artifacts: false,
        result: { kind: "structured", schema: request.schema },
      });
      if (response.status !== "completed") {
        throw new Error(response.error || `子 Agent ${request.agent} 执行失败: ${response.status}`);
      }
      if (response.result?.kind !== "structured") {
        throw new Error(`子 Agent ${request.agent} 未返回结构化结果`);
      }
      return response.result.value;
    } finally {
      request.signal.removeEventListener("abort", cancel);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      (await this.hostPromise)?.dispose();
    } catch {
      // Initialization failures have already released the runtime lease.
    } finally {
      this.releaseApiKey?.();
      this.releaseApiKey = undefined;
    }
  }
}
