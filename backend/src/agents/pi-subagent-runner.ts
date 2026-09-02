import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { BROWSER_USER_AGENT, withThinkingSamplingParams } from "./llm/providers.ts";
import type { StructuredAgentRequest, StructuredAgentRunner } from "./pi-trip-planner.ts";
import {
  createYoubanAgentSession,
  type CreateYoubanAgentSessionOptions,
  type YoubanAgentSessionHost,
} from "./session-host.ts";
import { createBuiltinSkillCatalogSnapshot } from "./skill-registry.ts";
import type { SkillCatalogSnapshot } from "./skill-types.ts";
import type { SkillCatalogProvider } from "./skill-management-service.ts";
import { SkillRuntimeDiagnostics } from "./skill-runtime-diagnostics.ts";

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
    thinkingEnabled?: boolean;
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
          samplingParams: {
            thinking: { type: config.thinkingEnabled === true ? "enabled" : "disabled" },
          },
        }],
      },
    },
  }, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export interface PiSubagentRunnerOptions {
  cwd: string;
  runtimeDir: string;
  model: Model<Api>;
  subagentModel: string;
  apiKey?: string;
  timeoutMs?: number;
  thinkingEnabled?: boolean;
  skillCatalog?: SkillCatalogProvider;
  skillSnapshot?: SkillCatalogSnapshot;
  skillRuntimeDiagnostics?: SkillRuntimeDiagnostics;
  hostFactory?: (options: CreateYoubanAgentSessionOptions) => Promise<YoubanAgentSessionHost>;
}

interface RunnerHostState {
  host: YoubanAgentSessionHost;
  generation: number;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("旅行规划已取消");
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export class PiSubagentRunner implements StructuredAgentRunner {
  private hostState: RunnerHostState | undefined;
  private hostCreation: Promise<RunnerHostState> | undefined;
  private rotationPromise: Promise<void> | undefined;
  private rotationRecoveryPending = false;
  private activeRuns = 0;
  private readonly idleWaiters = new Set<() => void>();
  private releaseApiKey: (() => void) | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private readonly skillCatalog: SkillCatalogProvider;
  private readonly skillRuntimeDiagnostics: SkillRuntimeDiagnostics;

  constructor(private readonly options: PiSubagentRunnerOptions) {
    const fixedSnapshot = options.skillSnapshot ?? createBuiltinSkillCatalogSnapshot();
    this.skillCatalog = options.skillCatalog ?? {
      snapshot: () => fixedSnapshot,
      subscribe: () => () => {},
    };
    this.skillRuntimeDiagnostics = options.skillRuntimeDiagnostics ?? new SkillRuntimeDiagnostics();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Pi subagent runner is closed");
  }

  private sessionOptions(skillSnapshot: SkillCatalogSnapshot): CreateYoubanAgentSessionOptions {
    return {
      cwd: this.options.cwd,
      runtimeDir: this.options.runtimeDir,
      model: withThinkingSamplingParams(this.options.model, this.options.thinkingEnabled),
      subagentModel: this.options.subagentModel,
      skillSnapshot,
      tools: ["subagent"],
    };
  }

  private async createHost(skillSnapshot: SkillCatalogSnapshot): Promise<RunnerHostState> {
    if (!this.releaseApiKey && this.options.apiKey !== undefined) {
      this.releaseApiKey = acquirePiRuntimeApiKey(this.options.apiKey);
    }
    try {
      const sessionOptions = this.sessionOptions(skillSnapshot);
      const host = await (
        this.options.hostFactory?.(sessionOptions) ?? createYoubanAgentSession(sessionOptions)
      );
      return { host, generation: skillSnapshot.generation };
    } catch (error) {
      this.releaseApiKey?.();
      this.releaseApiKey = undefined;
      throw error;
    }
  }

  private async ensureHost(skillSnapshot: SkillCatalogSnapshot): Promise<RunnerHostState> {
    if (this.hostState) return this.hostState;
    if (!this.hostCreation) {
      const isRotationRecovery = this.rotationRecoveryPending;
      const creation = this.createHost(skillSnapshot)
        .then((state) => {
          this.hostState = state;
          if (isRotationRecovery) {
            this.rotationRecoveryPending = false;
            this.skillRuntimeDiagnostics.recordSuccess(
              "pi-subagent-runner",
              skillSnapshot.generation,
            );
          }
          return state;
        })
        .catch((error) => {
          if (isRotationRecovery) {
            this.skillRuntimeDiagnostics.recordFailure(
              "pi-subagent-runner",
              skillSnapshot.generation,
              "structured_host_rotation_failed",
            );
          }
          throw error;
        });
      this.hostCreation = creation;
      void creation.finally(() => {
        if (this.hostCreation === creation) this.hostCreation = undefined;
      }).catch(() => {});
    }
    return this.hostCreation;
  }

  private waitForIdle(signal?: AbortSignal): Promise<void> {
    if (this.activeRuns === 0) {
      return signal?.aborted ? Promise.reject(abortError(signal)) : Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.idleWaiters.delete(idle);
        signal?.removeEventListener("abort", abort);
      };
      const idle = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(abortError(signal!));
      };
      this.idleWaiters.add(idle);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  private releaseRun(): void {
    this.activeRuns -= 1;
    if (this.activeRuns !== 0) return;
    for (const waiter of [...this.idleWaiters]) waiter();
  }

  private disposeHost(): void {
    const state = this.hostState;
    if (!state) return;
    this.hostState = undefined;
    state.host.dispose();
  }

  private async rotate(skillSnapshot: SkillCatalogSnapshot): Promise<void> {
    if (this.rotationPromise) return this.rotationPromise;
    const rotation = (async () => {
      if (this.hostState?.generation === skillSnapshot.generation) return;
      this.disposeHost();
      try {
        const state = await this.createHost(skillSnapshot);
        this.hostState = state;
        this.rotationRecoveryPending = false;
        this.skillRuntimeDiagnostics.recordSuccess(
          "pi-subagent-runner",
          skillSnapshot.generation,
        );
      } catch (error) {
        this.rotationRecoveryPending = true;
        this.skillRuntimeDiagnostics.recordFailure(
          "pi-subagent-runner",
          skillSnapshot.generation,
          "structured_host_rotation_failed",
        );
        throw error;
      }
    })();
    this.rotationPromise = rotation;
    try {
      await rotation;
    } finally {
      if (this.rotationPromise === rotation) this.rotationPromise = undefined;
    }
  }

  private async acquireHost(signal: AbortSignal): Promise<RunnerHostState> {
    while (true) {
      this.assertOpen();
      if (signal.aborted) throw abortError(signal);
      if (this.rotationPromise) {
        await waitWithSignal(this.rotationPromise, signal);
        continue;
      }

      const creationSnapshot = this.skillCatalog.snapshot();
      const state = this.hostState ?? await waitWithSignal(this.ensureHost(creationSnapshot), signal);
      this.assertOpen();
      if (signal.aborted) throw abortError(signal);
      const admissionSnapshot = this.skillCatalog.snapshot();
      if (state.generation === admissionSnapshot.generation) {
        this.activeRuns += 1;
        return state;
      }

      await this.waitForIdle(signal);
      this.assertOpen();
      if (signal.aborted) throw abortError(signal);
      if (this.activeRuns > 0) continue;
      const rotationSnapshot = this.skillCatalog.snapshot();
      if (this.hostState?.generation === rotationSnapshot.generation) continue;
      await waitWithSignal(this.rotate(rotationSnapshot), signal);
    }
  }

  async run(request: StructuredAgentRequest): Promise<unknown> {
    if (request.signal.aborted) throw abortError(request.signal);
    const state = await this.acquireHost(request.signal);
    try {
      const identity = {
        requestId: crypto.randomUUID(),
        ownerRunId: crypto.randomUUID(),
        nodeId: request.nodeId,
      };
      const cancel = () => state.host.cancel(identity);
      request.signal.addEventListener("abort", cancel, { once: true });
      try {
        if (request.signal.aborted) {
          cancel();
          throw abortError(request.signal);
        }
        const response = await state.host.delegate({
          ...identity,
          agent: request.agent,
          task: [
            "Use only the following server-provided structured input.",
            "Return one value matching the requested JSON schema.",
            JSON.stringify(request.input),
          ].join("\n\n"),
          context: "fresh",
          cwd: this.options.cwd,
          thinking: this.options.thinkingEnabled === true ? "medium" : "off",
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
    } finally {
      this.releaseRun();
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await this.waitForIdle();
      await Promise.allSettled([
        this.rotationPromise ?? Promise.resolve(),
        this.hostCreation ?? Promise.resolve(),
      ]);
      this.disposeHost();
      this.releaseApiKey?.();
      this.releaseApiKey = undefined;
    })();
    return this.closePromise;
  }
}
