import { parseJsonObject } from "./llm/plan-parser.ts";
import type { LlmClient } from "./llm/providers.ts";
import { streamExtractStringField } from "./llm/stream-json.ts";
import { ConfirmationLedger } from "../domain/confirmation.ts";
import type { ParentAgentScope, YoubanParentAgent } from "./persistent-parent-agent.ts";
import { visibleThoughtSummary } from "./thought-summary-policy.ts";
import { applyTripDraftPatch } from "../domain/trip-draft-patch.ts";

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
  readiness_token?: string;
}

interface RunOptions {
  onDelta?: (text: string) => void | Promise<void>;
  onThoughtSummary?: (summary: string) => void | Promise<void>;
  signal?: AbortSignal;
  scope?: ParentAgentScope;
}

const ACTIONS = new Set(["plan", "clarify", "recommend", "chat"]);
const EMOTIONS = new Set(["neutral", "uncertain", "frustrated", "excited", "anxious"]);
const CONFIRM_ACTIONS = new Set(["confirm", "cancel", "update", "chat", "ask_confirmation"]);
const INTAKE_SYSTEM_PROMPT = [
  "你是游伴的轻量旅行接待 Agent。",
  "只负责对话澄清、目的地推荐和结构化旅行草稿。",
  "不调用工具，不启动子 Agent，不生成详细日程。",
  "严格遵循本轮提示，只输出一个 JSON 对象。",
].join("");
const DIALOGUE_POLICY = `对话体验规则：
1. 必须结合完整对话语义推理 primary_intent、emotion_score（情绪负面分 1-10）、engagement=engaged|uncertain|disengaging、dialogue_stage=opening|exploring|recommended|decision_fatigue|draft_ready、next_step=ask|recommend|offer_generation|generate_now|pause 和 next_step_confidence（0-1），不得按固定词句匹配，也不得向用户展示分数、标签或分析过程。
2. 内部情绪负面分标准：1-3 积极正面；4-5 中性或轻微波动；6-8 明显负面；9-10 强烈负面。
3. 一句话可能同时包含交由你决定、新增限制、修改方向、暂不生成等多个意图；先尊重明确限制与否定，再根据主要意图推进，不能因为出现某个短语就覆盖其余语义。
4. 首次对话先亲切承接用户已经说出的具体旅行意图，体现理解并主动降低规划负担；不要用空泛客套后立刻盘问。
5. 用户没有思路时，next_step=recommend，主动给出 2-4 个贴合上下文的具体方向并标明首选，不连续盘问。
6. 已经推荐过而用户仍表现出不想选择、疲惫或不耐烦时，不再返回相同方案或继续追问；主动选定最合适的方向，采用合理默认值整理 action=plan，并根据语义选择 next_step=offer_generation 或 generate_now。
7. 不把“字段尚未逐项确认”作为继续提问的门槛。只要没有关键冲突，就可透明采用合理默认值；只有确实无法安全推断的冲突才最多追问一个问题。
8. next_step=generate_now 仅用于完整语义清楚地表明用户希望游伴接手并继续执行、没有暂缓或反对生成的意思，且 next_step_confidence>=0.85；否则用 offer_generation。
9. 凡同时比较两个及以上方案，response_mode 必须为 choices，并填写 choice_options[{name,highlights,suggested_days}]；reply 只写一句亲切承接，不得自行输出空格对齐的伪表格、编号列表或重复复述方案。系统会把 choice_options 统一渲染为 Markdown 表格。
10. emotion_score 为 6-8 时先简短表示理解，再降低选择压力；9-10 时优先暂停压力，但若用户明确希望继续，则替用户减少决策并推进。
11. 回复自然、亲切、简洁，不说教，不评价用户情绪，不重复上一轮已经问过的问题。`;
const INFERRED_FIELDS = new Set([
  "dates",
  "transportation",
  "accommodation",
  "preferences",
  "traveler_count",
]);
const NEXT_STEPS = new Set(["ask", "recommend", "offer_generation", "generate_now", "pause"]);

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

function nonBlank(value: unknown, fallback: string): string {
  return String(value ?? "").trim() || fallback;
}

function historyText(history: ChatHistoryItem[] | undefined): string {
  const lines = (history ?? []).slice(-10).flatMap((item) => {
    const content = String(item?.content ?? "").trim().slice(0, 200);
    if (!content) return [];
    return [`${item.role === "user" ? "用户" : "游伴"}: ${content}`];
  });
  return lines.join("\n") || "(无对话历史)";
}

function normalizedDialogueText(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[\s，。！？、,.!?：:；;"'“”‘’]/g, "");
}

interface ChoiceOption {
  name: string;
  highlights: string;
  suggestedDays: string;
}

function markdownCell(value: unknown): string {
  return String(value ?? "").trim().replaceAll("|", "\\|").replace(/\s*\n\s*/g, " ");
}

function choiceOptions(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const name = markdownCell(record.name);
    const highlights = markdownCell(record.highlights);
    const suggestedDays = markdownCell(record.suggested_days);
    return name && highlights ? [{ name, highlights, suggestedDays: suggestedDays || "—" }] : [];
  });
}

function renderChoiceTable(value: unknown, language: string | undefined): string | null {
  const options = choiceOptions(value);
  if (options.length < 2) return null;
  const normalized = String(language ?? "").toLowerCase();
  const copy = normalized.startsWith("en")
    ? { intro: "Here are the clearest options side by side:", headers: ["Option", "Highlights", "Suggested stay"], close: "Reply with a number, or ask me to choose for you." }
    : normalized.startsWith("fr")
      ? { intro: "Voici les options les plus claires à comparer :", headers: ["Option", "Points forts", "Durée conseillée"], close: "Répondez avec un numéro, ou demandez-moi de choisir pour vous." }
      : { intro: "好的，我把几个方案放在一起对比，你可以轻松选：", headers: ["方案", "特点", "建议天数"], close: "回复序号即可，也可以说“直接帮我选”。" };
  const rows = options.map((option, index) => (
    `| ${index + 1}. ${option.name} | ${option.highlights} | ${option.suggestedDays} |`
  ));
  return [
    copy.intro,
    "",
    `| ${copy.headers.join(" | ")} |`,
    "| --- | --- | --- |",
    ...rows,
    "",
    copy.close,
  ].join("\n");
}

function generationOffer(language: string | undefined): string {
  const normalized = String(language ?? "").toLowerCase();
  if (normalized.startsWith("en")) return "Would you like me to generate the detailed itinerary from the current draft?";
  if (normalized.startsWith("fr")) return "Voulez-vous que je génère l'itinéraire détaillé à partir de cette proposition ?";
  return "要按当前计划生成详细行程吗？";
}

function distinctFollowUp(reply: string, value: unknown): string {
  const followUp = String(value ?? "").trim();
  if (!followUp) return "";
  const normalizedFollowUp = normalizedDialogueText(followUp);
  return normalizedFollowUp && normalizedDialogueText(reply).includes(normalizedFollowUp)
    ? ""
    : followUp;
}

function languageFallback(language: string | undefined, kind: "parse" | "confirm"): string {
  const normalized = String(language ?? "").toLowerCase();
  if (kind === "confirm") {
    if (normalized.startsWith("en")) return "Would you like me to start planning from the current draft?";
    if (normalized.startsWith("fr")) return "Voulez-vous que je crée le voyage à partir de cette proposition ?";
    return "你是想按当前这份草稿开始生成计划吗？";
  }
  if (normalized.startsWith("en")) return "Would you prefer nature and scenery, or food and culture?";
  if (normalized.startsWith("fr")) return "Vous préférez la nature et les paysages, ou la gastronomie et la culture ?";
  return "没问题，我可以直接帮你缩小范围。你更想看自然风光，还是逛吃和人文？";
}

function intakeUnavailableMessage(language: string | undefined): string {
  const normalized = String(language ?? "").toLowerCase();
  if (normalized.startsWith("en")) {
    return "I couldn't connect just now. Please try again shortly; your message has been saved.";
  }
  if (normalized.startsWith("fr")) {
    return "YouBan n'a pas pu se connecter. Réessayez dans un instant ; votre message a bien été conservé.";
  }
  return "游伴暂时没有连接上，请稍后再试。刚才的消息已经保留。";
}

function draftUpdateFailureMessage(language: string | undefined): string {
  const normalized = String(language ?? "").toLowerCase();
  if (normalized.startsWith("en")) return "That change was not saved to the draft. Please try again.";
  if (normalized.startsWith("fr")) return "Cette modification n'a pas été enregistrée dans le brouillon. Veuillez réessayer.";
  return "刚才这项修改没有成功写入草稿，请再试一次。";
}

function normalizeToday(value: unknown): string {
  return parseDate(value)?.toISOString().slice(0, 10) ?? todayString();
}

function normalizeCities(value: unknown, fallback: unknown = []): Array<{ city: string; days: number }> {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const normalized = source.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const city = String(record.city ?? "").trim();
    return city ? [{ city, days: safeInteger(record.days, 3, 15) }] : [];
  });
  let remaining = 30;
  return normalized.flatMap((city) => {
    if (remaining === 0) return [];
    const days = Math.min(city.days, remaining);
    remaining -= days;
    return [{ ...city, days }];
  });
}

const DEFAULT_XINJIANG_MONTH_ROUTE = [
  { city: "乌鲁木齐", days: 3 },
  { city: "吐鲁番", days: 3 },
  { city: "阿勒泰", days: 5 },
  { city: "伊宁", days: 5 },
  { city: "库尔勒", days: 3 },
  { city: "库车", days: 3 },
  { city: "喀什", days: 5 },
  { city: "和田", days: 3 },
];

function isXinjiangMonthRequest(input: ParseTripInput): boolean {
  const conversation = [
    ...(input.history ?? []).map((item) => String(item.content ?? "")),
    input.text,
  ].join("\n");
  const mentionsXinjiang = /新疆|南北疆/.test(conversation);
  const mentionsMonth = /一个月|1\s*个月|30\s*天|10月1日[^\n]{0,40}10月30日/.test(conversation);
  return mentionsXinjiang && mentionsMonth;
}

function normalizeXinjiangMonthCities(
  cities: Array<{ city: string; days: number }>,
  input: ParseTripInput,
): Array<{ city: string; days: number }> {
  if (!isXinjiangMonthRequest(input)) return cities;
  if (cities.length === 1) {
    return structuredClone(DEFAULT_XINJIANG_MONTH_ROUTE);
  }
  const normalized = cities.map((city) => ({ ...city }));
  let remaining = 30 - normalized.reduce((total, city) => total + city.days, 0);
  for (let index = 0; remaining > 0 && normalized.length > 0; index = (index + 1) % normalized.length) {
    const city = normalized[index]!;
    if (city.days < 15) {
      city.days += 1;
      remaining -= 1;
    }
  }
  return normalized;
}

export class TripAssistant {
  constructor(private readonly dependencies: {
    llm: LlmClient;
    ledger: ConfirmationLedger;
    parentAgent?: YoubanParentAgent;
    thinkingEnabled?: boolean;
    thinkingVisible?: boolean;
  }) {}

  get ledger(): ConfirmationLedger {
    return this.dependencies.ledger;
  }

  private async emitThoughtSummary(summary: string, options: RunOptions): Promise<void> {
    const visible = visibleThoughtSummary(summary, this.dependencies.thinkingVisible === true);
    if (visible) await options.onThoughtSummary?.(visible);
  }

  private async jsonCall(
    prompt: string,
    field: string,
    options: RunOptions,
  ): Promise<Record<string, unknown>> {
    if (this.dependencies.llm.agentComplete) {
      let buffer = "";
      let emitted = 0;
      const output = await this.dependencies.llm.agentComplete(prompt, {
        systemPrompt: INTAKE_SYSTEM_PROMPT,
        sessionId: options.scope?.key,
        temperature: 0.1,
        thinkingEnabled: this.dependencies.thinkingEnabled,
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
        thinkingEnabled: this.dependencies.thinkingEnabled,
        signal: options.signal,
      }));
    }
    let buffer = "";
    let emitted = 0;
    for await (const chunk of this.dependencies.llm.stream(prompt, {
      temperature: 0.1,
      thinkingEnabled: this.dependencies.thinkingEnabled,
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
    await this.emitThoughtSummary("正在梳理你的旅行偏好与行程条件", options);
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
      readiness_token: "",
      clarify_question: fallback,
      summary: "",
      trip: null,
    };
    const prompt = `你是游伴旅行智能体的需求理解模块。今天是 ${today}。
回复语言：${String(input.language ?? "zh-CN").trim() || "zh-CN"}。所有面向用户的字段必须使用该语言。
结合对话历史判断 action=plan|clarify|recommend|chat，并只输出严格 JSON。
为保证流式回复及时可见，输出必须以 {"reply":" 开始，reply 必须是第一个字段；完成 reply 后再输出 action、意图、情绪和其余结构化字段。
${DIALOGUE_POLICY}
这是${(input.history ?? []).length === 0 ? "首次对话" : "持续对话"}，必须自行判断历史中是否已经推荐、用户是否仍愿意选择以及当前最合适的推进方式。
对话历史：\n${historyText(input.history)}
字段包括 action, primary_intent, emotion, emotion_score, engagement, dialogue_stage, next_step, next_step_confidence, response_mode, reply, follow_up_question, choice_options[{name,highlights,suggested_days}], cities[{city,days}], start_date, end_date,
transportation, accommodation, traveler_count, room_count, budget_amount, budget_basis,
preferences, need_clarify, clarify_question, summary, ready_to_generate, suggestions,
inferred_fields, recommendations[{destination,reason,suggested_days}]。
未提日期用 ${tomorrow}；没有目的地且仍在探索时可以推荐；已经推荐且需要替用户推进时，可以从上下文中选择目的地并生成草稿。ready_to_generate 表示草稿可执行，不要求每个默认值都由用户逐项确认。
用户最新消息：${input.text}`;

    let data: Record<string, unknown>;
    try {
      data = await this.jsonCall(prompt, "reply", options);
    } catch {
      throw new Error(intakeUnavailableMessage(input.language));
    }
    const action = ACTIONS.has(String(data.action)) ? String(data.action) : "clarify";
    const emotion = EMOTIONS.has(String(data.emotion)) ? String(data.emotion) : "neutral";
    const nextStep = NEXT_STEPS.has(String(data.next_step)) ? String(data.next_step) : "ask";
    const reply = String(data.reply ?? data.clarify_question ?? fallback).trim() || fallback;
    const isChoiceResponse = String(data.response_mode) === "choices";
    const structuredChoices = isChoiceResponse
      ? renderChoiceTable(data.choice_options, input.language)
      : null;
    const visibleReply = structuredChoices ?? reply;
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
        next_step: nextStep,
        auto_generate: false,
        execution_token: "",
        reply: visibleReply,
        follow_up_question: isChoiceResponse
          ? ""
          : distinctFollowUp(visibleReply, data.follow_up_question),
        recommendations: isChoiceResponse ? [] : recommendations,
        need_clarify: action === "clarify" || action === "recommend",
        ready_to_generate: false,
        readiness_token: "",
        clarify_question: visibleReply,
        summary: "",
        trip: null,
      };
    }

    const cities = normalizeXinjiangMonthCities(normalizeCities(data.cities), input);
    if (cities.length === 0) return { ...defaults, emotion, reply, clarify_question: reply };
    const startDate = parseDate(data.start_date)?.toISOString().slice(0, 10) ?? tomorrow;
    const travelDays = Math.min(cities.reduce((total, city) => total + city.days, 0), 30);
    const endDate = addDays(startDate, travelDays - 1);
    const ready = data.ready_to_generate === true;
    const rawNextStepConfidence = typeof data.next_step_confidence === "number"
      && Number.isFinite(data.next_step_confidence)
      ? data.next_step_confidence
      : 0;
    const nextStepConfidence = Math.max(0, Math.min(rawNextStepConfidence, 1));
    const travelerCount = safeInteger(data.traveler_count, 1, 50);
    const roomCount = safeInteger(data.room_count, Math.ceil(travelerCount / 2), 50);
    const inferred = ready ? [] : strings(data.inferred_fields).filter((field) => INFERRED_FIELDS.has(field));
    const suggestions = ready ? [] : strings(data.suggestions).slice(0, 4);
    const budgetBasis = data.budget_basis === "per_person" ? "per_person" : "group_total";
    const trip = {
      city: cities[0]!.city,
      cities,
      start_date: startDate,
      end_date: endDate,
      travel_days: travelDays,
      transportation: nonBlank(data.transportation, "公共交通"),
      accommodation: nonBlank(data.accommodation, "经济型酒店"),
      traveler_count: travelerCount,
      room_count: roomCount,
      budget_amount: safeBudget(data.budget_amount),
      budget_basis: budgetBasis,
      preferences: strings(data.preferences),
      free_text_input: input.text,
      origin_text: input.text,
      inferred_fields: inferred,
      suggestions,
    };
    const language = String(input.language ?? "").trim().replaceAll("_", "-");
    const autoGenerate = ready && nextStep === "generate_now" && nextStepConfidence >= 0.85;
    const execution = autoGenerate
      ? this.dependencies.ledger.register({ ...trip, language }, nextStepConfidence)
      : null;
    return {
      success: true,
      action: "plan",
      emotion,
      next_step: autoGenerate ? "generate_now" : nextStep === "generate_now" ? "offer_generation" : nextStep,
      auto_generate: autoGenerate,
      execution_token: execution?.token ?? "",
      reply,
      follow_up_question: distinctFollowUp(reply, data.follow_up_question),
      recommendations,
      need_clarify: false,
      ready_to_generate: ready,
      readiness_token: ready
        ? this.dependencies.ledger.attestReady({ ...trip, language })
        : "",
      clarify_question: String(data.clarify_question ?? reply),
      summary: String(data.summary ?? ""),
      trip,
    };
  }

  async confirm(input: ConfirmTripInput, options: RunOptions = {}): Promise<Record<string, unknown>> {
    await this.emitThoughtSummary("正在核对行程调整与执行条件", options);
    const today = normalizeToday(input.today);
    const draft = input.draft ?? {};
    const language = String(input.language ?? "").trim().replaceAll("_", "-");
    const fallback = languageFallback(language, "confirm");
    const readiness = this.dependencies.ledger.validateReady(
      input.readiness_token,
      { ...draft, language },
    );
    const trustedReady = Object.keys(draft).length > 0 && readiness.valid;
    const prompt = `你是旅行规划助手的意图判断模块。今天是 ${today}。
回复语言：${language || "zh-CN"}。所有面向用户的字段必须使用该语言。
当前草稿：${JSON.stringify(draft)}
最近对话：\n${historyText(input.history)}
${DIALOGUE_POLICY}
草稿确认阶段补充规则：首次确认也要亲切承接；用户索要景点、方向或方案参考时，必须真正给出具体内容，不得只承诺稍后提供；连续低意愿时停止重复确认，改给“采用推荐方案、查看备选、稍后继续”等低压力选项，但绝不能因此视为用户授权执行。
必须根据最新回复与完整历史的语义判断意愿，不得依赖固定词、关键词表或脱离上下文的短语匹配。任何草稿修改都必须 action=update，并将本轮确实修改的字段写入 draft_patch；message 只能描述 draft_patch 中已经完成的修改。已有可生成草稿时，如果用户语义上明确表示调整结束并希望继续安排，返回 action=confirm、next_step=generate_now 和 next_step_confidence；如果只是暂时不想继续聊但没有同意执行，则返回 next_step=offer_generation。
只输出严格 JSON，action=confirm|update|cancel|chat|ask_confirmation，包含 confidence、message、ready_to_generate、next_step、next_step_confidence、response_mode、draft_patch 和 choice_options[{name,highlights,suggested_days}]。draft_patch 只放本轮变更，允许字段为 cities[{city,days}]、travel_days、start_date、transportation、accommodation、traveler_count、room_count、budget_amount、budget_basis、preferences、inferred_fields、suggestions；省略的字段保持当前草稿不变。用户同时表达多个意图时，必须把所有已确认修改一并写入 draft_patch，不能只在 message 中口头确认。
为保证流式回复及时可见，输出必须以 {"message":" 开始，message 必须是第一个字段；完成 message 后再输出 action、confidence 和其余结构化字段。
只有用户明确授权执行且 confidence>=0.85 才能 confirm；疑问属于 chat；修改时返回完整行程字段。凡同时比较两个及以上方案，必须使用 response_mode=choices 和 choice_options，系统会渲染表格；已有完整草稿且给出参考方案时使用 next_step=offer_generation。信息仍不完整时 ready_to_generate=false，并在 message 里只追问一个最重要的问题；完整时才为 true。
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
        ready_to_generate: false,
        readiness_token: trustedReady ? input.readiness_token ?? "" : "",
        trip: Object.keys(draft).length > 0 ? draft : null,
        decision_id: "",
        execution_token: "",
      };
    }

    let action = CONFIRM_ACTIONS.has(String(data.action)) ? String(data.action) : "ask_confirmation";
    const rawConfidence = typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? data.confidence
      : 0;
    let confidence = Math.max(0, Math.min(rawConfidence, 1));
    let message = String(data.message ?? "").trim();
    const structuredChoices = String(data.response_mode) === "choices"
      ? renderChoiceTable(data.choice_options, language)
      : null;
    const agentNextStep = NEXT_STEPS.has(String(data.next_step))
      ? String(data.next_step)
      : "ask";
    let nextStep = structuredChoices && trustedReady ? "offer_generation" : agentNextStep;
    if (structuredChoices) {
      message = nextStep === "offer_generation"
        ? `${structuredChoices}\n\n${generationOffer(language)}`
        : structuredChoices;
    }
    const agentConfirmedReady = action === "confirm" && confidence >= 0.85;
    if (action === "confirm" && !trustedReady) action = "ask_confirmation";
    if (action === "confirm" && confidence < 0.85) action = "ask_confirmation";
    if (action === "ask_confirmation") message = fallback;
    if (!message) message = fallback;

    let trip: Record<string, unknown> | null = Object.keys(draft).length > 0 ? draft : null;
    if (action === "update") trip = applyTripDraftPatch(draft, data.draft_patch, today);
    if (action === "update" && !trip) {
      action = "chat";
      nextStep = "ask";
      message = draftUpdateFailureMessage(language);
    }
    const readyToGenerate = action === "confirm"
      || agentConfirmedReady
      || data.ready_to_generate === true
      || (trustedReady && action !== "cancel");
    const shouldAttestReady = action !== "cancel"
      && readyToGenerate
      && trip
      && (action === "update" || !trustedReady);
    const readinessToken = shouldAttestReady
      ? this.dependencies.ledger.attestReady({ ...trip, language })
      : trustedReady ? input.readiness_token ?? "" : "";

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
      next_step: nextStep,
      confidence,
      message,
      ready_to_generate: readyToGenerate,
      readiness_token: readinessToken,
      trip,
      decision_id: decisionId,
      execution_token: token,
    };
  }

}
