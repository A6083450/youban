import { describe, expect, it } from "bun:test";
import { createPiLlmClient } from "../src/agents/llm/providers.ts";

describe("Pi LLM client", () => {
  it("preserves the external abort reason for a running Pi Agent turn", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const server = Bun.serve({
      port: 0,
      async fetch() {
        markStarted();
        await Bun.sleep(5_000);
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    try {
      const client = createPiLlmClient({
        apiKey: "test-key",
        baseUrl: `${server.url}v1`,
        model: "mock-model",
        apiStyle: "completions",
        timeoutMs: 10_000,
      });
      const controller = new AbortController();
      const pending = client.agentComplete("wait", {
        systemPrompt: "Wait for cancellation.",
        signal: controller.signal,
      });
      await started;
      controller.abort(new Error("client-left"));

      await expect(pending).rejects.toThrow("client-left");
    } finally {
      server.stop(true);
    }
  });

  it("runs a tool-free Pi Agent turn and streams its reply", async () => {
    const requests: Array<{ headers: Headers; body: Record<string, any> }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          headers: request.headers,
          body: await request.json() as Record<string, any>,
        });
        const chunks = [
          {
            id: "agent-completion-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { role: "assistant", content: "O" }, finish_reason: null }],
          },
          {
            id: "agent-completion-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { content: "K" }, finish_reason: null }],
          },
          {
            id: "agent-completion-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      const client = createPiLlmClient({
        apiKey: "test-key",
        baseUrl: `${server.url}v1`,
        model: "mock-model",
        apiStyle: "completions",
        timeoutMs: 2_000,
      });
      const deltas: string[] = [];

      const output = await client.agentComplete("organize this trip", {
        systemPrompt: "You are a lightweight trip intake agent.",
        sessionId: "user:test-user",
        onDelta: (delta) => { deltas.push(delta); },
      });

      expect(output).toBe("OK");
      expect(deltas).toEqual(["O", "K"]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers.get("user-agent")).toContain("Mozilla/5.0");
      expect(requests[0]?.body.messages).toEqual([
        expect.objectContaining({ role: "system", content: "You are a lightweight trip intake agent." }),
        expect.objectContaining({
          role: "user",
          content: [{ type: "text", text: "organize this trip" }],
        }),
      ]);
      expect(requests[0]?.body.tools).toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  it("streams an OpenAI-compatible completion through pi-ai with browser headers", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, any> }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          url: request.url,
          headers: request.headers,
          body: await request.json() as Record<string, any>,
        });
        const chunks = [
          {
            id: "completion-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { role: "assistant", content: "O" }, finish_reason: null }],
          },
          {
            id: "completion-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { content: "K" }, finish_reason: null }],
          },
          {
            id: "completion-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      const client = createPiLlmClient({
        apiKey: "test-key",
        baseUrl: `${server.url}v1`,
        model: "mock-model",
        apiStyle: "completions",
        timeoutMs: 2_000,
      });
      const chunks: string[] = [];
      for await (const chunk of client.stream("reply with OK", { temperature: 0.1 })) chunks.push(chunk);
      expect(chunks).toEqual(["O", "K"]);
      expect(await client.complete("reply with OK")).toBe("OK");
      expect(requests).toHaveLength(2);
      expect(requests[0]?.url).toEndWith("/v1/chat/completions");
      expect(requests[0]?.headers.get("user-agent")).toContain("Mozilla/5.0");
      expect(requests[0]?.body.messages.at(-1)).toEqual(expect.objectContaining({
        role: "user",
        content: "reply with OK",
      }));
    } finally {
      server.stop(true);
    }
  });

  it("constructs the configured responses model without loading ambient providers", () => {
    const client = createPiLlmClient({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      model: "deepseek-v4-flash",
      apiStyle: "responses",
      timeoutMs: 1_000,
    });
    expect(client.model.api).toBe("openai-responses");
    expect(client.model.provider).toBe("youban-runtime");
    expect(client.model.baseUrl).toBe("https://example.invalid/v1");
  });
});
