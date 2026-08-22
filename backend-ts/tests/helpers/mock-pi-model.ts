import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";

export interface MockPiModel {
  readonly requests: Array<Record<string, unknown>>;
  readonly maxActiveRequests: number;
  readonly model: Model<Api>;
  stop(): void;
}

export function createMockPiModel(
  runtimeDir: string,
  options: { delayMs?: number; value?: unknown; text?: string } = {},
): MockPiModel {
  const requests: Array<Record<string, unknown>> = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      try {
        if (options.delayMs) await Bun.sleep(options.delayMs);
        const hasStructuredOutput = Array.isArray(body.tools) && body.tools.some((tool) =>
          (tool as Record<string, any>).function?.name === "structured_output"
        );
        const toolArguments = JSON.stringify({
          value: options.value ?? { verdict: "ok" },
        });
        const chunks = options.text !== undefined && !hasStructuredOutput ? [
          {
            id: "mock-completion",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { role: "assistant", content: options.text }, finish_reason: null }],
          },
          {
            id: "mock-completion",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          },
        ] : [
          {
            id: "mock-completion",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-structured-output",
                      type: "function",
                      function: {
                        name: "structured_output",
                        arguments: toolArguments,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            id: "mock-completion",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
          },
        ];
        const stream = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      } finally {
        activeRequests -= 1;
      }
    },
  });

  const agentDir = join(runtimeDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "youban-mock": {
          baseUrl: `${server.url}v1`,
          api: "openai-completions",
          apiKey: "test-only",
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
          models: [{ id: "mock-model", reasoning: false }],
        },
      },
    }),
  );

  return {
    requests,
    model: {
      id: "mock-model",
      name: "mock-model",
      api: "openai-completions",
      provider: "youban-mock",
      baseUrl: `${server.url}v1`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
      maxTokens: 4_096,
    },
    get maxActiveRequests() {
      return maxActiveRequests;
    },
    stop() {
      server.stop(true);
    },
  };
}
