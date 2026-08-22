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
  close(): Promise<void>;
}

interface PersistentParentAgentOptions {
  cwd: string;
  runtimeDir: string;
  model: Model<Api>;
  subagentModel: string;
  apiKey?: string;
  timeoutMs?: number;
  toolsForScope?: (scope: ParentAgentScope) => ToolDefinition[];
}

interface ParentSession {
  host: YoubanAgentSessionHost;
  tail: Promise<void>;
}

function scopeId(scope: ParentAgentScope): string {
  return createHash("sha256").update(scope.key).digest("hex").slice(0, 24);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("父 Agent 请求已取消");
}

export class PersistentPiParentAgent implements YoubanParentAgent {
  private readonly sessions = new Map<string, Promise<ParentSession>>();
  private releaseApiKey: (() => void) | undefined;
  private closed = false;

  constructor(private readonly options: PersistentParentAgentOptions) {}

  private session(scope: ParentAgentScope): Promise<ParentSession> {
    if (this.closed) return Promise.reject(new Error("Persistent Pi parent agent is closed"));
    const id = scopeId(scope);
    let pending = this.sessions.get(id);
    if (!pending) {
      if (!this.releaseApiKey && this.options.apiKey !== undefined) {
        this.releaseApiKey = acquirePiRuntimeApiKey(this.options.apiKey);
      }
      const customTools = this.options.toolsForScope?.(scope) ?? [];
      pending = createYoubanAgentSession({
        cwd: this.options.cwd,
        runtimeDir: this.options.runtimeDir,
        model: this.options.model,
        subagentModel: this.options.subagentModel,
        skillNames: APPROVED_SKILL_NAMES,
        tools: ["subagent", ...customTools.map((tool) => tool.name)],
        customTools,
        sessionDir: join(this.options.runtimeDir, "sessions", id),
      }).then((host) => ({ host, tail: Promise.resolve() }));
      this.sessions.set(id, pending);
    }
    return pending;
  }

  private async serialized<T>(scope: ParentAgentScope, run: (host: YoubanAgentSessionHost) => Promise<T>): Promise<T> {
    const session = await this.session(scope);
    const previous = session.tail;
    let release!: () => void;
    session.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      return await run(session.host);
    } finally {
      release();
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
    const { host } = await this.session(scope);
    return {
      sessionFile: host.session.sessionFile,
      tools: host.session.getActiveToolNames(),
      systemPrompt: host.session.systemPrompt,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sessions = await Promise.allSettled(this.sessions.values());
    for (const session of sessions) if (session.status === "fulfilled") session.value.host.dispose();
    this.sessions.clear();
    this.releaseApiKey?.();
    this.releaseApiKey = undefined;
  }
}
