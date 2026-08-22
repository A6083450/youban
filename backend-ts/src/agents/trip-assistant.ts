import { parseJsonObject } from "./llm/plan-parser.ts";
import type { LlmClient } from "./llm/providers.ts";
import { streamExtractStringField } from "./llm/stream-json.ts";
import { ConfirmationLedger } from "../domain/confirmation.ts";
import type { ParentAgentScope, YoubanParentAgent } from "./persistent-parent-agent.ts";

export interface ChatHistoryItem {
  role?: string;
  content?: string;
}

export interface ParseTripInput {
  text: string;
  language?: string;
  today?: string;
  history?: ChatHistoryItem[];
}

export interface ConfirmTripInput {
  text: string;
  draft?: Record<string, unknown>;
  language?: string;
  today?: string;
  history?: ChatHistoryItem[];
}

interface RunOptions {
  onDelta?: (text: string) => void | Promise<void>;
  signal?: AbortSignal;
  scope?: ParentAgentScope;
}

const ACTIONS = new Set(["plan", "clarify", "recommend", "chat"]);
const EMOTIONS = new Set(["neutral", "uncertain", "frustrated", "excited", "anxious"]);
const CONFIRM_ACTIONS = new Set(["confirm", "cancel", "update", "chat", "ask_confirmation"]);
const INFERRED_FIELDS = new Set([
  "dates",
  "transportation",
  "accommodation",
  "preferences",
  "traveler_count",
]);

function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseDate(value: unknown): Date | null {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text ? null : date;
}

function addDays(value: string, days: number): string {
  const date = parseDate(value) ?? new Date(`${todayString()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function safeInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, maximum)) : fallback;
}

function safeBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((entry) => entry.trim()).filter(Boolean) : [];
}

function historyText(history: ChatHistoryItem[] | undefined): string {
  const lines = (history ?? []).slice(-10).flatMap((item) => {
    const content = String(item?.content ?? "").trim().slice(0, 200);
    if (!content) return [];
    return [`${item.role === "user" ? "用户" : "游伴"}: ${content}`];
  });
  return lines.join("\n") || "(无对话历史)";
}

function languageFallback(language: string | undefined, kind: "parse" | "confirm"): string {
  const normalized = String(language ?? "").toLowerCase();
  if (kind === "confirm") {
    if (normalized.startsWith("en")) return "Would you like me to start planning from the current draft?";
    if (normalized.startsWith("ja")) return "現在の下書きで旅行プランの作成を開始しますか？";
    return "你是想按当前这份草稿开始生成计划吗？";
  }
  if (normalized.startsWith("en")) return "Would you prefer nature and scenery, or food and culture?";
  if (normalized.startsWith("ja")) return "自然や景色と、グルメや文化なら、どちらが気になりますか？";
  return "没问题，我可以直接帮你缩小范围。你更想看自然风光，还是逛吃和人文？";
}

function normalizeToday(value: unknown): string {
  return parseDate(value)?.toISOString().slice(0, 10) ?? todayString();
}

function normalizeCities(value: unknown, fallback: unknown = []): Array<{ city: string; days: number }> {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  return source.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const city = String(record.city ?? "").trim();
    return city ? [{ city, days: safeInteger(record.days, 3, 15) }] : [];
  });
}

export class TripAssistant {
  constructor(private readonly dependencies: {
    llm: LlmClient;
    ledger: ConfirmationLedger;
    parentAgent?: YoubanParentAgent;
  }) {}

  get ledger(): ConfirmationLedger {
    return this.dependencies.ledger;
  }

  private async jsonCall(
    prompt: string,
    field: string,
    options: RunOptions,
  ): Promise<Record<string, unknown>> {
    if (this.dependencies.parentAgent) {
      let buffer = "";
      let emitted = 0;
      const output = await this.dependencies.parentAgent.complete({
        scope: options.scope ?? { key: "anonymous", userId: "" },
        prompt,
        signal: options.signal,
        onDelta: options.onDelta ? async (chunk) => {
          buffer += chunk;
          const current = streamExtractStringField(buffer, field).value;
          if (current.length > emitted) {
            await options.onDelta!(current.slice(emitted));
            emitted = current.length;
          }
        } : undefined,
      });
      return parseJsonObject(output);
    }
    if (!options.onDelta) {
      return parseJsonObject(await this.dependencies.llm.complete(prompt, {
        temperature: 0.1,
        disableThinking: true,
        signal: options.signal,
      }));
    }
    let buffer = "";
    let emitted = 0;
    for await (const chunk of this.dependencies.llm.stream(prompt, {
      temperature: 0.1,
      disableThinking: true,
      signal: options.signal,
    })) {
      buffer += chunk;
      const current = streamExtractStringField(buffer, field).value;
      if (current.length > emitted) {
        await options.onDelta(current.slice(emitted));
        emitted = current.length;
      }
    }
    return parseJsonObject(buffer);
  }

  async parse(input: ParseTripInput, options: RunOptions = {}): Promise<Record<string, unknown>> {
    const today = normalizeToday(input.today);
    const tomorrow = addDays(today, 1);
    const fallback = languageFallback(input.language, "parse");
    const defaults = {
      success: true,
      action: "clarify",
      emotion: "neutral",
      reply: fallback,
      follow_up_question: "",
      recommendations: [],
      need_clarify: true,
      ready_to_generate: false,
      clarify_question: fallback,
      summary: "",
      trip: null,
    };
    const prompt = `你是游伴旅行智能体的需求理解模块。今天是 ${today}。
结合对话历史判断 action=plan|clarify|recommend|chat，并只输出严格 JSON。
对话历史：\n${historyText(input.history)}
字段包括 action, emotion, reply, follow_up_question, cities[{city,days}], start_date, end_date,
transportation, accommodation, traveler_count, room_count, budget_amount, budget_basis,
preferences, need_clarify, clarify_question, summary, ready_to_generate, suggestions,
inferred_fields, recommendations[{destination,reason,suggested_days}]。
未提日期用 ${tomorrow}；未提城市但要规划时 action=clarify；ready_to_generate 只表示字段完整度。
用户最新消息：${input.text}`;

    let data: Record<string, unknown>;
    try {
      data = await this.jsonCall(prompt, "reply", options);
    } catch {
      return defaults;
    }
    const action = ACTIONS.has(String(data.action)) ? String(data.action) : "clarify";
    const emotion = EMOTIONS.has(String(data.emotion)) ? String(data.emotion) : "neutral";
    const reply = String(data.reply ?? data.clarify_question ?? fallback).trim() || fallback;
    const recommendations = (Array.isArray(data.recommendations) ? data.recommendations : [])
      .slice(0, 4)
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        const destination = String(record.destination ?? "").trim();
        return destination ? [{
          destination,
          reason: String(record.reason ?? "").trim(),
          suggested_days: safeInteger(record.suggested_days, 3, 15),
        }] : [];
      });
    if (action !== "plan") {
      return {
        success: true,
        action,
        emotion,
        reply,
        follow_up_question: String(data.follow_up_question ?? "").trim(),
        recommendations,
        need_clarify: action === "clarify" || action === "recommend",
        ready_to_generate: false,
        clarify_question: reply,
        summary: "",
        trip: null,
      };
    }

    const cities = normalizeCities(data.cities);
    if (cities.length === 0) return { ...defaults, emotion, reply, clarify_question: reply };
    const startDate = parseDate(data.start_date)?.toISOString().slice(0, 10) ?? tomorrow;
    const travelDays = Math.min(cities.reduce((total, city) => total + city.days, 0), 30);
    const endDate = addDays(startDate, travelDays - 1);
    const ready = data.ready_to_generate === true;
    const travelerCount = safeInteger(data.traveler_count, 1, 50);
    const roomCount = safeInteger(data.room_count, Math.ceil(travelerCount / 2), 50);
    const inferred = ready ? [] : strings(data.inferred_fields).filter((field) => INFERRED_FIELDS.has(field));
    const suggestions = ready ? [] : strings(data.suggestions).slice(0, 4);
    const budgetBasis = data.budget_basis === "per_person" ? "per_person" : "group_total";
    return {
      success: true,
      action: "plan",
      emotion,
      reply,
      follow_up_question: String(data.follow_up_question ?? "").trim(),
      recommendations,
      need_clarify: false,
      ready_to_generate: ready,
      clarify_question: String(data.clarify_question ?? reply),
      summary: String(data.summary ?? ""),
      trip: {
        city: cities[0]!.city,
        cities,
        start_date: startDate,
        end_date: endDate,
        travel_days: travelDays,
        transportation: String(data.transportation ?? "公共交通"),
        accommodation: String(data.accommodation ?? "经济型酒店"),
        traveler_count: travelerCount,
        room_count: roomCount,
        budget_amount: safeBudget(data.budget_amount),
        budget_basis: budgetBasis,
        preferences: strings(data.preferences),
        free_text_input: input.text,
        origin_text: input.text,
        inferred_fields: inferred,
        suggestions,
      },
    };
  }

  async confirm(input: ConfirmTripInput, options: RunOptions = {}): Promise<Record<string, unknown>> {
    const today = normalizeToday(input.today);
    const draft = input.draft ?? {};
    const language = String(input.language ?? "").trim().replaceAll("_", "-");
    const fallback = languageFallback(language, "confirm");
    const prompt = `你是旅行规划助手的意图判断模块。今天是 ${today}。
当前草稿：${JSON.stringify(draft)}
最近对话：\n${historyText(input.history)}
只输出严格 JSON，action=confirm|update|cancel|chat|ask_confirmation，包含 confidence 和 message。
只有用户明确授权执行且 confidence>=0.85 才能 confirm；疑问属于 chat；修改时返回完整行程字段。
用户最新回复：${input.text}`;
    let data: Record<string, unknown>;
    try {
      data = await this.jsonCall(prompt, "message", options);
    } catch {
      return {
        success: true,
        action: "ask_confirmation",
        confidence: 0,
        message: fallback,
        trip: Object.keys(draft).length > 0 ? draft : null,
        decision_id: "",
        execution_token: "",
      };
    }

    let action = CONFIRM_ACTIONS.has(String(data.action)) ? String(data.action) : "ask_confirmation";
    const rawConfidence = typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? data.confidence
      : 0;
    const confidence = Math.max(0, Math.min(rawConfidence, 1));
    let message = String(data.message ?? "").trim();
    if (action === "confirm" && confidence < 0.85) action = "ask_confirmation";
    if (action === "ask_confirmation") message = fallback;
    if (!message) message = fallback;

    let trip: Record<string, unknown> | null = Object.keys(draft).length > 0 ? draft : null;
    if (action === "update") trip = this.updatedTrip(data, draft, today);
    if (action === "update" && !trip) action = "chat";

    let decisionId = "";
    let token = "";
    if (action === "confirm") {
      const decision = this.dependencies.ledger.register({ ...draft, language }, confidence);
      decisionId = decision.decisionId;
      token = decision.token;
    }
    return {
      success: true,
      action,
      confidence,
      message,
      trip,
      decision_id: decisionId,
      execution_token: token,
    };
  }

  private updatedTrip(
    data: Record<string, unknown>,
    draft: Record<string, unknown>,
    today: string,
  ): Record<string, unknown> | null {
    const cities = normalizeCities(data.cities, draft.cities);
    if (cities.length === 0) return null;
    const startDate = parseDate(data.start_date ?? draft.start_date)?.toISOString().slice(0, 10) ?? today;
    const travelDays = Math.min(cities.reduce((total, city) => total + city.days, 0), 30);
    const travelerCount = safeInteger(data.traveler_count ?? draft.traveler_count, 1, 50);
    return {
      ...draft,
      city: cities[0]!.city,
      cities,
      start_date: startDate,
      end_date: addDays(startDate, travelDays - 1),
      travel_days: travelDays,
      transportation: String(data.transportation ?? draft.transportation ?? "公共交通"),
      accommodation: String(data.accommodation ?? draft.accommodation ?? "经济型酒店"),
      traveler_count: travelerCount,
      room_count: safeInteger(data.room_count ?? draft.room_count, Math.ceil(travelerCount / 2), 50),
      budget_amount: safeBudget(data.budget_amount ?? draft.budget_amount),
      budget_basis: (data.budget_basis ?? draft.budget_basis) === "per_person" ? "per_person" : "group_total",
      preferences: Array.isArray(data.preferences) ? strings(data.preferences) : strings(draft.preferences),
      inferred_fields: Array.isArray(data.inferred_fields)
        ? strings(data.inferred_fields).filter((field) => INFERRED_FIELDS.has(field))
        : strings(draft.inferred_fields),
      suggestions: Array.isArray(data.suggestions) ? strings(data.suggestions).slice(0, 4) : strings(draft.suggestions),
    };
  }
}
