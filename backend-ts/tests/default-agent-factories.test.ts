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
    let receivedCatalog: SkillCatalogProvider | undefined;
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
          receivedCatalog = options.skillCatalog;
          return fakeParent;
        },
        settings: {
          openai_api_key: "llm-secret",
          openai_base_url: "https://example.invalid/v1/",
          openai_model: "deepseek-v4-flash",
          llm_api_style: "responses",
          llm_timeout: 60,
          pi_parent_session_limit: 8,
          pi_parent_session_idle_seconds: 600,
        },
      });
      expect(parent).toBe(fakeParent);
      expect(receivedCatalog).toBe(skillCatalog);
    } finally {
      await parent?.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("passes the live skill catalog through the default chat runner factory", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-default-chat-catalog-"));
    const skillCatalog = testCatalog(29);
    let receivedCatalog: SkillCatalogProvider | undefined;
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
        receivedCatalog = options.skillCatalog;
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
        chat_edit_agent: "pi",
      },
    });
    try {
      expect(receivedCatalog).toBe(skillCatalog);
    } finally {
      await service.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
