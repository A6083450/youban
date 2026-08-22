import { join } from "node:path";
import { getSettings } from "../config/settings.ts";
import { HermesMemoryBridge } from "../services/hermes-memory.ts";
import { getPiLlmClient } from "./llm/providers.ts";
import { PiSubagentRunner, writeRuntimeModelConfig } from "./pi-subagent-runner.ts";
import { TripChatService } from "./trip-chat-service.ts";
import type { YoubanParentAgent } from "./persistent-parent-agent.ts";
import type { TripMemory } from "../services/hermes-memory.ts";

export function createDefaultTripChatService(options: {
  cwd: string;
  dataDir: string;
  parentAgent?: YoubanParentAgent;
  memory?: TripMemory;
}): TripChatService {
  const settings = getSettings();
  const runtimeDir = join(options.dataDir, "pi-runtime");
  writeRuntimeModelConfig(runtimeDir, {
    baseUrl: settings.openai_base_url,
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
  });
  return new TripChatService({
    llm: getPiLlmClient(),
    mode: settings.chat_edit_agent,
    memory: options.memory ?? new HermesMemoryBridge({ dataDir: options.dataDir }),
    parentAgent: options.parentAgent,
    agents: options.parentAgent ? undefined : new PiSubagentRunner({
      cwd: options.cwd,
      runtimeDir,
      model: getPiLlmClient().model,
      subagentModel: `youban-runtime/${settings.openai_model}`,
      apiKey: settings.openai_api_key,
      timeoutMs: settings.llm_timeout * 1_000,
    }),
  });
}
