import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AppSettings } from "../config/settings.ts";
import { getSettings } from "../config/settings.ts";
import type { SqliteTaskStore } from "../domain/task-store.ts";
import type { UserMemoryService } from "../services/hermes-memory.ts";
import { getPiLlmClient } from "./llm/providers.ts";
import { createParentBusinessTools } from "./parent-business-tools.ts";
import { PersistentPiParentAgent } from "./persistent-parent-agent.ts";
import { writeRuntimeModelConfig } from "./pi-subagent-runner.ts";
import type { SkillCatalogProvider } from "./skill-management-service.ts";
import type { SkillRuntimeDiagnostics } from "./skill-runtime-diagnostics.ts";

export function createDefaultParentAgent(options: {
  cwd: string;
  dataDir: string;
  tasks: SqliteTaskStore;
  memory: UserMemoryService;
  runtimeDir?: string;
  model?: Model<Api>;
  skillCatalog?: SkillCatalogProvider;
  skillRuntimeDiagnostics?: SkillRuntimeDiagnostics;
  settings?: Pick<AppSettings,
    | "openai_api_key"
    | "openai_base_url"
    | "openai_model"
    | "llm_api_style"
    | "llm_timeout"
    | "pi_parent_session_limit"
    | "pi_parent_session_idle_seconds"
  >;
}): PersistentPiParentAgent {
  const settings = options.settings ?? getSettings();
  const runtimeDir = options.runtimeDir ?? join(options.dataDir, "pi-runtime");
  writeRuntimeModelConfig(runtimeDir, {
    baseUrl: settings.openai_base_url,
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
  });
  return new PersistentPiParentAgent({
    cwd: options.cwd,
    runtimeDir,
    model: options.model ?? getPiLlmClient().model,
    subagentModel: `youban-runtime/${settings.openai_model}`,
    apiKey: settings.openai_api_key,
    timeoutMs: settings.llm_timeout * 1_000,
    sessionLimit: settings.pi_parent_session_limit,
    sessionIdleMs: settings.pi_parent_session_idle_seconds * 1_000,
    skillCatalog: options.skillCatalog,
    skillRuntimeDiagnostics: options.skillRuntimeDiagnostics,
    toolsForScope: (scope) => createParentBusinessTools(scope, options),
  });
}
