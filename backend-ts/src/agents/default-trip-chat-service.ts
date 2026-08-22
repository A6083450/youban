import { join } from "node:path";
import type { AppSettings } from "../config/settings.ts";
import { getSettings } from "../config/settings.ts";
import { HermesMemoryBridge } from "../services/hermes-memory.ts";
import { getPiLlmClient, type LlmClient } from "./llm/providers.ts";
import { PiSubagentRunner, writeRuntimeModelConfig } from "./pi-subagent-runner.ts";
import { TripChatService } from "./trip-chat-service.ts";
import type { YoubanParentAgent } from "./persistent-parent-agent.ts";
import type { TripMemory } from "../services/hermes-memory.ts";

export function createDefaultTripChatService(options: {
  cwd: string;
  dataDir: string;
  parentAgent?: YoubanParentAgent;
  memory?: TripMemory;
  runtimeDir?: string;
  llm?: LlmClient;
  settings?: Pick<AppSettings,
    | "openai_api_key"
    | "openai_base_url"
    | "openai_model"
    | "llm_api_style"
    | "llm_timeout"
    | "chat_edit_agent"
  >;
}): TripChatService {
  const settings = options.settings ?? getSettings();
  const runtimeDir = options.runtimeDir ?? join(options.dataDir, "pi-runtime");
  const llm = options.llm ?? getPiLlmClient();
  writeRuntimeModelConfig(runtimeDir, {
    baseUrl: settings.openai_base_url,
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
  });
  return new TripChatService({
    llm,
    mode: settings.chat_edit_agent,
    memory: options.memory ?? new HermesMemoryBridge({ dataDir: options.dataDir }),
    parentAgent: options.parentAgent,
    agents: options.parentAgent ? undefined : new PiSubagentRunner({
      cwd: options.cwd,
      runtimeDir,
      model: llm.model,
      subagentModel: `youban-runtime/${settings.openai_model}`,
      apiKey: settings.openai_api_key,
      timeoutMs: settings.llm_timeout * 1_000,
    }),
  });
}
