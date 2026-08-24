import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createDefaultParentAgent } from "../src/agents/default-parent-agent.ts";
import { createDefaultTripChatService } from "../src/agents/default-trip-chat-service.ts";
import type {
  PersistentParentAgentOptions,
  PersistentPiParentAgent,
} from "../src/agents/persistent-parent-agent.ts";
import type { SkillCatalogProvider } from "../src/agents/skill-management-service.ts";

function testCatalog(generation: number): SkillCatalogProvider {
  return {
    snapshot: () => ({
      generation,
      assignments: {
        "parent-assistant": [],
        "destination-researcher": [],
        "segment-planner": [],
        summary: [],
        "itinerary-reviewer": [],
        "plan-editor": [],
      },
    }),
    subscribe: () => () => {},
  };
}

describe("default agent factory wiring", () => {
  it("passes the live skill catalog through the default parent factory", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-default-parent-catalog-"));
    const skillCatalog = testCatalog(23);
    const fakeParent = { close: async () => {} } as PersistentPiParentAgent;
    let receivedOptions: PersistentParentAgentOptions | undefined;
    let parent: PersistentPiParentAgent | undefined;
    try {
      parent = createDefaultParentAgent({
        cwd: tempRoot,
        dataDir: join(tempRoot, "data"),
        tasks: {} as never,
        memory: {} as never,
        model: getModel("openai", "gpt-4o-mini")!,
        skillCatalog,
        parentFactory: (options: PersistentParentAgentOptions) => {
          receivedOptions = options;
          return fakeParent;
        },
        settings: {
          openai_api_key: "llm-secret",
          openai_base_url: "https://example.invalid/v1/",
          openai_model: "deepseek-v4-flash",
          llm_api_style: "responses",
          llm_timeout: 60,
          llm_thinking_enabled: true,
          pi_parent_session_limit: 8,
          pi_parent_session_idle_seconds: 600,
        },
      });
      expect(parent).toBe(fakeParent);
      expect(receivedOptions?.skillCatalog).toBe(skillCatalog);
      expect(receivedOptions?.model.samplingParams?.thinking).toEqual({ type: "enabled" });
    } finally {
      await parent?.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes the live skill catalog through the default chat runner factory", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-default-chat-catalog-"));
    const skillCatalog = testCatalog(29);
    let receivedOptions: Parameters<NonNullable<Parameters<typeof createDefaultTripChatService>[0]["runnerFactory"]>>[0] | undefined;
    const service = createDefaultTripChatService({
      cwd: tempRoot,
      dataDir: join(tempRoot, "data"),
      skillCatalog,
      llm: {
        model: getModel("openai", "gpt-4o-mini")!,
        async *stream() {},
        async complete() { return ""; },
      },
      memory: {
        async recall() { return ""; },
        async remember() { return true; },
      },
      runnerFactory: (options) => {
        receivedOptions = options;
        return {
          async run() { return {}; },
          close() {},
        };
      },
      settings: {
        openai_api_key: "llm-secret",
        openai_base_url: "https://example.invalid/v1/",
        openai_model: "deepseek-v4-flash",
        llm_api_style: "responses",
        llm_timeout: 60,
        llm_thinking_enabled: true,
        chat_edit_agent: "pi",
      },
    });
    try {
      expect(receivedOptions?.skillCatalog).toBe(skillCatalog);
      expect(receivedOptions?.thinkingEnabled).toBeTrue();
      expect(receivedOptions?.model.samplingParams?.thinking).toEqual({ type: "enabled" });
    } finally {
      await service.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes the thinking snapshot to direct chat model calls", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-default-chat-thinking-"));
    let receivedThinking: boolean | undefined;
    const service = createDefaultTripChatService({
      cwd: tempRoot,
      dataDir: join(tempRoot, "data"),
      llm: {
        model: getModel("openai", "gpt-4o-mini")!,
        async *stream() {},
        async complete(_prompt, options) {
          receivedThinking = options?.thinkingEnabled;
          return "收到。";
        },
      },
      memory: {
        async recall() { return ""; },
        async remember() { return true; },
      },
      runnerFactory: () => ({
        async run() { return {}; },
        close() {},
      }),
      settings: {
        openai_api_key: "llm-secret",
        openai_base_url: "https://example.invalid/v1/",
        openai_model: "deepseek-v4-flash",
        llm_api_style: "responses",
        llm_timeout: 60,
        llm_thinking_enabled: true,
        chat_edit_agent: "simple",
      },
    });
    try {
      await service.ask({ message: "还能调整吗？", trip_plan: {} });
      expect(receivedThinking).toBeTrue();
    } finally {
      await service.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
