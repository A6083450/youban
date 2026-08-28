import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { effectiveThinkingVisible, getSettings } from "../config/settings.ts";
import { AmapResearchSources } from "../services/amap-research-sources.ts";
import { getPiLlmClient, withThinkingSamplingParams } from "./llm/providers.ts";
import {
  PiSubagentRunner,
  type PiSubagentRunnerOptions,
  writeRuntimeModelConfig,
} from "./pi-subagent-runner.ts";
import { PiTripPlanner, type StructuredAgentRunner } from "./pi-trip-planner.ts";
import type { SkillCatalogProvider } from "./skill-management-service.ts";
import type { SkillRuntimeDiagnostics } from "./skill-runtime-diagnostics.ts";
import { FliggyHotelPriceSource } from "../services/fliggy-hotel-price-source.ts";

interface DefaultTripPlannerSettings {
  vite_amap_web_key: string;
  openai_api_key: string;
  openai_base_url: string;
  openai_model: string;
  llm_api_style: "responses" | "completions";
  llm_timeout: number;
  llm_thinking_enabled: boolean;
  llm_thinking_visible: boolean;
  trip_planner_timeout?: number;
  trip_segment_days: number;
  trip_segment_concurrency: number;
  trip_review_enabled: boolean;
  trip_duplicate_repair_rounds: number;
  fliggy_proxy_token: string;
  fliggy_proxy_url: string;
  fliggy_price_timeout_ms: number;
  fliggy_price_cache_ttl_seconds: number;
}

export interface DefaultTripPlannerOptions {
  cwd: string;
  dataDir: string;
  runtimeDir?: string;
  model?: Model<Api>;
  skillCatalog?: SkillCatalogProvider;
  skillRuntimeDiagnostics?: SkillRuntimeDiagnostics;
  runnerFactory?: (options: PiSubagentRunnerOptions) => StructuredAgentRunner;
  settings?: DefaultTripPlannerSettings;
}

export function createDefaultTripPlanner(options: DefaultTripPlannerOptions): PiTripPlanner {
  const settings = options.settings ?? getSettings();
  const runtimeDir = options.runtimeDir ?? join(options.dataDir, "pi-runtime");
  writeRuntimeModelConfig(runtimeDir, {
    baseUrl: settings.openai_base_url,
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
    thinkingEnabled: settings.llm_thinking_enabled,
  });
  const model = withThinkingSamplingParams(
    options.model ?? getPiLlmClient().model,
    settings.llm_thinking_enabled,
  );
  const runnerOptions: PiSubagentRunnerOptions = {
    cwd: options.cwd,
    runtimeDir,
    model,
    subagentModel: `youban-runtime/${settings.openai_model}`,
    apiKey: settings.openai_api_key,
    timeoutMs: (settings.trip_planner_timeout ?? settings.llm_timeout) * 1_000,
    thinkingEnabled: settings.llm_thinking_enabled,
    skillCatalog: options.skillCatalog,
    skillRuntimeDiagnostics: options.skillRuntimeDiagnostics,
  };
  const agents = options.runnerFactory?.(runnerOptions) ?? new PiSubagentRunner(runnerOptions);
  return new PiTripPlanner({
    research: new AmapResearchSources({ apiKey: settings.vite_amap_web_key }),
    agents,
    segmentDays: settings.trip_segment_days,
    segmentConcurrency: settings.trip_segment_concurrency,
    reviewEnabled: settings.trip_review_enabled,
    duplicateRepairRounds: settings.trip_duplicate_repair_rounds,
    showThoughts: effectiveThinkingVisible(settings),
    hotelPrices: new FliggyHotelPriceSource({
      token: settings.fliggy_proxy_token,
      baseUrl: settings.fliggy_proxy_url,
      timeoutMs: settings.fliggy_price_timeout_ms,
      cacheTtlMs: settings.fliggy_price_cache_ttl_seconds * 1_000,
    }),
  });
}
