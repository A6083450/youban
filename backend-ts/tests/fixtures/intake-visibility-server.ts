import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmCallOptions, LlmClient } from "../../src/agents/llm/providers.ts";
import { ConversationTitleService } from "../../src/agents/conversation-title.ts";
import { TripAssistant } from "../../src/agents/trip-assistant.ts";
import { ConfirmationLedger } from "../../src/domain/confirmation.ts";
import { createHttpRuntime } from "../../src/http/app.ts";
import { listenProductionHttpServer } from "../../src/runtime/server-lifecycle.ts";

class IntakeFixtureLlm implements LlmClient {
  readonly model = {
    id: "intake-visibility-fixture",
    name: "intake-visibility-fixture",
    api: "openai-completions" as const,
    provider: "fixture",
    baseUrl: "http://fixture.invalid",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000,
    maxTokens: 1_000,
  };

  async *stream(_prompt: string, _options?: LlmCallOptions): AsyncIterable<string> {
    yield '{"reply":"可见回复正常返回。","action":"chat","emotion":"neutral"}';
  }

  async complete(prompt: string, options?: LlmCallOptions): Promise<string> {
    let output = "";
    for await (const chunk of this.stream(prompt, options)) output += chunk;
    return output;
  }
}

const dataDir = mkdtempSync(join(tmpdir(), "youban-intake-visibility-browser-"));
const runtime = createHttpRuntime({
  dataDir,
  conversationTitleService: new ConversationTitleService({
    async agentComplete() { return "继续旅行对话记录"; },
  }),
  assistant: new TripAssistant({
    llm: new IntakeFixtureLlm(),
    ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 41) }),
    thinkingEnabled: true,
    thinkingVisible: false,
  }),
});
const listener = listenProductionHttpServer(runtime.app, { hostname: "127.0.0.1", port: 0 });
const port = listener.server?.port;
if (typeof port !== "number") throw new Error("intake visibility fixture did not bind a port");

console.log(JSON.stringify({
  type: "youban-intake-visibility-fixture",
  api_url: `http://127.0.0.1:${port}`,
}));

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    await listener.stop(false);
    await runtime.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
