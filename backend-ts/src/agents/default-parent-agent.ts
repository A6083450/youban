import { join } from "node:path";
import { getSettings } from "../config/settings.ts";
import type { SqliteTaskStore } from "../domain/task-store.ts";
import type { UserMemoryService } from "../services/hermes-memory.ts";
import { getPiLlmClient } from "./llm/providers.ts";
import { createParentBusinessTools } from "./parent-business-tools.ts";
import { PersistentPiParentAgent } from "./persistent-parent-agent.ts";
import { writeRuntimeModelConfig } from "./pi-subagent-runner.ts";

export function createDefaultParentAgent(options: {
  cwd: string;
  dataDir: string;
  tasks: SqliteTaskStore;
  memory: UserMemoryService;
}): PersistentPiParentAgent {
  const settings = getSettings();
  const runtimeDir = join(options.dataDir, "pi-runtime");
  writeRuntimeModelConfig(runtimeDir, {
    baseUrl: settings.openai_base_url,
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
  });
  return new PersistentPiParentAgent({
    cwd: options.cwd,
    runtimeDir,
    model: getPiLlmClient().model,
    subagentModel: `youban-runtime/${settings.openai_model}`,
    apiKey: settings.openai_api_key,
    timeoutMs: settings.llm_timeout * 1_000,
    sessionLimit: settings.pi_parent_session_limit,
    sessionIdleMs: settings.pi_parent_session_idle_seconds * 1_000,
    toolsForScope: (scope) => createParentBusinessTools(scope, options),
  });
}
