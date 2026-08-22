import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createDefaultTripPlanner } from "../src/agents/default-trip-planner.ts";
import { PiTripPlanner } from "../src/agents/pi-trip-planner.ts";

describe("default trip planner wiring", () => {
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
          trip_segment_days: 5,
          trip_segment_concurrency: 8,
          trip_review_enabled: true,
          trip_duplicate_repair_rounds: 2,
        },
      });
      expect(planner).toBeInstanceOf(PiTripPlanner);
      expect((planner as unknown as { segmentDays: number }).segmentDays).toBe(5);
      const raw = readFileSync(join(tempRoot, "data", "pi-runtime", "agent", "models.json"), "utf8");
      expect(raw).toContain("$YOUBAN_PI_RUNTIME_API_KEY");
      expect(raw).not.toContain("llm-secret");
      await planner.close();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
