import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createDefaultTripPlanner } from "../src/agents/default-trip-planner.ts";
import { PiTripPlanner } from "../src/agents/pi-trip-planner.ts";
import type { SkillCatalogProvider } from "../src/agents/skill-management-service.ts";
import { FliggyHotelPriceSource } from "../src/services/fliggy-hotel-price-source.ts";

describe("default trip planner wiring", () => {
  it("passes the live skill catalog to its structured runner factory", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-default-planner-catalog-"));
    const skillCatalog = {
      snapshot: () => ({
        generation: 17,
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
    } satisfies SkillCatalogProvider;
    let receivedOptions: Parameters<NonNullable<Parameters<typeof createDefaultTripPlanner>[0]["runnerFactory"]>>[0] | undefined;
    try {
      const planner = createDefaultTripPlanner({
        cwd: tempRoot,
        dataDir: join(tempRoot, "data"),
        model: getModel("openai", "gpt-4o-mini")!,
        skillCatalog,
        runnerFactory: (options) => {
          receivedOptions = options;
          return { async run() { return {}; } };
        },
        settings: {
          vite_amap_web_key: "amap-secret",
          openai_api_key: "llm-secret",
          openai_base_url: "https://example.invalid/v1/",
          openai_model: "deepseek-v4-flash",
          llm_api_style: "responses",
          llm_timeout: 60,
          llm_thinking_enabled: true,
          llm_thinking_visible: true,
          trip_segment_days: 5,
          trip_segment_concurrency: 8,
          trip_review_enabled: true,
          trip_duplicate_repair_rounds: 2,
          fliggy_proxy_token: "",
          fliggy_proxy_url: "https://proxy.example/hotel",
          fliggy_price_timeout_ms: 3000,
          fliggy_price_cache_ttl_seconds: 300,
        },
      });
      expect(receivedOptions?.skillCatalog).toBe(skillCatalog);
      expect(receivedOptions?.thinkingEnabled).toBeTrue();
      expect(receivedOptions?.model.samplingParams?.thinking).toEqual({ type: "enabled" });
      expect((planner as unknown as { showThoughts: boolean }).showThoughts).toBeTrue();
      await planner.close();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("wires Pi subagents and AMap while keeping the API key out of models.json", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-default-planner-"));
    try {
      const planner = createDefaultTripPlanner({
        cwd: tempRoot,
        dataDir: join(tempRoot, "data"),
        model: getModel("openai", "gpt-4o-mini")!,
        settings: {
          vite_amap_web_key: "amap-secret",
          openai_api_key: "llm-secret",
          openai_base_url: "https://example.invalid/v1/",
          openai_model: "deepseek-v4-flash",
          llm_api_style: "responses",
          llm_timeout: 60,
          llm_thinking_enabled: false,
          llm_thinking_visible: true,
          trip_segment_days: 5,
          trip_segment_concurrency: 8,
          trip_review_enabled: true,
          trip_duplicate_repair_rounds: 2,
          fliggy_proxy_token: "fliggy-secret",
          fliggy_proxy_url: "https://proxy.example/hotel",
          fliggy_price_timeout_ms: 1200,
          fliggy_price_cache_ttl_seconds: 60,
        },
      });
      expect(planner).toBeInstanceOf(PiTripPlanner);
      expect((planner as unknown as { segmentDays: number }).segmentDays).toBe(5);
      expect((planner as unknown as { showThoughts: boolean }).showThoughts).toBeFalse();
      const hotelPrices = (planner as unknown as {
        options: { hotelPrices?: FliggyHotelPriceSource };
      }).options.hotelPrices;
      expect(hotelPrices).toBeInstanceOf(FliggyHotelPriceSource);
      expect((hotelPrices as unknown as { token: string }).token).toBe("fliggy-secret");
      const raw = readFileSync(join(tempRoot, "data", "pi-runtime", "agent", "models.json"), "utf8");
      expect(raw).toContain("$YOUBAN_PI_RUNTIME_API_KEY");
      expect(raw).not.toContain("llm-secret");
      expect(raw).not.toContain("fliggy-secret");
      expect(JSON.parse(raw).providers["youban-runtime"].models[0].samplingParams.thinking)
        .toEqual({ type: "disabled" });
      await planner.close();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
