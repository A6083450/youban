import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { StructuredAgentRequest } from "./pi-trip-planner.ts";
import { acquirePiRuntimeApiKey } from "./pi-subagent-runner.ts";
import { createYoubanAgentSession, type YoubanAgentSessionHost } from "./session-host.ts";
import { APPROVED_SKILL_NAMES } from "./skill-registry.ts";

export interface ParentAgentScope {
  key: string;
  userId: string;
  planId?: string;
}

export interface ParentAgentCompletion {
  scope: ParentAgentScope;
  prompt: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void | Promise<void>;
}

export interface YoubanParentAgent {
  complete(input: ParentAgentCompletion): Promise<string>;
  delegate(scope: ParentAgentScope, request: StructuredAgentRequest): Promise<unknown>;
  recordExchange(scope: ParentAgentScope, user: string, assistant: string): Promise<void>;
  releaseIdleResources?(reason: ParentSessionReleaseReason): Promise<ParentSessionPoolSnapshot>;
  close(): Promise<void>;
}

export type ParentSessionReleaseReason = "ttl" | "limit" | "memory-pressure";

export interface ParentSessionPoolSnapshot {
  persistent: number;
  temporary: number;
  busy: number;
  evicted: number;
}

interface PersistentParentAgentOptions {
  cwd: string;
  runtimeDir: string;
  model: Model<Api>;
  subagentModel: string;
  apiKey?: string;
  timeoutMs?: number;
  sessionLimit?: number;
  sessionIdleMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  sessionFactory?: typeof createYoubanAgentSession;
  toolsForScope?: (scope: ParentAgentScope) => ToolDefinition[];
}

interface ParentSession {
  host: YoubanAgentSessionHost;
  tail: Promise<void>;
}

interface ParentSessionEntry {
  id: string;
  pending: Promise<ParentSession>;
  lastUsedAt: number;
  queuedOperations: number;
  persistent: boolean;
  disposing?: Promise<void>;
}

function scopeId(scope: ParentAgentScope): string {
  return createHash("sha256").update(scope.key).digest("hex").slice(0, 24);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("父 Agent 请求已取消");
}

export class PersistentPiParentAgent implements YoubanParentAgent {
  private readonly sessions = new Map<string, ParentSessionEntry>();
  private readonly sessionLimit: number;
  private readonly sessionIdleMs: number;
  private readonly now: () => number;
  private readonly sessionFactory: typeof createYoubanAgentSession;
  private readonly sweepTimer?: ReturnType<typeof setInterval>;
  private releaseApiKey: (() => void) | undefined;
  private closed = false;

  constructor(private readonly options: PersistentParentAgentOptions) {
    this.sessionLimit = options.sessionLimit ?? 64;
    this.sessionIdleMs = options.sessionIdleMs ?? 1_800_000;
    this.now = options.now ?? Date.now;
    this.sessionFactory = options.sessionFactory ?? createYoubanAgentSession;
    const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.releaseIdleResources("ttl");
      }, sweepIntervalMs);
      this.sweepTimer.unref?.();
    }
  }

  private beginDisposal(entry: ParentSessionEntry): Promise<void> {
    if (entry.disposing) return entry.disposing;
    if (this.sessions.get(entry.id) === entry) this.sessions.delete(entry.id);
    entry.disposing = (async () => {
      const session = await entry.pending.catch(() => undefined);
      if (!session) return;
      await session.tail.catch(() => {});
      session.host.dispose();
    })().catch((error) => {
      console.warn(`父 Agent 会话释放失败: ${error}`);
    });
    return entry.disposing;
  }

  private idleEntries(): ParentSessionEntry[] {
    return [...this.sessions.values()]
      .filter((entry) => entry.queuedOperations === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  }

  private startAdmissionCleanup(): void {
    const now = this.now();
    const expired = this.idleEntries().filter((entry) =>
      !entry.persistent || now - entry.lastUsedAt > this.sessionIdleMs
    );
    for (const entry of expired) void this.beginDisposal(entry);

    const persistentCount = () => [...this.sessions.values()].filter((entry) => entry.persistent).length;
    if (persistentCount() < this.sessionLimit) return;
    const oldestIdlePersistent = this.idleEntries().find((entry) => entry.persistent);
    if (oldestIdlePersistent) void this.beginDisposal(oldestIdlePersistent);
  }

  private sessionEntry(scope: ParentAgentScope): ParentSessionEntry {
    if (this.closed) throw new Error("Persistent Pi parent agent is closed");
    const id = scopeId(scope);
    const existing = this.sessions.get(id);
    if (existing) return existing;

    this.startAdmissionCleanup();
    if (!this.releaseApiKey && this.options.apiKey !== undefined) {
      this.releaseApiKey = acquirePiRuntimeApiKey(this.options.apiKey);
    }
    const customTools = this.options.toolsForScope?.(scope) ?? [];
    const entry = {} as ParentSessionEntry;
    const pending = this.sessionFactory({
        cwd: this.options.cwd,
        runtimeDir: this.options.runtimeDir,
        model: this.options.model,
        subagentModel: this.options.subagentModel,
        skillNames: APPROVED_SKILL_NAMES,
        tools: ["subagent", ...customTools.map((tool) => tool.name)],
        customTools,
        sessionDir: join(this.options.runtimeDir, "sessions", id),
      })
      .then((host) => ({ host, tail: Promise.resolve() }))
      .catch((error) => {
        if (this.sessions.get(id) === entry) this.sessions.delete(id);
        throw error;
      });
    const persistentCount = [...this.sessions.values()].filter((item) => item.persistent).length;
    Object.assign(entry, {
      id,
      pending,
      lastUsedAt: this.now(),
      queuedOperations: 0,
      persistent: persistentCount < this.sessionLimit,
    });
    this.sessions.set(id, entry);
    return entry;
  }

  private async serialized<T>(scope: ParentAgentScope, run: (host: YoubanAgentSessionHost) => Promise<T>): Promise<T> {
    const entry = this.sessionEntry(scope);
    entry.queuedOperations += 1;
    let release: (() => void) | undefined;
    try {
      const session = await entry.pending;
      const previous = session.tail;
      session.tail = new Promise<void>((resolve) => { release = resolve; });
      await previous.catch(() => {});
      return await run(session.host);
    } finally {
      release?.();
      entry.queuedOperations -= 1;
      entry.lastUsedAt = this.now();
      if (!entry.persistent && entry.queuedOperations === 0) await this.beginDisposal(entry);
    }
  }

  complete(input: ParentAgentCompletion): Promise<string> {
    return this.serialized(input.scope, async (host) => {
      if (input.signal?.aborted) throw abortError(input.signal);
      const unsubscribe = host.session.subscribe((event) => {
        if (event.type !== "message_update" || event.assistantMessageEvent.type !== "text_delta") return;
        const delta = event.assistantMessageEvent.delta;
        if (delta) void input.onDelta?.(delta);
      });
      const abort = () => { void host.session.abort(); };
      input.signal?.addEventListener("abort", abort, { once: true });
      try {
        if (input.signal?.aborted) throw abortError(input.signal);
        await host.session.prompt(input.prompt, { expandPromptTemplates: false });
        if (input.signal?.aborted) throw abortError(input.signal);
        return host.session.getLastAssistantText()?.trim() ?? "";
      } finally {
        input.signal?.removeEventListener("abort", abort);
        unsubscribe();
      }
    });
  }

  delegate(scope: ParentAgentScope, request: StructuredAgentRequest): Promise<unknown> {
    return this.serialized(scope, async (host) => {
      if (request.signal.aborted) throw abortError(request.signal);
      const identity = {
        requestId: crypto.randomUUID(),
        ownerRunId: `parent:${scopeId(scope)}`,
        nodeId: request.nodeId,
      };
      const cancel = () => host.cancel(identity);
      request.signal.addEventListener("abort", cancel, { once: true });
      try {
        if (request.signal.aborted) throw abortError(request.signal);
        const response = await host.delegate({
          ...identity,
          agent: request.agent,
          task: `Use only this server-provided JSON input and return the required structured value.\n\n${JSON.stringify(request.input)}`,
          context: "fresh",
          cwd: this.options.cwd,
          thinking: "off",
          timeoutMs: this.options.timeoutMs ?? 120_000,
          turnBudget: { maxTurns: 1 },
          toolBudget: { hard: 0, block: ["read", "bash", "edit", "write", "grep", "find", "ls"] },
          skill: false,
          artifacts: false,
          result: { kind: "structured", schema: request.schema },
        });
        if (response.status !== "completed" || response.result?.kind !== "structured") {
          throw new Error(response.error || `父会话子 Agent 执行失败: ${response.status}`);
        }
        return response.result.value;
      } finally {
        request.signal.removeEventListener("abort", cancel);
      }
    });
  }

  recordExchange(scope: ParentAgentScope, user: string, assistant: string): Promise<void> {
    return this.serialized(scope, (host) => host.session.sendCustomMessage({
      customType: "youban_exchange",
      content: JSON.stringify({ user, assistant }),
      display: false,
      details: { scope: scope.key },
    }, { triggerTurn: false }));
  }

  async inspect(scope: ParentAgentScope): Promise<{ sessionFile?: string; tools: string[]; systemPrompt: string }> {
    return this.serialized(scope, async (host) => ({
      sessionFile: host.session.sessionFile,
      tools: host.session.getActiveToolNames(),
      systemPrompt: host.session.systemPrompt,
    }));
  }

  async releaseIdleResources(reason: ParentSessionReleaseReason): Promise<ParentSessionPoolSnapshot> {
    const now = this.now();
    const idle = this.idleEntries();
    let selected: ParentSessionEntry[];
    if (reason === "memory-pressure") {
      selected = idle;
    } else if (reason === "ttl") {
      selected = idle.filter((entry) =>
        !entry.persistent || now - entry.lastUsedAt > this.sessionIdleMs
      );
    } else {
      const overflow = Math.max(
        0,
        [...this.sessions.values()].filter((entry) => entry.persistent).length - this.sessionLimit,
      );
      selected = idle.filter((entry) => !entry.persistent);
      selected.push(...idle.filter((entry) => entry.persistent).slice(0, overflow));
    }
    await Promise.allSettled(selected.map((entry) => this.beginDisposal(entry)));
    const remaining = [...this.sessions.values()];
    return {
      persistent: remaining.filter((entry) => entry.persistent).length,
      temporary: remaining.filter((entry) => !entry.persistent).length,
      busy: remaining.filter((entry) => entry.queuedOperations > 0).length,
      evicted: selected.length,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    const entries = [...this.sessions.values()];
    await Promise.allSettled(entries.map((entry) => this.beginDisposal(entry)));
    this.releaseApiKey?.();
    this.releaseApiKey = undefined;
  }
}
