import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  PI_RUNTIME_API_KEY_ENV,
  PiSubagentRunner,
  writeRuntimeModelConfig,
} from "../src/agents/pi-subagent-runner.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";

describe("PiSubagentRunner", () => {
  it("runs a real structured pi-subagents child and returns its value", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-runner-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mock = createMockPiModel(runtimeDir, { value: { verdict: "ok" } });
    const previousKey = process.env[PI_RUNTIME_API_KEY_ENV];
    process.env[PI_RUNTIME_API_KEY_ENV] = "previous-value";
    const runner = new PiSubagentRunner({
      cwd: tempRoot,
      runtimeDir,
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      apiKey: "runtime-secret",
      timeoutMs: 10_000,
    });
    try {
      expect(await runner.run({
        agent: "segment-planner",
        nodeId: "runner-smoke",
        input: { fixed: true },
        schema: {
          type: "object",
          properties: { verdict: { type: "string" } },
          required: ["verdict"],
          additionalProperties: false,
        },
        signal: new AbortController().signal,
      })).toEqual({ verdict: "ok" });
      expect(mock.requests).toHaveLength(1);
      expect(process.env[PI_RUNTIME_API_KEY_ENV]).toBe("runtime-secret");
    } finally {
      await runner.close();
      expect(process.env[PI_RUNTIME_API_KEY_ENV]).toBe("previous-value");
      if (previousKey === undefined) delete process.env[PI_RUNTIME_API_KEY_ENV];
      else process.env[PI_RUNTIME_API_KEY_ENV] = previousKey;
      mock.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("writes a restrictive model config with an env reference instead of the secret", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-config-"));
    try {
      const path = writeRuntimeModelConfig(tempRoot, {
        baseUrl: "https://example.invalid/v1/",
        model: "deepseek-v4-flash",
        apiStyle: "responses",
      });
      const raw = readFileSync(path, "utf8");
      expect(raw).toContain("$YOUBAN_PI_RUNTIME_API_KEY");
      expect(raw).not.toContain("real-secret-value");
      const parsed = JSON.parse(raw);
      expect(parsed.providers["youban-runtime"]).toEqual(expect.objectContaining({
        baseUrl: "https://example.invalid/v1",
        api: "openai-responses",
      }));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not delegate when cancellation happens during host initialization", async () => {
    let resolveHost!: (host: any) => void;
    const hostPromise = new Promise<any>((resolve) => { resolveHost = resolve; });
    let delegateCalls = 0;
    let disposed = false;
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-pi-cold-cancel",
      runtimeDir: "/tmp/youban-pi-cold-cancel/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      hostFactory: () => hostPromise,
    });
    const controller = new AbortController();
    const result = runner.run({
      agent: "segment-planner",
      nodeId: "cold-cancel",
      input: {},
      schema: { type: "object" },
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled during startup"));
    resolveHost({
      delegate: async () => { delegateCalls += 1; return { status: "completed" }; },
      cancel() {},
      dispose() { disposed = true; },
    });
    await expect(result).rejects.toThrow("cancelled during startup");
    expect(delegateCalls).toBe(0);
    await runner.close();
    expect(disposed).toBeTrue();
  });
});
