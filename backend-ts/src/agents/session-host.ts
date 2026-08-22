import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  SubagentDelegationRequest,
  SubagentDelegationResponse,
} from "pi-subagents/delegation";
import { renderAssignedSkills } from "./skill-registry.ts";
import type { SkillCatalogSnapshot } from "./skill-types.ts";
import {
  createYoubanSubagentDefinitions,
  YOUBAN_SUBAGENT_NAMES,
} from "./subagent-definitions.ts";

interface RuntimeLease {
  runtimeDir: string;
  count: number;
  previousAgentDir: string | undefined;
  previousTempRoot: string | undefined;
}

let activeRuntimeLease: RuntimeLease | undefined;

export interface CreateYoubanAgentSessionOptions {
  cwd: string;
  runtimeDir: string;
  model: Model<Api>;
  subagentModel?: string;
  skillSnapshot: SkillCatalogSnapshot;
  tools?: readonly string[];
  customTools?: ToolDefinition[];
  sessionDir?: string;
}

export interface YoubanAgentSessionHost {
  session: AgentSession;
  resourceLoader: DefaultResourceLoader;
  extensionErrors: string[];
  generation: number;
  delegate(request: SubagentDelegationRequest): Promise<SubagentDelegationResponse>;
  cancel(request: Pick<SubagentDelegationRequest, "requestId" | "ownerRunId" | "nodeId">): void;
  dispose(): void;
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) delete process.env[name];
  else process.env[name] = previousValue;
}

function acquireRuntimeLease(runtimeDirInput: string): () => void {
  const runtimeDir = resolve(runtimeDirInput);
  if (activeRuntimeLease) {
    if (activeRuntimeLease.runtimeDir !== runtimeDir) {
      throw new Error(
        `Pi runtime is already bound to ${activeRuntimeLease.runtimeDir}; cannot switch to ${runtimeDir}`,
      );
    }
    activeRuntimeLease.count += 1;
  } else {
    const agentDir = join(runtimeDir, "agent");
    const tempRoot = join(runtimeDir, "subagents");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(tempRoot, { recursive: true });
    activeRuntimeLease = {
      runtimeDir,
      count: 1,
      previousAgentDir: process.env.PI_CODING_AGENT_DIR,
      previousTempRoot: process.env.PI_SUBAGENTS_TEMP_ROOT,
    };
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_SUBAGENTS_TEMP_ROOT = tempRoot;
  }

  let released = false;
  return () => {
    if (released || !activeRuntimeLease) return;
    released = true;
    activeRuntimeLease.count -= 1;
    if (activeRuntimeLease.count > 0) return;
    restoreEnv("PI_CODING_AGENT_DIR", activeRuntimeLease.previousAgentDir);
    restoreEnv("PI_SUBAGENTS_TEMP_ROOT", activeRuntimeLease.previousTempRoot);
    activeRuntimeLease = undefined;
  };
}

export async function createYoubanAgentSession(
  options: CreateYoubanAgentSessionOptions,
): Promise<YoubanAgentSessionHost> {
  const generation = options.skillSnapshot.generation;
  const parentSystemPrompt = renderAssignedSkills(options.skillSnapshot, "parent-assistant");
  const subagentDefinitions = createYoubanSubagentDefinitions(options.skillSnapshot);
  const releaseRuntime = acquireRuntimeLease(options.runtimeDir);
  let session: AgentSession | undefined;

  try {
    const [
      { default: registerSubagents },
      { registerAgent },
      { registerSubagentCapabilityCeiling },
      delegation,
    ] = await Promise.all([
      import("pi-subagents"),
      import("pi-subagents/agents"),
      import("pi-subagents/capability-ceiling"),
      import("pi-subagents/delegation"),
    ]);
    const agentDir = process.env.PI_CODING_AGENT_DIR!;
    const eventBus = createEventBus();
    const settingsManager = SettingsManager.inMemory({
      packages: [],
      compaction: { enabled: false },
      retry: { enabled: false },
      quietStartup: true,
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir,
      eventBus,
      settingsManager,
      extensionFactories: [
        {
          name: "pi-subagents",
          factory(pi) {
            for (const agent of subagentDefinitions) {
              registerAgent({
                pi,
                name: agent.name,
                definition: {
                  ...agent.definition,
                  model:
                    options.subagentModel ??
                    `${options.model.provider}/${options.model.id}`,
                },
              });
            }
            registerSubagents(pi);
          },
        },
      ],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      appendSystemPrompt: [parentSystemPrompt].filter(Boolean),
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
    });
    await resourceLoader.reload();

    const result = await createAgentSession({
      cwd: options.cwd,
      agentDir,
      model: options.model,
      tools: [...(options.tools ?? [])],
      customTools: options.customTools,
      resourceLoader,
      sessionManager: options.sessionDir
        ? SessionManager.continueRecent(options.cwd, options.sessionDir)
        : SessionManager.inMemory(options.cwd),
      settingsManager,
    });
    session = result.session;
    await session.bindExtensions({});
    const capabilityCeiling = registerSubagentCapabilityCeiling({
      sessionId: session.sessionId,
      source: "youban-server",
      ceiling: {
        allowedAgents: YOUBAN_SUBAGENT_NAMES,
        allowedTools: [],
        denyExtensions: true,
      },
    });
    const pendingDelegations = new Set<(error: Error) => void>();

    const delegate = (
      request: SubagentDelegationRequest,
    ): Promise<SubagentDelegationResponse> => {
      if (
        request.result.kind === "structured" &&
        request.toolBudget?.hard === 0 &&
        request.toolBudget.block === "*"
      ) {
        return Promise.reject(
          new Error(
            'Structured delegation cannot use toolBudget.block="*" because pi-subagents 0.53.0 blocks its internal structured_output tool',
          ),
        );
      }

      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = () => {};
        const rejectPending = (error: Error) => {
          unsubscribe();
          if (timer) clearTimeout(timer);
          pendingDelegations.delete(rejectPending);
          reject(error);
        };
        unsubscribe = eventBus.on(
          delegation.SUBAGENT_DELEGATION_RESPONSE_EVENT,
          (payload) => {
            const response = payload as SubagentDelegationResponse;
            if (response.requestId !== request.requestId) return;
            if (response.ownerRunId !== request.ownerRunId) return;
            if (response.nodeId !== request.nodeId) return;
            unsubscribe();
            if (timer) clearTimeout(timer);
            pendingDelegations.delete(rejectPending);
            resolve(response);
          },
        );
        const timeoutMs = Math.min((request.timeoutMs ?? 30_000) + 5_000, 2_147_483_647);
        timer = setTimeout(
          () => rejectPending(new Error(`Delegated subagent timed out in host: ${request.nodeId}`)),
          timeoutMs,
        );
        pendingDelegations.add(rejectPending);
        eventBus.emit(delegation.SUBAGENT_DELEGATION_REQUEST_EVENT, request);
      });
    };

    let disposed = false;
    return {
      session,
      resourceLoader,
      extensionErrors: result.extensionsResult.errors.map(
        (error) => `${error.path}: ${error.error}`,
      ),
      generation,
      delegate,
      cancel(request) {
        eventBus.emit(delegation.SUBAGENT_DELEGATION_CANCEL_EVENT, request);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const reject of [...pendingDelegations]) {
          reject(new Error("Pi session host was disposed"));
        }
        capabilityCeiling.dispose();
        session?.dispose();
        eventBus.clear();
        releaseRuntime();
      },
    };
  } catch (error) {
    session?.dispose();
    releaseRuntime();
    throw error;
  }
}
