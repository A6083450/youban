import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { getSettings, onSettingsReset } from "../../config/settings.ts";

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface PiLlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  apiStyle: "responses" | "completions";
  timeoutMs: number;
}

export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  disableThinking?: boolean;
  signal?: AbortSignal;
}

export interface LlmClient {
  readonly model: Model<Api>;
  stream(prompt: string, options?: LlmCallOptions): AsyncIterable<string>;
  complete(prompt: string, options?: LlmCallOptions): Promise<string>;
}

class PiLlmClient implements LlmClient {
  constructor(
    private readonly models: Models,
    readonly model: Model<Api>,
    private readonly timeoutMs: number,
  ) {}

  async *stream(prompt: string, options: LlmCallOptions = {}): AsyncIterable<string> {
    const stream = this.models.streamSimple(
      this.model,
      {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      },
      {
        temperature: options.temperature ?? 0.1,
        maxTokens: options.maxTokens,
        signal: options.signal,
        timeoutMs: this.timeoutMs,
        maxRetries: 1,
        headers: { "User-Agent": BROWSER_USER_AGENT },
      },
    );
    for await (const event of stream) {
      if (event.type === "text_delta" && event.delta) yield event.delta;
      if (event.type === "error") {
        throw new Error(event.error.errorMessage || `LLM request ${event.reason}`);
      }
    }
  }

  async complete(prompt: string, options: LlmCallOptions = {}): Promise<string> {
    let text = "";
    for await (const chunk of this.stream(prompt, options)) text += chunk;
    return text;
  }
}

export function createPiLlmClient(config: PiLlmConfig): LlmClient {
  const api = config.apiStyle === "responses" ? "openai-responses" : "openai-completions";
  const model: Model<Api> = {
    id: config.model,
    name: config.model,
    api,
    provider: "youban-runtime",
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    reasoning: config.model === "deepseek-v4-flash",
    thinkingLevelMap: config.model === "deepseek-v4-flash" ? { off: "none" } : undefined,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 32_000,
    compat: api === "openai-completions" ? {
      supportsDeveloperRole: false,
      supportsReasoningEffort: config.model === "deepseek-v4-flash",
    } : undefined,
  };
  const provider = createProvider({
    id: "youban-runtime",
    name: "YouBan runtime model",
    baseUrl: model.baseUrl,
    headers: { "User-Agent": BROWSER_USER_AGENT },
    auth: {
      apiKey: {
        name: "YouBan runtime API key",
        resolve: async () => ({
          auth: { apiKey: config.apiKey, baseUrl: model.baseUrl },
          source: "runtime_settings.json",
        }),
      },
    },
    models: [model],
    api: api === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  const registered = models.getModel("youban-runtime", config.model);
  if (!registered) throw new Error(`failed to register runtime model ${config.model}`);
  return new PiLlmClient(models, registered, config.timeoutMs);
}

let cachedClient: LlmClient | null = null;
let cachedSignature = "";

export function resetModels(): void {
  cachedClient = null;
  cachedSignature = "";
}

export function getPiLlmClient(): LlmClient {
  const settings = getSettings();
  const config: PiLlmConfig = {
    apiKey: settings.openai_api_key,
    baseUrl: settings.openai_base_url,
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
    timeoutMs: settings.llm_timeout * 1_000,
  };
  const signature = JSON.stringify(config);
  if (!cachedClient || signature !== cachedSignature) {
    cachedClient = createPiLlmClient(config);
    cachedSignature = signature;
  }
  return cachedClient;
}

onSettingsReset(resetModels);
