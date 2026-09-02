import { createHash } from "node:crypto";
import { parseJsonObject } from "./llm/plan-parser.ts";
import type { LlmClient } from "./llm/providers.ts";
import type { StructuredAgentRunner } from "./pi-trip-planner.ts";
import type { TripMemory } from "../services/hermes-memory.ts";
import type { ParentAgentScope, YoubanParentAgent } from "./persistent-parent-agent.ts";

export interface TripChatInput {
  message: string;
  trip_plan: Record<string, unknown>;
  history?: Array<{ role?: string; content?: string }>;
  revision?: string;
  user_id?: string;
  plan_id?: string;
}

export interface TripChatEditResult {
  success: true;
  reply: string;
  updated_plan: Record<string, unknown> | null;
  changes: string[];
  revision: string;
}

export class RevisionConflictError extends Error {}
export class UnsafePlanPatchError extends Error {}

interface TripChatServiceOptions {
  llm: LlmClient;
  agents?: StructuredAgentRunner;
  mode: "pi" | "simple";
  memory?: TripMemory;
  parentAgent?: YoubanParentAgent;
}

interface PatchOperation {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
}

const EDIT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    expected_revision: { type: "string" },
    patch: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { enum: ["add", "replace", "remove"] },
          path: { type: "string" },
          value: {},
        },
        required: ["op", "path"],
        additionalProperties: false,
      },
    },
    changes: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "expected_revision", "patch", "changes"],
  additionalProperties: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parentScope(input: TripChatInput): ParentAgentScope {
  const userId = String(input.user_id ?? "").trim();
  const planId = String(input.plan_id ?? "").trim();
  return {
    key: planId && userId
      ? `plan:${userId}:${planId}`
      : userId
        ? `user:${userId}`
        : `anonymous:${crypto.randomUUID()}`,
    userId,
    planId: planId || undefined,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonical(child)]));
}

export function planRevision(plan: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(plan))).digest("hex").slice(0, 16);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function decodePointer(path: string): string[] {
  if (!path.startsWith("/")) throw new UnsafePlanPatchError(`非法 patch 路径: ${path}`);
  const segments = path.slice(1).split("/").map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))) {
    throw new UnsafePlanPatchError(`非法 patch 路径: ${path}`);
  }
  return segments;
}

function allowedPath(path: string): boolean {
  return /^\/days\/\d+\/(description|transportation|accommodation|transfer_time)$/.test(path)
    || /^\/days\/\d+\/attractions(?:\/\d+(?:\/(name|poi_id|reason|duration|start_time|end_time|ticket_price|reservation_required|reservation_tips))?)?$/.test(path)
    || /^\/days\/\d+\/meals(?:\/\d+(?:\/(type|name|time|estimated_cost))?)?$/.test(path)
    || path === "/overall_suggestions"
    || /^\/blueprint(?:\/.*)?$/.test(path);
}

function applyOperation(target: Record<string, unknown>, operation: PatchOperation): void {
  if (!allowedPath(operation.path)) throw new UnsafePlanPatchError(`不允许修改字段: ${operation.path}`);
  const segments = decodePointer(operation.path);
  const leaf = segments.pop();
  if (!leaf) throw new UnsafePlanPatchError(`非法 patch 路径: ${operation.path}`);
  let parent: unknown = target;
  for (const segment of segments) {
    if (Array.isArray(parent)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        throw new UnsafePlanPatchError(`patch 数组索引越界: ${operation.path}`);
      }
      parent = parent[index];
    } else if (record(parent) && Object.hasOwn(parent, segment)) {
      parent = parent[segment];
    } else {
      throw new UnsafePlanPatchError(`patch 路径不存在: ${operation.path}`);
    }
  }
  if (Array.isArray(parent)) {
    const index = leaf === "-" ? parent.length : Number(leaf);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new UnsafePlanPatchError(`patch 数组索引越界: ${operation.path}`);
    }
    if (operation.op === "add") parent.splice(index, 0, structuredClone(operation.value));
    else if (operation.op === "remove" && index < parent.length) parent.splice(index, 1);
    else if (operation.op === "replace" && index < parent.length) parent[index] = structuredClone(operation.value);
    else throw new UnsafePlanPatchError(`patch 操作目标不存在: ${operation.path}`);
    return;
  }
  if (!record(parent)) throw new UnsafePlanPatchError(`patch 父节点无效: ${operation.path}`);
  if (operation.op === "remove") {
    if (!Object.hasOwn(parent, leaf)) throw new UnsafePlanPatchError(`patch 操作目标不存在: ${operation.path}`);
    delete parent[leaf];
  } else {
    if (operation.op === "replace" && !Object.hasOwn(parent, leaf)) {
      throw new UnsafePlanPatchError(`patch 操作目标不存在: ${operation.path}`);
    }
    parent[leaf] = structuredClone(operation.value);
  }
}

function validatePlan(updated: Record<string, unknown>, original: Record<string, unknown>): void {
  for (const field of ["city", "cities", "start_date", "end_date", "weather_info"]) {
    if (!same(updated[field], original[field])) throw new UnsafePlanPatchError(`不允许修改字段: ${field}`);
  }
  const originalDays = Array.isArray(original.days) ? original.days : [];
  const updatedDays = Array.isArray(updated.days) ? updated.days : [];
  if (updatedDays.length !== originalDays.length) throw new UnsafePlanPatchError("不允许增删行程天数");
  const trustedPoiIds = new Set(originalDays.flatMap((day) => {
    if (!record(day) || !Array.isArray(day.attractions)) return [];
    return day.attractions.flatMap((item) => record(item) ? [String(item.poi_id ?? "").trim()] : []).filter(Boolean);
  }));
  updatedDays.forEach((rawDay, index) => {
    const originalDay = originalDays[index];
    if (!record(rawDay) || !record(originalDay)) throw new UnsafePlanPatchError("行程天结构无效");
    for (const field of ["date", "day_index", "city", "is_transfer_day", "transfer_info", "hotel"]) {
      if (!same(rawDay[field], originalDay[field])) throw new UnsafePlanPatchError(`不允许修改 days.${index}.${field}`);
    }
    if (!Array.isArray(rawDay.attractions) || rawDay.attractions.length === 0) {
      throw new UnsafePlanPatchError("每天至少保留一个景点");
    }
    for (const attraction of rawDay.attractions) {
      const poiId = record(attraction) ? String(attraction.poi_id ?? "").trim() : "";
      if (!poiId || !trustedPoiIds.has(poiId)) throw new UnsafePlanPatchError(`景点未通过原计划候选验证: ${poiId}`);
    }
    if (!Array.isArray(rawDay.meals)) throw new UnsafePlanPatchError("餐饮结构无效");
  });
}

function parsePatchOutput(value: unknown, expectedRevision: string): {
  reply: string;
  patch: PatchOperation[];
  changes: string[];
} {
  if (!record(value)
    || String(value.expected_revision ?? "") !== expectedRevision
    || !Array.isArray(value.patch)
    || !Array.isArray(value.changes)) {
    throw new RevisionConflictError("行程版本已变化，请基于最新计划重试");
  }
  const patch = value.patch.map((raw): PatchOperation => {
    if (!record(raw) || !["add", "replace", "remove"].includes(String(raw.op)) || typeof raw.path !== "string") {
      throw new UnsafePlanPatchError("plan-editor patch 结构无效");
    }
    return { op: raw.op as PatchOperation["op"], path: raw.path, value: raw.value };
  });
  return {
    reply: String(value.reply ?? "").trim() || "好的。",
    patch,
    changes: value.changes.map(String).map((item) => item.trim()).filter(Boolean),
  };
}

export class TripChatService {
  constructor(private readonly options: TripChatServiceOptions) {}

  async ask(input: TripChatInput, signal?: AbortSignal): Promise<{ success: true; reply: string }> {
    let memory = "";
    try {
      memory = await this.options.memory?.recall(input.user_id ?? "", input.message) ?? "";
    } catch {
      memory = "";
    }
    const prompt = `你是游伴旅行助手。只根据当前计划回答，缺失事实必须明确说明未知。\n用户记忆：${memory || "(无)"}\n当前计划：${JSON.stringify(input.trip_plan)}\n最近对话：${JSON.stringify(input.history ?? [])}\n用户：${input.message}`;
    const reply = this.options.parentAgent
      ? await this.options.parentAgent.complete({ scope: parentScope(input), prompt, signal })
      : await this.options.llm.complete(prompt, { temperature: 0.4, maxTokens: 1_024, signal });
    return { success: true, reply: reply.trim() || "暂时没有可用回复。" };
  }

  async edit(input: TripChatInput, signal?: AbortSignal): Promise<TripChatEditResult> {
    const currentRevision = planRevision(input.trip_plan);
    if (input.revision && input.revision !== currentRevision) {
      throw new RevisionConflictError("行程版本已变化，请刷新后重试");
    }
    let memory = "";
    try {
      memory = await this.options.memory?.recall(input.user_id ?? "", input.message) ?? "";
    } catch {
      memory = "";
    }
    const agentInput = {
      message: input.message,
      trip_plan: input.trip_plan,
      history: input.history ?? [],
      expected_revision: currentRevision,
      user_memory: memory,
      constraints: "只能返回受限 patch；不得修改酒店、城市、日期、天气或引入未经验证的 POI。",
    };
    const agentRequest = {
        agent: "plan-editor",
        nodeId: `plan-edit:${crypto.randomUUID()}`,
        input: agentInput,
        schema: EDIT_SCHEMA,
        signal: signal ?? new AbortController().signal,
      } as const;
    const raw = this.options.mode === "pi"
      ? this.options.parentAgent
        ? await this.options.parentAgent.delegate(parentScope(input), agentRequest)
        : await this.options.agents!.run(agentRequest)
      : parseJsonObject(await this.options.llm.complete(
        `只输出符合以下契约的 JSON：${JSON.stringify(EDIT_SCHEMA)}\n输入：${JSON.stringify(agentInput)}`,
        { temperature: 0.1, maxTokens: 8_192, signal },
      ));
    const parsed = parsePatchOutput(raw, currentRevision);
    if (parsed.patch.length === 0) {
      await this.options.parentAgent?.recordExchange(parentScope(input), input.message, parsed.reply);
      return {
        success: true,
        reply: parsed.reply,
        updated_plan: null,
        changes: [],
        revision: currentRevision,
      };
    }
    const updated = structuredClone(input.trip_plan);
    for (const operation of parsed.patch) applyOperation(updated, operation);
    validatePlan(updated, input.trip_plan);
    if (input.user_id && parsed.changes.length > 0 && this.options.memory) {
      void this.options.memory.remember(
        input.user_id,
        `用户改单偏好：${input.message}\n已应用：${parsed.changes.join("；")}`,
      ).catch(() => false);
    }
    await this.options.parentAgent?.recordExchange(parentScope(input), input.message, parsed.reply);
    return {
      success: true,
      reply: parsed.reply,
      updated_plan: updated,
      changes: parsed.changes,
      revision: planRevision(updated),
    };
  }

  close(): void | Promise<void> {
    return this.options.agents?.close?.();
  }
}
