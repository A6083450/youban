import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getSettings } from "../config/settings.ts";
import { AmapResearchSources } from "../services/amap-research-sources.ts";
import { getPiLlmClient } from "./llm/providers.ts";
import {
  PiSubagentRunner,
  type PiSubagentRunnerOptions,
  writeRuntimeModelConfig,
} from "./pi-subagent-runner.ts";
import { PiTripPlanner, type StructuredAgentRunner } from "./pi-trip-planner.ts";
import type { SkillCatalogProvider } from "./skill-management-service.ts";
import type { SkillRuntimeDiagnostics } from "./skill-runtime-diagnostics.ts";

interface DefaultTripPlannerSettings {
  vite_amap_web_key: string;
  openai_api_key: string;
  openai_base_url: string;
  openai_model: string;
  llm_api_style: "responses" | "completions";
  llm_timeout: number;
  trip_planner_timeout?: number;
  trip_segment_days: number;
  trip_segment_concurrency: number;
  trip_review_enabled: boolean;
  trip_duplicate_repair_rounds: number;
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
  });
  const runnerOptions: PiSubagentRunnerOptions = {
    cwd: options.cwd,
    runtimeDir,
    model: options.model ?? getPiLlmClient().model,
    subagentModel: `youban-runtime/${settings.openai_model}`,
    apiKey: settings.openai_api_key,
    timeoutMs: (settings.trip_planner_timeout ?? settings.llm_timeout) * 1_000,
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
  });
}
