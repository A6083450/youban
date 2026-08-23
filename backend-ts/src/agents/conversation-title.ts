import { createHash } from "node:crypto";
import type { PiAgentLlmClient } from "./llm/providers.ts";

const TITLE_TIMEOUT_MS = 5_000;
const TITLE_SYSTEM_PROMPT = [
  "Generate exactly one concise title for the user's conversation intent.",
  "Return either a single 8-18-character Chinese title or a 3-8-word English title.",
  "Do not include quotes, labels, ending punctuation, explanations, or markdown.",
].join(" ");

const EDGE_QUOTES = /^["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]+|["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]+$/gu;
const ENDING_PUNCTUATION = /[\u3002\uff01\uff1f!?.,;:\uff1a\uff1b]+$/gu;
const TITLE_LABEL = /^(?:title|\u6807\u9898)\s*[:\uff1a]/iu;
const CHINESE_TITLE = /^[\p{Script=Han}A-Za-z0-9]{8,18}$/u;
const ENGLISH_TITLE = /^[A-Za-z0-9][A-Za-z0-9'\u2019-]*(?: [A-Za-z0-9][A-Za-z0-9'\u2019-]*){2,7}$/u;

export interface ConversationTitle {
  title: string;
  status: "generated" | "fallback";
}

function normalizeFirstMessage(value: string): string {
  const normalized = String(value ?? "").trim().split(/\s+/u).filter(Boolean).join(" ");
  if (!normalized) throw new Error("first message is required");
  return normalized;
}

function stripTitleFormatting(value: string): string {
  let title = value.trim().split(/\s+/u).filter(Boolean).join(" ");
  for (let index = 0; index < 2; index += 1) {
    title = title.replace(EDGE_QUOTES, "").trim();
    title = title.replace(ENDING_PUNCTUATION, "").trim();
  }
  return title;
}

function normalizeGeneratedTitle(value: string): string | undefined {
  const title = stripTitleFormatting(value);
  if (!title || TITLE_LABEL.test(title)) return undefined;
  if (CHINESE_TITLE.test(title) && /\p{Script=Han}/u.test(title)) return title;
  return ENGLISH_TITLE.test(title) ? title : undefined;
}

function takeCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

export function fallbackConversationTitle(firstMessage: string): string {
  const normalized = normalizeFirstMessage(firstMessage);
  const title = stripTitleFormatting(normalized) || normalized;
  if (/\p{Script=Han}/u.test(title)) return takeCodePoints(title, 18);
  return title.split(" ").slice(0, 8).join(" ");
}

function titleSessionId(firstMessage: string): string {
  const digest = createHash("sha256").update(firstMessage).digest("hex").slice(0, 16);
  return `conversation-title:${digest}`;
}

export class ConversationTitleService {
  constructor(private readonly llm: Pick<PiAgentLlmClient, "agentComplete">) {}

  async infer(firstMessage: string, signal?: AbortSignal): Promise<ConversationTitle> {
    const normalizedFirstMessage = normalizeFirstMessage(firstMessage);
    const fallback = fallbackConversationTitle(normalizedFirstMessage);
    if (signal?.aborted) return { title: fallback, status: "fallback" };

    const deadline = new AbortController();
    const abortFromCaller = () => deadline.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      deadline.abort(new Error("conversation title inference timed out"));
    }, TITLE_TIMEOUT_MS);

    try {
      const output = await this.llm.agentComplete(normalizedFirstMessage, {
        systemPrompt: TITLE_SYSTEM_PROMPT,
        temperature: 0.1,
        maxTokens: 32,
        disableThinking: true,
        signal: deadline.signal,
        sessionId: titleSessionId(normalizedFirstMessage),
      });
      const title = normalizeGeneratedTitle(output);
      return title ? { title, status: "generated" } : { title: fallback, status: "fallback" };
    } catch {
      return { title: fallback, status: "fallback" };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}
