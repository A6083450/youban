import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { Elysia, t } from "elysia";
import {
  createDefaultTripChatService,
  type DefaultTripChatServiceOptions,
} from "../agents/default-trip-chat-service.ts";
import {
  createDefaultParentAgent,
  type DefaultParentAgentOptions,
} from "../agents/default-parent-agent.ts";
import {
  createDefaultTripPlanner,
  type DefaultTripPlannerOptions,
} from "../agents/default-trip-planner.ts";
import { SkillManagementService } from "../agents/skill-management-service.ts";
import { SkillRuntimeDiagnostics } from "../agents/skill-runtime-diagnostics.ts";
import { TripAssistant } from "../agents/trip-assistant.ts";
import { ConversationTitleService } from "../agents/conversation-title.ts";
import { createPiLlmClient, getPiLlmClient } from "../agents/llm/providers.ts";
import type { TripPlanner } from "../agents/trip-planner.ts";
import {
  planRevision,
  RevisionConflictError,
  TripChatService,
  UnsafePlanPatchError,
} from "../agents/trip-chat-service.ts";
import { getRepoRoot } from "../config/paths.ts";
import {
  effectiveThinkingVisible,
  getSettings,
  prepareRuntimeSettings,
  type AppSettings,
  type RuntimeSettings,
} from "../config/settings.ts";
import { ConfirmationLedger } from "../domain/confirmation.ts";
import { ConversationRepository } from "../domain/conversations.ts";
import { ConversationRecordService } from "../domain/conversation-records.ts";
import { ConversationSessionRepository, SessionRevisionConflictError } from "../domain/conversation-sessions.ts";
import {
  budgetLedgerResponse,
  syncBudgetItems,
  toGroupTotal,
  type AmountBasis,
  type BudgetItemType,
  type BudgetLedgerItem,
} from "../domain/budget-ledger.ts";
import {
  cityForDay,
  createAttraction,
  deleteAttraction,
  ItineraryMutationError,
  planData,
  updateAttraction,
  type AttractionMutationInput,
} from "../domain/itinerary-attractions.ts";
import { emptyCheckpoint, normalizeCheckpoint, type TripPlanningRequest } from "../domain/orchestrator.ts";
import {
  AuthResponseSchema,
  ConversationRecordListSchema,
  ConversationRecordSchema,
  ConversationSessionDetailSchema,
  CreateConversationBodySchema,
  DetailErrorSchema,
  LoginBodySchema,
  ReplaceConversationSnapshotBodySchema,
  TripHistoryResponseSchema,
} from "../domain/schemas.ts";
import {
  buildCheckpointSummary,
  buildTaskEvent,
  createTaskState,
  SqliteTaskStore,
  type TripTaskState,
} from "../domain/task-store.ts";
import { normalizeTripPlanningRequest } from "../domain/trip-request.ts";
import { SqliteUserRepository, UserInputError } from "../domain/users.ts";
import { AmapResearchSources, type TrustedPoi } from "../services/amap-research-sources.ts";
import { HermesMemoryBridge, type UserMemoryService } from "../services/hermes-memory.ts";
import type { ParentAgentScope, YoubanParentAgent } from "../agents/persistent-parent-agent.ts";
import {
  adminSkillValidationFailure,
  createAdminSkillRoutes,
  type AdminSkillService,
} from "./admin-skills.ts";
import { sseResponse } from "./sse.ts";

interface PoiSearch {
  searchPoi(keywords: string, city: string, types?: string): Promise<TrustedPoi[]>;
  getPoiPhoto?(name: string, city?: string): Promise<string>;
}

const AttractionMutationBodySchema = t.Object({
  day_index: t.Number({ minimum: 0 }),
  poi_id: t.String({ minLength: 1, maxLength: 80 }),
  name: t.String({ minLength: 1, maxLength: 120 }),
  address: t.Optional(t.String({ maxLength: 300 })),
  location: t.Object({ longitude: t.Number(), latitude: t.Number() }),
  visit_duration: t.Number({ minimum: 30, maximum: 720 }),
  description: t.Optional(t.String({ maxLength: 1_000 })),
  ticket_price: t.Number({ minimum: 0, maximum: 1_000_000 }),
  start_time: t.String({ minLength: 5, maxLength: 5 }),
  reservation_required: t.Optional(t.Boolean()),
  reservation_tips: t.Optional(t.String({ maxLength: 500 })),
});

export interface HttpRuntimeOptions {
  dataDir: string;
  frontendDist?: string;
  corsOrigins?: string[];
  assistant?: TripAssistant;
  planner?: TripPlanner;
  chatService?: TripChatService;
  poiSearch?: PoiSearch;
  memory?: UserMemoryService;
  parentAgent?: YoubanParentAgent;
  skillService?: AdminSkillService;
  skillRuntimeDiagnostics?: SkillRuntimeDiagnostics;
  conversationTitleService?: ConversationTitleService;
  serviceFactories?: {
    parentAgent?: (options: DefaultParentAgentOptions) => YoubanParentAgent;
    planner?: (options: DefaultTripPlannerOptions) => TripPlanner;
    chatService?: (options: DefaultTripChatServiceOptions) => TripChatService;
    poiSearch?: (settings: AppSettings) => PoiSearch;
  };
}

function settleResourceClose(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    return Promise.resolve(operation()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function failedEvent(taskId: string, error: string): Record<string, unknown> {
  return {
    task_id: taskId,
    plan_id: taskId,
    status: "failed",
    stage: "failed",
    progress: 100,
    message: error,
    error,
  };
}

function piGenerationRuntimeDir(dataDir: string, settings: AppSettings): string {
  const signature = JSON.stringify({
    baseUrl: settings.openai_base_url.replace(/\/+$/, ""),
    model: settings.openai_model,
    apiStyle: settings.llm_api_style,
    thinkingEnabled: settings.llm_thinking_enabled,
  });
  const generation = new Bun.CryptoHasher("sha256").update(signature).digest("hex").slice(0, 16);
  return join(dataDir, "pi-runtime", "generations", generation);
}

function isContained(parent: string, child: string): boolean {
  const root = resolve(parent) + sep;
  return resolve(child).startsWith(root);
}

const NO_CACHE_FRONTEND_FILES = new Set([
  "index.html",
  "sw.js",
  "registerSW.js",
  "manifest.webmanifest",
]);

function frontendResponse(frontendDist: string | undefined, pathname: string): Response | null {
  if (!frontendDist) return null;
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!relative) relative = "index.html";
  const path = join(frontendDist, relative);
  if (!isContained(frontendDist, path) || !existsSync(path)) return null;
  const headers = new Headers();
  if (NO_CACHE_FRONTEND_FILES.has(relative)) headers.set("Cache-Control", "no-cache");
  return new Response(Bun.file(path), { headers });
}

export function createHttpRuntime(options: HttpRuntimeOptions) {
  const databasePath = join(options.dataDir, "youban.db");
  const imagesDir = join(options.dataDir, "images");
  const tasks = new SqliteTaskStore(databasePath);
  const users = new SqliteUserRepository(databasePath);
  const conversations = new ConversationRepository(databasePath);
  const conversationRecords = new ConversationRecordService(
    new ConversationSessionRepository(databasePath),
    tasks,
    imagesDir,
  );
  const ownedMemory = options.memory ? undefined : new HermesMemoryBridge({ dataDir: options.dataDir });
  const memory = options.memory ?? ownedMemory!;
  const settings = getSettings();
  const repoRoot = getRepoRoot();
  const skills = options.skillService ?? new SkillManagementService({
    databasePath,
    dataDir: join(options.dataDir, "skills"),
    builtinSkillsDir: join(repoRoot, "backend-ts", "src", "agents", "skills"),
  });
  const skillRuntimeDiagnostics = options.skillRuntimeDiagnostics ?? new SkillRuntimeDiagnostics();
  const initialGenerationRuntimeDir = piGenerationRuntimeDir(options.dataDir, settings);
  let parentAgent!: YoubanParentAgent;
  let assistant!: TripAssistant;
  let planner!: TripPlanner;
  let chatService!: TripChatService;
  let poiSearch!: PoiSearch;
  const confirmationLedger = options.assistant?.ledger ?? new ConfirmationLedger();
  try {
    const parentOptions: DefaultParentAgentOptions = {
      cwd: repoRoot,
      dataDir: options.dataDir,
      runtimeDir: initialGenerationRuntimeDir,
      tasks,
      memory,
      settings,
      skillCatalog: skills,
      skillRuntimeDiagnostics,
    };
    parentAgent = options.parentAgent
      ?? options.serviceFactories?.parentAgent?.(parentOptions)
      ?? createDefaultParentAgent(parentOptions);
    assistant = options.assistant ?? new TripAssistant({
      llm: getPiLlmClient(),
      ledger: confirmationLedger,
      thinkingEnabled: settings.llm_thinking_enabled,
    });
    const plannerOptions: DefaultTripPlannerOptions = {
      cwd: repoRoot,
      dataDir: options.dataDir,
      runtimeDir: initialGenerationRuntimeDir,
      settings,
      skillCatalog: skills,
      skillRuntimeDiagnostics,
    };
    planner = options.planner
      ?? options.serviceFactories?.planner?.(plannerOptions)
      ?? createDefaultTripPlanner(plannerOptions);
    const chatOptions: DefaultTripChatServiceOptions = {
      cwd: repoRoot,
      dataDir: options.dataDir,
      runtimeDir: initialGenerationRuntimeDir,
      parentAgent,
      memory,
      settings,
      skillCatalog: skills,
      skillRuntimeDiagnostics,
    };
    chatService = options.chatService
      ?? options.serviceFactories?.chatService?.(chatOptions)
      ?? createDefaultTripChatService(chatOptions);
    poiSearch = options.poiSearch
      ?? options.serviceFactories?.poiSearch?.(settings)
      ?? new AmapResearchSources({ apiKey: settings.vite_amap_web_key });
  } catch (error) {
    for (const closeStore of [
      () => tasks.close(),
      () => users.close(),
      () => conversations.close(),
      () => conversationRecords.close(),
    ]) {
      try {
        closeStore();
      } catch {
        // Construction must preserve its original error while closing every owned store.
      }
    }
    const generatedResourceCloses = [
      ...(!options.chatService && chatService
        ? [settleResourceClose(() => chatService.close())]
        : []),
      ...(!options.planner && planner
        ? [settleResourceClose(() => planner.close?.())]
        : []),
      ...(!options.parentAgent && parentAgent
        ? [settleResourceClose(() => parentAgent.close())]
        : []),
    ];
    void Promise.allSettled(generatedResourceCloses).then(async () => {
      if (ownedMemory) await settleResourceClose(() => ownedMemory.close());
      if (options.skillService) return;
      try {
        skills.close();
      } catch {
        // Cleanup failure must not become an unhandled rejection or mask construction.
      }
    });
    throw error;
  }
  const planningAbort = new AbortController();
  const adminPasswordFile = join(options.dataDir, "admin_password.txt");
  const frontendDist = options.frontendDist;
  const unsubscribers = new Map<string, () => void>();
  const webSockets = new Map<string, { close(code?: number, reason?: string): void }>();
  const activeRuns = new Set<Promise<void>>();
  const activeServiceCalls = new Set<Promise<unknown>>();
  const titleJobs = new Map<string, Promise<void>>();
  let serviceGate = Promise.resolve();
  let settingsRefreshTail = Promise.resolve();
  let pendingSettingsRefreshes = 0;
  let activeGenerationRuntimeDir = initialGenerationRuntimeDir;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let dispatchRewritten: (request: Request) => Response | Promise<Response>;
  const createConversationTitleService = (): ConversationTitleService => {
    const llm = getPiLlmClient();
    return new ConversationTitleService({
      agentComplete(prompt, callOptions) {
        if (!llm.agentComplete) throw new Error("runtime model does not support Pi agent completion");
        return llm.agentComplete(prompt, callOptions);
      },
    });
  };

  const startConversationTitle = (
    sessionId: string,
    userId: string,
    firstMessage: string,
    titleStatus: string,
  ): void => {
    if (closed || titleStatus !== "pending" || titleJobs.has(sessionId)) return;
    let job!: Promise<void>;
    job = Promise.resolve()
      .then(() => (options.conversationTitleService ?? createConversationTitleService()).infer(firstMessage))
      .then((title) => { conversationRecords.setTitle(sessionId, userId, title); })
      .catch(() => undefined)
      .finally(() => {
        if (titleJobs.get(sessionId) === job) titleJobs.delete(sessionId);
      });
    titleJobs.set(sessionId, job);
  };

  mkdirSync(options.dataDir, { recursive: true });
  if (!existsSync(adminPasswordFile)) writeFileSync(adminPasswordFile, "admin@123\n", { encoding: "utf8", mode: 0o600 });

  const readAdminPassword = (): string => {
    const value = readFileSync(adminPasswordFile, "utf8").trim();
    return value || "admin@123";
  };

  const secureEqual = (left: string, right: string): boolean => {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  };

  const validAdminToken = (headers: Record<string, string | undefined>): boolean => {
    const token = headers["x-admin-token"] ?? "";
    return Boolean(token) && secureEqual(token, readAdminPassword());
  };

  const parentScope = (headers: Record<string, string | undefined>, planId?: string): ParentAgentScope => {
    const userId = (headers["x-user-id"] ?? "").trim();
    return {
      key: planId && userId
        ? `plan:${userId}:${planId}`
        : userId
          ? `user:${userId}`
          : `anonymous:${crypto.randomUUID()}`,
      userId,
      planId,
    };
  };

  const withServices = async <T>(run: (services: {
    assistant: TripAssistant;
    planner: TripPlanner;
    chatService: TripChatService;
  }) => Promise<T>): Promise<T> => {
    await serviceGate;
    if (closed) throw new Error("HTTP runtime is closed");
    const services = { assistant, planner, chatService };
    const operation = Promise.resolve().then(() => run(services));
    activeServiceCalls.add(operation);
    try {
      return await operation;
    } finally {
      activeServiceCalls.delete(operation);
    }
  };

  const withSkillService = async <T>(run: () => T | Promise<T>): Promise<T> => {
    await serviceGate;
    if (closed) throw new Error("HTTP runtime is closed");
    const operation = Promise.resolve().then(run);
    activeServiceCalls.add(operation);
    try {
      return await operation;
    } finally {
      activeServiceCalls.delete(operation);
    }
  };

  const llmConfig = (value: AppSettings) => ({
    apiKey: value.openai_api_key,
    baseUrl: value.openai_base_url,
    model: value.openai_model,
    apiStyle: value.llm_api_style,
    timeoutMs: value.llm_timeout * 1_000,
  });

  const removeGenerationRuntimeDir = (path: string): void => {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch (error) {
      console.warn(`候选服务运行目录清理失败: ${error}`);
    }
  };

  const applyRuntimeSettings = (input: Partial<RuntimeSettings>): Promise<AppSettings> => {
    pendingSettingsRefreshes += 1;
    const operation = settingsRefreshTail.then(async () => {
      const previousGate = serviceGate;
      let releaseGate!: () => void;
      const blocked = new Promise<void>((resolve) => { releaseGate = resolve; });
      serviceGate = previousGate.then(() => blocked);
      await previousGate;
      try {
        await Promise.allSettled([...activeServiceCalls]);
        const prepared = prepareRuntimeSettings(input);
        const candidateSettings = prepared.settings;
        const candidateRuntimeDir = piGenerationRuntimeDir(options.dataDir, candidateSettings);
        const candidateRuntimeDirExisted = existsSync(candidateRuntimeDir);
        const previousParent = parentAgent;
        const previousPlanner = planner;
        const previousChatService = chatService;
        let nextParent: YoubanParentAgent | undefined;
        let nextPlanner: TripPlanner | undefined;
        let nextChatService: TripChatService | undefined;
        let nextAssistant: TripAssistant | undefined;
        let nextPoiSearch: PoiSearch | undefined;
        try {
          const candidateLlm = createPiLlmClient(llmConfig(candidateSettings));
          const parentOptions: DefaultParentAgentOptions = {
            cwd: repoRoot,
            dataDir: options.dataDir,
            runtimeDir: candidateRuntimeDir,
            tasks,
            memory,
            model: candidateLlm.model,
            settings: candidateSettings,
            skillCatalog: skills,
            skillRuntimeDiagnostics,
          };
          nextParent = options.parentAgent ?? options.serviceFactories?.parentAgent?.(parentOptions)
            ?? createDefaultParentAgent(parentOptions);
          nextAssistant = options.assistant ?? new TripAssistant({
            llm: candidateLlm,
            ledger: confirmationLedger,
            thinkingEnabled: candidateSettings.llm_thinking_enabled,
          });
          const plannerOptions: DefaultTripPlannerOptions = {
            cwd: repoRoot,
            dataDir: options.dataDir,
            runtimeDir: candidateRuntimeDir,
            model: candidateLlm.model,
            settings: candidateSettings,
            skillCatalog: skills,
            skillRuntimeDiagnostics,
          };
          nextPlanner = options.planner ?? options.serviceFactories?.planner?.(plannerOptions)
            ?? createDefaultTripPlanner(plannerOptions);
          const chatOptions: DefaultTripChatServiceOptions = {
            cwd: repoRoot,
            dataDir: options.dataDir,
            runtimeDir: candidateRuntimeDir,
            parentAgent: nextParent,
            memory,
            llm: candidateLlm,
            settings: candidateSettings,
            skillCatalog: skills,
            skillRuntimeDiagnostics,
          };
          nextChatService = options.chatService
            ?? options.serviceFactories?.chatService?.(chatOptions)
            ?? createDefaultTripChatService(chatOptions);
          nextPoiSearch = options.poiSearch
            ?? options.serviceFactories?.poiSearch?.(candidateSettings)
            ?? new AmapResearchSources({ apiKey: candidateSettings.vite_amap_web_key });
        } catch (error) {
          const failedChatService = nextChatService;
          const failedPlanner = nextPlanner;
          const failedParent = nextParent;
          await Promise.allSettled([
            ...(!options.chatService && failedChatService
              ? [settleResourceClose(() => failedChatService.close())]
              : []),
            ...(!options.planner && failedPlanner
              ? [settleResourceClose(() => failedPlanner.close?.())]
              : []),
            ...(!options.parentAgent && failedParent
              ? [settleResourceClose(() => failedParent.close())]
              : []),
          ]);
          if (!candidateRuntimeDirExisted && candidateRuntimeDir !== activeGenerationRuntimeDir) {
            removeGenerationRuntimeDir(candidateRuntimeDir);
          }
          throw error;
        }

        let updated: AppSettings;
        try {
          updated = prepared.commit();
        } catch (error) {
          await Promise.allSettled([
            ...(!options.chatService ? [settleResourceClose(() => nextChatService.close())] : []),
            ...(!options.planner ? [settleResourceClose(() => nextPlanner.close?.())] : []),
            ...(!options.parentAgent ? [settleResourceClose(() => nextParent.close())] : []),
          ]);
          if (!candidateRuntimeDirExisted && candidateRuntimeDir !== activeGenerationRuntimeDir) {
            removeGenerationRuntimeDir(candidateRuntimeDir);
          }
          throw error;
        }

        parentAgent = nextParent;
        assistant = nextAssistant;
        planner = nextPlanner;
        chatService = nextChatService;
        poiSearch = nextPoiSearch;
        activeGenerationRuntimeDir = candidateRuntimeDir;

        await Promise.allSettled([
          ...(!options.parentAgent ? [settleResourceClose(() => previousParent.close())] : []),
          ...(!options.planner ? [settleResourceClose(() => previousPlanner.close?.())] : []),
          ...(!options.chatService ? [settleResourceClose(() => previousChatService.close())] : []),
        ]);
        return updated;
      } finally {
        releaseGate();
      }
    });
    settingsRefreshTail = operation.then(
      () => { pendingSettingsRefreshes -= 1; },
      () => { pendingSettingsRefreshes -= 1; },
    );
    return operation;
  };

  const planningResponse = (taskId: string, message: string) => ({
    task_id: taskId,
    plan_id: taskId,
    status: "processing" as const,
    ws_url: `/api/trip/ws/${taskId}`,
    message,
  });

  const requireTaskOwner = (
    task: TripTaskState,
    userId: string,
    adminToken = "",
  ): { status: 403 | 404; detail: string } | null => {
    if (adminToken && secureEqual(adminToken, readAdminPassword())) return null;
    if (task.user_id && task.user_id !== userId.trim()) {
      return { status: 403, detail: "无权访问该计划" };
    }
    return null;
  };

  const requireOwner = (
    task: TripTaskState,
    userId: string,
    adminToken = "",
  ): { status: 403 | 404; detail: string } | null => {
    if (adminToken && secureEqual(adminToken, readAdminPassword())) return null;
    if (tasks.isUserDeleted(task.task_id)) return { status: 404, detail: "任务不存在" };
    return requireTaskOwner(task, userId);
  };

  const budgetDayExists = (task: TripTaskState, dayIndex: number | null): boolean => {
    if (dayIndex === null) return true;
    const result = task.result && typeof task.result === "object" && !Array.isArray(task.result)
      ? task.result as Record<string, unknown>
      : null;
    const plan = result?.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? result.data as Record<string, unknown>
      : null;
    const days = Array.isArray(plan?.days) ? plan.days : [];
    return days.some((day, position) => day && typeof day === "object" && !Array.isArray(day)
      && Number((day as Record<string, unknown>).day_index ?? position) === dayIndex);
  };

  const buildBudgetResponse = (task: TripTaskState): Record<string, unknown> => {
    const response = budgetLedgerResponse(task.plan_id, task);
    tasks.save(task, { immediate: true });
    return response;
  };

  const itineraryMutationResponse = (task: TripTaskState): Record<string, unknown> => ({
    ...buildBudgetResponse(task),
    plan: planData(task.result),
  });

  const verifyAttractionPoi = async (
    input: AttractionMutationInput,
    city: string,
  ): Promise<TrustedPoi> => {
    const candidates = await poiSearch.searchPoi(input.name, city, "110000");
    const verified = candidates.find((candidate) => candidate.poi_id === input.poi_id);
    if (!verified) throw new ItineraryMutationError(422, "无法从高德确认该景点，请重新搜索并选择");
    return verified;
  };

  const mutationFailure = (
    error: unknown,
    status: (code: 404 | 409 | 422, body: { detail: string }) => unknown,
  ): unknown => {
    if (error instanceof ItineraryMutationError) return status(error.status, { detail: error.message });
    throw error;
  };

  const runPlanning = async (taskId: string): Promise<void> => {
    const startedAt = Date.now();
    try {
      const initial = tasks.get(taskId);
      if (!initial?.request_payload) throw new Error("原始行程请求不可重试");
      const checkpoint = normalizeCheckpoint(initial.checkpoint);
      const result = await withServices(({ planner: activePlanner }) => activePlanner.plan(
        initial.request_payload as TripPlanningRequest,
        {
          checkpoint,
          signal: planningAbort.signal,
          onCheckpoint(nextCheckpoint) {
            const current = tasks.get(taskId);
            if (!current || closed) throw new Error("任务不存在");
            tasks.save({
              ...current,
              checkpoint: structuredClone(nextCheckpoint) as unknown as Record<string, unknown>,
            }, { immediate: true });
          },
          onProgress(update) {
            const current = tasks.get(taskId);
            if (!current || closed) throw new Error("任务不存在");
            tasks.save({
              ...current,
              stage: update.stage,
              progress: Math.max(current.progress, Math.min(99, Math.max(0, update.progress))),
              message: update.message,
              details: update.details ?? current.details,
            });
          },
        },
      ));
      const current = tasks.get(taskId);
      if (!current || closed) return;
      tasks.save({
        ...current,
        status: "completed",
        stage: "completed",
        progress: 100,
        message: "旅行计划生成完成",
        result,
        error: null,
        execution: { elapsed_ms: Date.now() - startedAt },
      }, { immediate: true });
    } catch (error) {
      const current = tasks.get(taskId);
      if (!current || closed) return;
      const message = error instanceof Error ? error.message : String(error);
      tasks.save({
        ...current,
        status: "failed",
        stage: "failed",
        progress: 100,
        message,
        error: message,
        execution: { elapsed_ms: Date.now() - startedAt },
      }, { immediate: true });
      try {
        conversationRecords.markFailed(taskId);
      } catch {
        // The persisted task result is authoritative over its conversation projection.
      }
      return;
    }
    try {
      conversationRecords.markCompleted(taskId);
    } catch {
      // The persisted task result is authoritative over its conversation projection.
    }
  };

  const startPlanning = (taskId: string): void => {
    const run = Promise.resolve().then(() => runPlanning(taskId));
    activeRuns.add(run);
    void run.finally(() => activeRuns.delete(run));
  };

  const editTrip = async (
    body: {
      message: string;
      trip_plan: Record<string, unknown>;
      history?: Array<{ role?: string; content?: string }>;
      plan_id?: string;
      revision?: string;
    },
    userId: string,
    signal?: AbortSignal,
    adminToken = "",
  ) => {
    let task: TripTaskState | undefined;
    let plan = body.trip_plan;
    let expectedPersistedRevision = "";
    if (body.plan_id) {
      task = tasks.get(body.plan_id);
      if (!task) throw Object.assign(new Error("任务不存在"), { httpStatus: 404 });
      const ownerError = requireOwner(task, userId, adminToken);
      if (ownerError) {
        throw Object.assign(new Error(ownerError.status === 403 ? "无权修改该计划" : ownerError.detail), {
          httpStatus: ownerError.status,
        });
      }
      if (task.status !== "completed") {
        throw Object.assign(new Error("计划尚未完成，无法修改"), { httpStatus: 409 });
      }
      const result = task.result;
      const current = result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>).data
        : null;
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        throw Object.assign(new Error("计划数据无效"), { httpStatus: 409 });
      }
      plan = current as Record<string, unknown>;
      expectedPersistedRevision = planRevision(plan);
      if (body.revision && body.revision !== planRevision(plan)) {
        throw new RevisionConflictError("行程版本已变化，请刷新后重试");
      }
    }
    const output = await withServices(({ chatService: activeChatService }) => activeChatService.edit({
      message: body.message,
      trip_plan: plan,
      history: body.history,
      revision: body.revision,
      user_id: userId.trim(),
      plan_id: body.plan_id,
    }, signal));
    if (task && body.plan_id) {
      const latest = tasks.get(body.plan_id);
      const latestResult = latest?.result;
      const latestPlan = latestResult && typeof latestResult === "object" && !Array.isArray(latestResult)
        ? (latestResult as Record<string, unknown>).data
        : null;
      if (!latest || !latestPlan || typeof latestPlan !== "object" || Array.isArray(latestPlan)
        || planRevision(latestPlan) !== expectedPersistedRevision) {
        throw new RevisionConflictError("行程版本已变化，请刷新后重试");
      }
      if (output.updated_plan) {
        const result = latest.result as Record<string, unknown>;
        tasks.save({
          ...latest,
          result: { ...result, data: output.updated_plan },
        }, { immediate: true });
      }
      conversations.append(body.plan_id, latest.user_id, [
        { role: "user", content: body.message },
        { role: "assistant", content: output.reply },
      ]);
    }
    return output;
  };

  const skillHealth = () => {
    let catalogGeneration = 0;
    try {
      const generation = skills.snapshot().generation;
      if (Number.isSafeInteger(generation) && generation >= 0) catalogGeneration = generation;
    } catch {
      // Health diagnostics expose bounded state only, never catalog exceptions.
    }
    return {
      catalog_generation: catalogGeneration,
      runtime_components: skillRuntimeDiagnostics.snapshot().map((component) => ({
        component: component.component,
        generation: component.generation,
        status: component.status,
        ...(component.status === "failure" ? { error_code: component.errorCode } : {}),
      })),
    };
  };

  const app = new Elysia({ name: "youban-http" })
    .use(cors({
      origin: options.corsOrigins ?? settings.cors_origins,
      credentials: true,
      methods: "*",
      allowedHeaders: true,
    }))
    .use(swagger({
      path: "/docs",
      documentation: {
        info: {
          title: settings.app_name,
          version: settings.app_version,
          description: "游伴智能旅行规划助手 API",
        },
      },
    }))
    .onError(({ code, error, request, set }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/admin/skills")) {
        if (code === "VALIDATION" || code === "PARSE") {
          set.status = 422;
          return adminSkillValidationFailure(request);
        }
        set.status = code === "NOT_FOUND" ? 404 : 500;
        return code === "NOT_FOUND"
          ? { detail: "技能接口不存在", code: "skill_not_found" }
          : { detail: "技能管理服务暂时不可用", code: "internal_error" };
      }
      if (code === "VALIDATION" || code === "PARSE") set.status = 422;
      else if (code === "NOT_FOUND") set.status = 404;
      else set.status = 500;
      const detail = error instanceof Error ? error.message : String(error);
      return { detail: detail || "服务异常" };
    })
    .get("/health", () => ({
      status: "healthy",
      service: settings.app_name,
      version: settings.app_version,
    }))
    .get("/api/trip/health", () => ({
      status: "healthy",
      service: settings.app_name,
      version: settings.app_version,
      skills: skillHealth(),
    }))
    .use(createAdminSkillRoutes({
      skills,
      authorize: validAdminToken,
      runSkillOperation: withSkillService,
    }))
    .get("/api/settings", () => {
      const current = getSettings();
      return {
        success: true,
        data: {
          vite_amap_web_key: current.vite_amap_web_key,
          vite_amap_web_js_key: current.vite_amap_web_js_key,
          google_maps_api_key: current.google_maps_api_key,
          google_maps_proxy: current.google_maps_proxy,
          llm_thinking_enabled: current.llm_thinking_enabled,
          llm_thinking_visible: effectiveThinkingVisible(current),
        },
      };
    })
    .get("/api/poi/search", async ({ query }) => {
      const pois = await poiSearch.searchPoi(query.keywords, query.city, query.types ?? "110000");
      return {
        success: true,
        message: pois.length ? "搜索成功" : "未找到匹配地点",
        data: pois.map((poi) => ({
          id: poi.poi_id,
          name: poi.name,
          type: poi.type,
          address: poi.address,
          location: poi.location,
        })),
      };
    }, {
      query: t.Object({
        keywords: t.String({ minLength: 1, maxLength: 120 }),
        city: t.String({ minLength: 1, maxLength: 80 }),
        types: t.Optional(t.String({ maxLength: 80 })),
      }),
    })
    .get("/api/poi/photo", async ({ query }) => {
      const digest = createHash("md5").update(`${query.city ?? ""}:${query.name}`, "utf8").digest("hex").slice(0, 16);
      for (const extension of ["jpg", "jpeg", "png", "webp"]) {
        const fileName = `${digest}.${extension}`;
        const path = join(imagesDir, fileName);
        try {
          if (existsSync(path) && statSync(path).size > 0) {
            return {
              success: true,
              message: "获取图片成功",
              data: { name: query.name, photo_url: `/api/images/${fileName}` },
            };
          }
        } catch {
          // A broken cache entry is treated as a miss so the remote source can still recover.
        }
      }
      const photoUrl = await poiSearch.getPoiPhoto?.(query.name, query.city) ?? "";
      return {
        success: true,
        message: "获取图片成功",
        data: { name: query.name, photo_url: photoUrl },
      };
    }, {
      query: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        city: t.Optional(t.String({ maxLength: 80 })),
      }),
    })
    .post("/api/admin/login", ({ body, status }) => {
      if (!secureEqual(body.password, readAdminPassword())) return status(401, { detail: "密码错误" });
      return { success: true, message: "登录成功" };
    }, {
      body: t.Object({ password: t.String() }),
    })
    .get("/api/admin/records", ({ headers, query, status }) => {
      if (!validAdminToken(headers)) return status(401, { detail: "后台密码校验失败，请重新登录" });
      const rawLimit = Number(query.limit ?? 100);
      const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 100, 500));
      const rawOffset = Number(query.offset ?? 0);
      const offset = Math.min(Math.trunc(rawOffset), Number.MAX_SAFE_INTEGER);
      const page = conversationRecords.listAdmin(query.visibility ?? "all", limit, offset);
      const nicknames = page.userIds.map((userId) => [userId, users.get(userId)?.nickname ?? ""]);
      const snapshotId = createHash("sha256")
        .update(JSON.stringify([page.recordSnapshotId, nicknames]), "utf8")
        .digest("hex");
      const items = page.items.map((item) => ({
        ...item,
        nickname: users.get(item.user_id)?.nickname ?? "",
      }));
      return { success: true, items, total: page.total, snapshot_id: snapshotId };
    }, {
      query: t.Object({
        visibility: t.Optional(t.Union([
          t.Literal("all"),
          t.Literal("active"),
          t.Literal("user_deleted"),
        ])),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String({ pattern: "^(0|[1-9]\\d*)$" })),
      }),
    })
    .delete("/api/admin/records/:recordId", ({ params, headers, status }) => {
      if (!validAdminToken(headers)) return status(401, { detail: "后台密码校验失败，请重新登录" });
      const result = conversationRecords.permanentlyDeleteRecord(params.recordId);
      if (result.status === "not_found") return status(404, { detail: "记录不存在" });
      if (result.status === "conflict") {
        return status(409, { detail: "计划正在生成中，完成或失败后才能删除" });
      }
      return { success: true, removed_images: result.removedImages };
    })
    .get("/api/admin/trips", ({ headers, query, status }) => {
      if (!validAdminToken(headers)) return status(401, { detail: "后台密码校验失败，请重新登录" });
      const rawLimit = Number(query.limit ?? 100);
      const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 100, 500));
      const items = tasks.listHistory({ userId: "", limit, allUsers: true }).map((item) => ({
        ...item,
        nickname: users.get(item.user_id)?.nickname ?? "",
      }));
      return { success: true, items };
    }, {
      query: t.Object({ limit: t.Optional(t.String()) }),
    })
    .delete("/api/admin/trips/:taskId", ({ params, headers, status }) => {
      if (!validAdminToken(headers)) return status(401, { detail: "后台密码校验失败，请重新登录" });
      const result = conversationRecords.permanentlyDeleteTask(params.taskId);
      if (result.status === "not_found") return status(404, { detail: "计划不存在" });
      if (result.status === "conflict") {
        return status(409, { detail: "计划正在生成中，完成或失败后才能删除" });
      }
      return { success: true, removed_images: result.removedImages };
    })
    .get("/api/admin/settings", ({ headers, status }) => {
      if (!validAdminToken(headers)) return status(401, { detail: "后台密码校验失败，请重新登录" });
      return { success: true, message: "ok", data: getSettings() };
    })
    .put("/api/admin/settings", async ({ body, headers, status }) => {
      if (!validAdminToken(headers)) return status(401, { detail: "后台密码校验失败，请重新登录" });
      const updated = await applyRuntimeSettings(body as Partial<RuntimeSettings>);
      return { success: true, message: "配置已保存并立即生效", data: updated };
    }, {
      body: t.Record(t.String(), t.Unknown()),
    })
    .post("/api/auth/login", ({ body, status }) => {
      try {
        return { success: true, user: users.login(body.nickname) };
      } catch (error) {
        if (error instanceof UserInputError) return status(422, { detail: error.message });
        throw error;
      }
    }, {
      body: LoginBodySchema,
      response: {
        200: AuthResponseSchema,
        422: DetailErrorSchema,
      },
    })
    .get("/api/auth/me", ({ headers, status }) => {
      const user = users.get(headers["x-user-id"] ?? "");
      if (!user) return status(404, { detail: "用户不存在,请重新登录" });
      return { success: true as const, user };
    }, {
      response: { 200: AuthResponseSchema, 404: DetailErrorSchema },
    })
    .get("/api/auth/memories", async ({ headers, status }) => {
      const userId = headers["x-user-id"]?.trim() ?? "";
      if (!userId || !users.get(userId)) return status(404, { detail: "用户不存在,请重新登录" });
      return { success: true as const, items: await memory.list(userId) };
    })
    .delete("/api/auth/memories/:memoryId", async ({ params, headers, status }) => {
      const userId = headers["x-user-id"]?.trim() ?? "";
      if (!userId || !users.get(userId)) return status(404, { detail: "用户不存在,请重新登录" });
      if (!await memory.remove(userId, params.memoryId)) return status(404, { detail: "记忆不存在" });
      return { success: true as const };
    })
    .post("/api/conversations", ({ body, headers, status }) => {
      const userId = (headers["x-user-id"] ?? "").trim();
      if (!userId) return status(404, { detail: "会话不存在" });
      const record = conversationRecords.create({
        sessionId: body.session_id,
        userId,
        firstMessage: body.first_message,
        snapshot: body.snapshot,
      });
      if (!record) return status(404, { detail: "会话不存在" });
      const titleInput = conversationRecords.pendingTitleInput(body.session_id, userId);
      if (titleInput) {
        startConversationTitle(
          body.session_id,
          userId,
          titleInput.firstMessage,
          titleInput.titleStatus,
        );
      }
      return record;
    }, {
      body: CreateConversationBodySchema,
      response: { 200: ConversationRecordSchema, 404: DetailErrorSchema },
    })
    .get("/api/conversations", ({ headers, query }) => {
      const rawLimit = Number(query.limit ?? 50);
      const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50, 50));
      const userId = (headers["x-user-id"] ?? "").trim();
      return { items: userId ? conversationRecords.listOwner(userId, limit) : [] };
    }, {
      query: t.Object({ limit: t.Optional(t.String()) }),
      response: ConversationRecordListSchema,
    })
    .get("/api/conversations/:sessionId", ({ params, headers, status }) => {
      const record = conversationRecords.detail(
        params.sessionId,
        (headers["x-user-id"] ?? "").trim(),
      );
      return record ?? status(404, { detail: "会话不存在" });
    }, {
      response: { 200: ConversationSessionDetailSchema, 404: DetailErrorSchema },
    })
    .put("/api/conversations/:sessionId", ({ params, body, headers, status }) => {
      try {
        const record = conversationRecords.replaceSnapshot(
          params.sessionId,
          (headers["x-user-id"] ?? "").trim(),
          body.revision,
          body.snapshot,
        );
        return record ?? status(404, { detail: "会话不存在" });
      } catch (error) {
        if (error instanceof SessionRevisionConflictError) {
          return status(409, { detail: "会话已在其他位置更新，请重新加载" });
        }
        throw error;
      }
    }, {
      body: ReplaceConversationSnapshotBodySchema,
      response: {
        200: ConversationSessionDetailSchema,
        404: DetailErrorSchema,
        409: DetailErrorSchema,
      },
    })
    .delete("/api/conversations/:sessionId", ({ params, headers, status }) => {
      const removed = conversationRecords.softDeleteSession(
        params.sessionId,
        (headers["x-user-id"] ?? "").trim(),
      );
      return removed ? { success: true as const } : status(404, { detail: "会话不存在" });
    }, {
      response: {
        200: t.Object({ success: t.Literal(true) }, { additionalProperties: false }),
        404: DetailErrorSchema,
      },
    })
    .get("/api/trip/history", ({ headers, query }) => {
      const rawLimit = Number(query.limit ?? 10);
      const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 10, 50));
      return {
        items: tasks.listHistory({ userId: (headers["x-user-id"] ?? "").trim(), limit }),
      };
    }, {
      query: t.Object({ limit: t.Optional(t.String()) }),
      response: TripHistoryResponseSchema,
    })
    .post("/api/trip/parse", ({ body, headers, request }) => withServices(({ assistant: activeAssistant }) => activeAssistant.parse(body, {
      signal: request.signal,
      scope: parentScope(headers),
    })), {
      body: t.Object({
        text: t.String({ maxLength: 500 }),
        language: t.Optional(t.String()),
        today: t.Optional(t.String()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
      }),
    })
    .post("/api/trip/parse/stream", ({ body, headers, request }) => sseResponse(
      (onDelta, signal) => withServices(({ assistant: activeAssistant }) =>
        activeAssistant.parse(body, { onDelta, signal, scope: parentScope(headers) })
      ),
      [request.signal, planningAbort.signal],
    ), {
      body: t.Object({
        text: t.String({ maxLength: 500 }),
        language: t.Optional(t.String()),
        today: t.Optional(t.String()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
      }),
    })
    .post("/api/trip/confirm-reply", ({ body, headers, request }) => withServices(({ assistant: activeAssistant }) => activeAssistant.confirm(body, {
      signal: request.signal,
      scope: parentScope(headers),
    })), {
      body: t.Object({
        text: t.String({ maxLength: 500 }),
        draft: t.Optional(t.Record(t.String(), t.Unknown())),
        language: t.Optional(t.String()),
        today: t.Optional(t.String()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
        readiness_token: t.Optional(t.String()),
      }),
    })
    .post("/api/trip/confirm-reply/stream", ({ body, headers, request }) => sseResponse(
      (onDelta, signal) => withServices(({ assistant: activeAssistant }) =>
        activeAssistant.confirm(body, { onDelta, signal, scope: parentScope(headers) })
      ),
      [request.signal, planningAbort.signal],
    ), {
      body: t.Object({
        text: t.String({ maxLength: 500 }),
        draft: t.Optional(t.Record(t.String(), t.Unknown())),
        language: t.Optional(t.String()),
        today: t.Optional(t.String()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
        readiness_token: t.Optional(t.String()),
      }),
    })
    .post("/api/trip/plan", ({ body, headers, status }) => {
      const userId = (headers["x-user-id"] ?? "").trim();
      const sessionId = body.session_id?.trim();
      if (body.session_id !== undefined
        && (!sessionId || !conversationRecords.canStartGeneration(sessionId, userId))) {
        return status(404, { detail: "会话不存在" });
      }
      const signedPayload = { ...body } as Record<string, unknown>;
      delete signedPayload.execution_token;
      if (sessionId) signedPayload.session_id = sessionId;
      let requestPayload: TripPlanningRequest & Record<string, unknown>;
      try {
        requestPayload = normalizeTripPlanningRequest(signedPayload);
      } catch (error) {
        return status(422, { detail: error instanceof Error ? error.message : String(error) });
      }
      const consumed = confirmationLedger.consume(body.execution_token, signedPayload);
      if (!consumed.valid) {
        if (consumed.reason === "already_consumed") return status(409, { detail: "该确认已执行，请勿重复提交" });
        if (consumed.reason === "expired") return status(401, { detail: "确认已过期，请在对话中重新确认" });
        if (consumed.reason === "draft_mismatch") return status(400, { detail: "行程草稿已变化，请重新确认" });
        return status(400, { detail: "缺少有效的 Agent 确认凭证" });
      }
      const taskId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
      tasks.save(createTaskState(taskId, {
        user_id: userId,
        progress: 5,
        message: "任务已提交，正在初始化流程...",
        request_payload: requestPayload,
        checkpoint: emptyCheckpoint() as unknown as Record<string, unknown>,
      }), { immediate: true });
      if (sessionId && !conversationRecords.linkGeneration(sessionId, userId, taskId)) {
        tasks.delete(taskId);
        return status(404, { detail: "会话不存在" });
      }
      const rawConversation = requestPayload.conversation;
      const cityDisplay = requestPayload.cities.map((stay) => stay.city).join(" → ");
      const fallbackMessages = [
        ...(String(requestPayload.origin_text ?? "").trim()
          ? [{ role: "user", content: String(requestPayload.origin_text).trim() }]
          : []),
        {
          role: "assistant",
          content: `已确认行程：${cityDisplay}，${requestPayload.start_date} 至 ${requestPayload.end_date}，共 ${requestPayload.travel_days} 天。`,
        },
      ];
      conversations.save(
        taskId,
        userId,
        Array.isArray(rawConversation) && rawConversation.length > 0 ? rawConversation : fallbackMessages,
      );
      startPlanning(taskId);
      return planningResponse(taskId, `任务已提交，可通过 WebSocket /api/trip/ws/${taskId} 实时订阅状态`);
    }, {
      body: t.Object({
        city: t.Optional(t.String({ maxLength: 100 })),
        cities: t.Optional(t.Array(t.Object({
          city: t.String({ minLength: 1, maxLength: 100 }),
          days: t.Integer({ minimum: 1, maximum: 15 }),
        }), { maxItems: 30 })),
        start_date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        end_date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        travel_days: t.Integer({ minimum: 1, maximum: 30 }),
        transportation: t.String({ minLength: 1, maxLength: 200 }),
        accommodation: t.String({ minLength: 1, maxLength: 200 }),
        preferences: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 })),
        traveler_count: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
        room_count: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
        budget_amount: t.Optional(t.Union([t.Number({ minimum: 0, maximum: 100_000_000 }), t.Null()])),
        budget_basis: t.Optional(t.Union([t.Literal("group_total"), t.Literal("per_person")])),
        free_text_input: t.Optional(t.String()),
        origin_text: t.Optional(t.String()),
        language: t.Optional(t.String()),
        conversation: t.Optional(t.Array(t.Object({
          role: t.Union([t.Literal("user"), t.Literal("assistant")]),
          content: t.String({ minLength: 1, maxLength: 4_000 }),
        }), { maxItems: 100 })),
        session_id: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        execution_token: t.String(),
      }),
    })
    .post("/api/trip/plan/:planId/retry", ({ params, body, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "任务不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "failed") return status(409, { detail: "仅失败任务可重试" });
      if (!task.request_payload) return status(409, { detail: "原始行程请求不可重试" });
      tasks.save({
        ...task,
        status: "processing",
        stage: "submitted",
        progress: 5,
        message: "任务已重新提交，正在初始化流程...",
        details: [],
        result: null,
        error: null,
        checkpoint: body.restart_all
          ? emptyCheckpoint() as unknown as Record<string, unknown>
          : task.checkpoint,
      }, { immediate: true });
      conversationRecords.markGenerating(task.task_id);
      startPlanning(task.task_id);
      return planningResponse(task.task_id, `任务已重新提交，可通过 WebSocket /api/trip/ws/${task.task_id} 实时订阅状态`);
    }, {
      body: t.Object({ restart_all: t.Optional(t.Boolean()) }),
    })
    .get("/api/trip/status/:taskId", ({ params, headers, status }) => {
      const task = tasks.get(params.taskId);
      if (!task) return status(404, { detail: "任务不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status === "completed") {
        return {
          task_id: task.task_id,
          plan_id: task.plan_id,
          status: "completed",
          result: task.result,
          execution: task.execution,
        };
      }
      if (task.status === "failed") {
        const response: Record<string, unknown> = {
          task_id: task.task_id,
          plan_id: task.plan_id,
          status: "failed",
          error: task.error ?? "",
          request_payload: task.request_payload,
        };
        const summary = buildCheckpointSummary(task.checkpoint);
        if (summary) response.checkpoint_summary = summary;
        return response;
      }
      return {
        task_id: task.task_id,
        plan_id: task.plan_id,
        status: "processing",
        stage: task.stage,
        progress: task.progress,
        progress_text: task.message,
      };
    })
    .get("/api/trip/plan/:planId/conversation", ({ params, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "任务不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) {
        return status(ownerError.status, {
          detail: ownerError.status === 403 ? "无权访问该计划对话" : ownerError.detail,
        });
      }
      return { plan_id: params.planId, messages: conversations.get(params.planId) };
    })
    .post("/api/trip/share/:taskId", ({ params, headers, status }) => {
      const task = tasks.get(params.taskId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未完成，暂时无法分享" });
      }
      const shareToken = task.share_token || crypto.randomUUID().replaceAll("-", "");
      tasks.save({ ...task, share_token: shareToken }, { immediate: true });
      return { plan_id: task.plan_id, share_code: shareToken };
    })
    .get("/api/trip/share/:shareToken", ({ params, status }) => {
      const task = tasks.all().find((candidate) =>
        candidate.share_token.length === 32 && candidate.share_token === params.shareToken
      );
      if (!task || task.status !== "completed" || !task.result) {
        return status(404, { detail: "分享计划不存在或尚未完成" });
      }
      return { plan_id: task.plan_id, status: "completed", result: task.result };
    })
    .post("/api/trip/plan/:planId/attractions", async ({ params, body, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改景点" });
      }
      try {
        const input = body as AttractionMutationInput;
        const city = cityForDay(task.result, input.day_index);
        const verified = await verifyAttractionPoi(input, city);
        const created = createAttraction(task.result, input, verified);
        task.budget_items = (task.budget_items ?? []).filter((item) =>
          !item || typeof item !== "object" || Array.isArray(item)
          || String((item as Record<string, unknown>).id ?? "") !== `itinerary:attraction:${created.id}`
        );
        return itineraryMutationResponse(task);
      } catch (error) {
        return mutationFailure(error, status);
      }
    }, { body: AttractionMutationBodySchema })
    .put("/api/trip/plan/:planId/attractions/:attractionId", async ({ params, body, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改景点" });
      }
      try {
        const input = body as AttractionMutationInput;
        const city = cityForDay(task.result, input.day_index);
        const verified = await verifyAttractionPoi(input, city);
        updateAttraction(task.result, params.attractionId, input, verified);
        task.budget_items = (task.budget_items ?? []).filter((item) =>
          !item || typeof item !== "object" || Array.isArray(item)
          || String((item as Record<string, unknown>).id ?? "") !== `itinerary:attraction:${params.attractionId}`
        );
        return itineraryMutationResponse(task);
      } catch (error) {
        return mutationFailure(error, status);
      }
    }, { body: AttractionMutationBodySchema })
    .delete("/api/trip/plan/:planId/attractions/:attractionId", ({ params, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改景点" });
      }
      try {
        deleteAttraction(task.result, params.attractionId);
        delete task.execution[params.attractionId];
        task.budget_items = (task.budget_items ?? []).filter((item) =>
          !item || typeof item !== "object" || Array.isArray(item)
          || String((item as Record<string, unknown>).id ?? "") !== `itinerary:attraction:${params.attractionId}`
        );
        return itineraryMutationResponse(task);
      } catch (error) {
        return mutationFailure(error, status);
      }
    })
    .get("/api/trip/plan/:planId/budget-items", ({ params, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改预算" });
      }
      return buildBudgetResponse(task);
    })
    .post("/api/trip/plan/:planId/budget-items", ({ params, body, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改预算" });
      }
      if (body.type === "attraction") {
        return status(409, { detail: "新增景点必须先搜索并选择高德真实 POI" });
      }
      const name = body.name.trim();
      if (!name) return status(422, { detail: "项目名称不能为空" });
      const dayIndex = body.day_index ?? null;
      if (!budgetDayExists(task, dayIndex)) return status(422, { detail: "所选日期不在当前行程中" });
      const snapshot = budgetLedgerResponse(task.plan_id, task);
      const travelers = Number(snapshot.traveler_count);
      const groupAmount = toGroupTotal(body.amount ?? null, body.amount_basis ?? "group_total", travelers);
      const item: BudgetLedgerItem = {
        id: `budget:${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
        type: body.type,
        day_index: dayIndex,
        day_end_index: null,
        name,
        amount: groupAmount,
        amount_basis: body.amount_basis ?? "group_total",
        traveler_count: travelers,
        per_person_amount: groupAmount === null ? null : Math.round(groupAmount / travelers * 100) / 100,
        calculation_summary: "",
        unit_amount: null,
        room_count: null,
        nights: null,
        origin: "user",
        price_source: groupAmount === null ? "unavailable" : "user",
        linked_item_id: "",
        entity_source: "",
        source_url: "",
        price_checked_at: "",
        note: (body.note ?? "").trim(),
        user_locked: true,
        deleted: false,
      };
      task.budget_items = [...(task.budget_items ?? []), item];
      return buildBudgetResponse(task);
    }, {
      body: t.Object({
        type: t.Union([
          t.Literal("attraction"), t.Literal("hotel"), t.Literal("meal"),
          t.Literal("transport"), t.Literal("other"),
        ]),
        day_index: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
        name: t.String({ minLength: 1, maxLength: 120 }),
        amount: t.Optional(t.Union([t.Number({ minimum: 0, maximum: 100_000_000 }), t.Null()])),
        amount_basis: t.Optional(t.Union([t.Literal("group_total"), t.Literal("per_person")])),
        note: t.Optional(t.String({ maxLength: 300 })),
      }),
    })
    .patch("/api/trip/plan/:planId/budget-items/:budgetItemId", ({ params, body, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改预算" });
      }
      if (body.day_index !== undefined && !budgetDayExists(task, body.day_index)) {
        return status(422, { detail: "所选日期不在当前行程中" });
      }
      if (body.name !== undefined && !body.name.trim()) return status(422, { detail: "项目名称不能为空" });
      const snapshot = budgetLedgerResponse(task.plan_id, task);
      const travelers = Number(snapshot.traveler_count);
      const items = syncBudgetItems(task.result, task.budget_items, travelers, Number(snapshot.room_count));
      const target = items.find((item) => item.id === params.budgetItemId);
      if (!target) return status(404, { detail: "预算条目不存在" });
      if (target.type === "attraction" && target.linked_item_id) {
        return status(409, { detail: "行程景点必须通过景点编辑接口修改" });
      }
      if (body.type !== undefined) target.type = body.type as BudgetItemType;
      if (body.day_index !== undefined) target.day_index = body.day_index;
      if (body.name !== undefined) target.name = body.name.trim();
      if (body.amount_basis !== undefined) target.amount_basis = body.amount_basis as AmountBasis;
      if (body.note !== undefined) target.note = body.note.trim();
      if (body.deleted !== undefined) target.deleted = body.deleted;
      if (Object.hasOwn(body, "amount")) {
        target.amount = toGroupTotal(body.amount ?? null, target.amount_basis, travelers);
        target.price_source = target.amount === null ? "unavailable" : "user";
        target.unit_amount = null;
        target.calculation_summary = "";
      }
      target.user_locked = true;
      task.budget_items = items;
      return buildBudgetResponse(task);
    }, {
      body: t.Object({
        type: t.Optional(t.Union([
          t.Literal("attraction"), t.Literal("hotel"), t.Literal("meal"),
          t.Literal("transport"), t.Literal("other"),
        ])),
        day_index: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        amount: t.Optional(t.Union([t.Number({ minimum: 0, maximum: 100_000_000 }), t.Null()])),
        amount_basis: t.Optional(t.Union([t.Literal("group_total"), t.Literal("per_person")])),
        note: t.Optional(t.String({ maxLength: 300 })),
        deleted: t.Optional(t.Boolean()),
      }),
    })
    .delete("/api/trip/plan/:planId/budget-items/:budgetItemId", ({ params, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成，无法修改预算" });
      }
      const snapshot = budgetLedgerResponse(task.plan_id, task);
      const items = syncBudgetItems(task.result, task.budget_items, Number(snapshot.traveler_count), Number(snapshot.room_count));
      const target = items.find((item) => item.id === params.budgetItemId);
      if (!target) return status(404, { detail: "预算条目不存在" });
      if (target.type === "attraction" && target.linked_item_id) {
        return status(409, { detail: "行程景点必须通过景点删除接口移除" });
      }
      target.deleted = true;
      target.user_locked = true;
      task.budget_items = items;
      return buildBudgetResponse(task);
    })
    .patch("/api/trip/plan/:planId/items/:itemId/status", ({ params, body, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status !== "completed" || !task.result) {
        return status(409, { detail: "计划尚未生成完成" });
      }
      const result = task.result as Record<string, unknown>;
      const plan = result.data;
      const days = plan && typeof plan === "object" && !Array.isArray(plan)
        && Array.isArray((plan as Record<string, unknown>).days)
        ? (plan as Record<string, unknown>).days as unknown[]
        : [];
      const knownIds = new Set(days.flatMap((day) => {
        if (!day || typeof day !== "object" || Array.isArray(day)) return [];
        const value = day as Record<string, unknown>;
        return [value.attractions, value.meals].flatMap((items) => Array.isArray(items)
          ? items.flatMap((item) => item && typeof item === "object" && !Array.isArray(item)
            ? [String((item as Record<string, unknown>).id ?? "")]
            : [])
          : []);
      }));
      if (!knownIds.has(params.itemId)) return status(404, { detail: "行程项不存在" });
      const execution = { ...task.execution };
      if (body.status === "pending") {
        delete execution[params.itemId];
        tasks.save({ ...task, execution }, { immediate: true });
        return { success: true, execution: null };
      }
      const entry: Record<string, unknown> = {
        status: body.status,
        updated_at: new Date().toISOString(),
      };
      if (body.actual_cost !== undefined) entry.actual_cost = body.actual_cost;
      execution[params.itemId] = entry;
      tasks.save({ ...task, execution }, { immediate: true });
      return { success: true, execution: entry };
    }, {
      body: t.Object({
        status: t.Union([
          t.Literal("done"),
          t.Literal("skipped"),
          t.Literal("postponed"),
          t.Literal("pending"),
        ]),
        actual_cost: t.Optional(t.Number({ minimum: 0 })),
      }),
    })
    .delete("/api/trip/plan/:planId", ({ params, headers, status }) => {
      const task = tasks.get(params.planId);
      if (!task) return status(404, { detail: "计划不存在" });
      const ownerError = requireTaskOwner(task, headers["x-user-id"] ?? "", headers["x-admin-token"] ?? "");
      if (ownerError) return status(ownerError.status, { detail: ownerError.detail });
      if (task.status === "processing") {
        return status(409, { detail: "计划正在生成中，完成或失败后才能删除" });
      }
      const userId = validAdminToken(headers) ? task.user_id : (headers["x-user-id"] ?? "").trim();
      if (!conversationRecords.softDeletePlan(task.plan_id, userId)) {
        return status(404, { detail: "计划不存在" });
      }
      return { success: true, removed_images: 0 };
    })
    .post("/api/chat/ask", ({ body, headers, request }) => withServices(({ chatService: activeChatService }) =>
      activeChatService.ask({
        ...body,
        user_id: (headers["x-user-id"] ?? "").trim(),
      }, request.signal)
    ), {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: 2_000 }),
        trip_plan: t.Record(t.String(), t.Unknown()),
        plan_id: t.Optional(t.String()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
      }),
    })
    .post("/api/chat/edit", async ({ body, headers, request, status }) => {
      try {
        return await editTrip(body, headers["x-user-id"] ?? "", request.signal, headers["x-admin-token"] ?? "");
      } catch (error) {
        if (error instanceof RevisionConflictError) return status(409, { detail: error.message });
        if (error instanceof UnsafePlanPatchError) return status(400, { detail: error.message });
        const httpStatus = error && typeof error === "object" && "httpStatus" in error
          ? Number((error as { httpStatus: unknown }).httpStatus)
          : 0;
        if ([403, 404, 409].includes(httpStatus)) {
          return status(httpStatus as 403 | 404 | 409, {
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    }, {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: 2_000 }),
        trip_plan: t.Record(t.String(), t.Unknown()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
        plan_id: t.Optional(t.String()),
        revision: t.Optional(t.String()),
      }),
    })
    .post("/api/chat/edit/stream", ({ body, headers, request, status }) => {
      if (body.plan_id) {
        const task = tasks.get(body.plan_id);
        if (!task) return status(404, { detail: "任务不存在" });
        const ownerError = requireOwner(
          task,
          headers["x-user-id"] ?? "",
          headers["x-admin-token"] ?? "",
        );
        if (ownerError?.status === 404) return status(404, { detail: ownerError.detail });
      }
      return sseResponse(
        async (onDelta, signal) => {
          const result = await editTrip(body, headers["x-user-id"] ?? "", signal, headers["x-admin-token"] ?? "");
          onDelta(result.reply);
          return result;
        },
        [request.signal, planningAbort.signal],
      );
    }, {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: 2_000 }),
        trip_plan: t.Record(t.String(), t.Unknown()),
        history: t.Optional(t.Array(t.Object({
          role: t.Optional(t.String()),
          content: t.Optional(t.String()),
        }))),
        plan_id: t.Optional(t.String()),
        revision: t.Optional(t.String()),
      }),
    })
    .get("/api/images/*", ({ params, status }) => {
      const fileName = decodeURIComponent(params["*"] ?? "");
      if (!fileName || basename(fileName) !== fileName) return status(404, { detail: "图片不存在" });
      const path = join(imagesDir, fileName);
      if (!isContained(imagesDir, path) || !existsSync(path)) return status(404, { detail: "图片不存在" });
      return Bun.file(path);
    })
    .ws("/api/trip/ws/:taskId", {
      beforeHandle({ params, query, status }) {
        const task = tasks.get(String(params.taskId));
        if (!task) return;
        const ownerError = requireOwner(
          task,
          String(query.user_id ?? ""),
          String(query.admin_token ?? ""),
        );
        if (ownerError?.status === 404) return status(404, { detail: ownerError.detail });
      },
      open(ws) {
        if (closed) {
          ws.close(1012, "服务正在关闭");
          return;
        }
        const taskId = String(ws.data.params.taskId);
        const task = tasks.get(taskId);
        if (!task) {
          ws.cork(() => {
            ws.send(JSON.stringify(failedEvent(taskId, "任务不存在")));
            ws.close(1008, "任务不存在");
          });
          return;
        }
        const userId = String(ws.data.query.user_id ?? "").trim();
        const adminToken = String(ws.data.query.admin_token ?? "").trim();
        const ownerError = requireOwner(task, userId, adminToken);
        if (ownerError) {
          ws.cork(() => {
            ws.send(JSON.stringify(failedEvent(taskId, ownerError.detail)));
            ws.close(1008, ownerError.detail);
          });
          return;
        }
        ws.send(JSON.stringify(buildTaskEvent(task, true)));
        if (task.status === "completed" || task.status === "failed") {
          ws.close(1000, "任务已结束");
          return;
        }
        const unsubscribe = tasks.subscribe(taskId, (event) => {
          ws.send(JSON.stringify(event));
          if (event.status === "completed" || event.status === "failed") {
            ws.close(1000, "任务已结束");
          }
        });
        unsubscribers.set(ws.id, unsubscribe);
        webSockets.set(ws.id, ws);
      },
      close(ws) {
        unsubscribers.get(ws.id)?.();
        unsubscribers.delete(ws.id);
        webSockets.delete(ws.id);
      },
    })
    .get("/", () => {
      const frontend = frontendResponse(frontendDist, "/index.html");
      if (frontend) return frontend;
      return {
        name: settings.app_name,
        version: settings.app_version,
        status: "running",
        docs: "/docs",
        redoc: "/redoc",
      };
    })
    .all("/*", async ({ request, status }) => {
      const url = new URL(request.url);
      const apiIndex = url.pathname.indexOf("/api/");
      if (apiIndex > 0) {
        url.pathname = url.pathname.slice(apiIndex);
        const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
        return dispatchRewritten(new Request(url.toString(), {
          method: request.method,
          headers: request.headers,
          body,
        }));
      }
      if (url.pathname.startsWith("/api/")) return status(404, { detail: "Not Found" });
      const asset = frontendResponse(frontendDist, url.pathname);
      if (asset) return asset;
      const fallback = frontendResponse(frontendDist, "/index.html");
      if (fallback && !url.pathname.includes(".")) return fallback;
      return status(404, { detail: "Not Found" });
    });

  dispatchRewritten = app.handle.bind(app);

  const beginShutdown = (): void => {
    if (closed) return;
    closed = true;
    planningAbort.abort(new Error("服务正在关闭"));
    for (const socket of webSockets.values()) socket.close(1012, "服务正在关闭");
    webSockets.clear();
    for (const unsubscribe of unsubscribers.values()) unsubscribe();
    unsubscribers.clear();
  };

  return {
    app,
    dataDir: options.dataDir,
    tasks,
    users,
    conversations,
    conversationRecords,
    skills,
    skillRuntimeDiagnostics,
    get assistant() { return assistant; },
    get planner() { return planner; },
    get chatService() { return chatService; },
    get parentAgent() { return parentAgent; },
    releaseIdleResources(reason: "memory-pressure") {
      return parentAgent.releaseIdleResources?.(reason) ?? Promise.resolve({
        persistent: 0,
        temporary: 0,
        busy: 0,
        evicted: 0,
      });
    },
    beginShutdown,
    close() {
      if (closePromise) return closePromise;
      beginShutdown();
      const closeResources = async () => {
        if (pendingSettingsRefreshes > 0) await settingsRefreshTail;
        if (activeServiceCalls.size > 0) await Promise.allSettled([...activeServiceCalls]);
        if (titleJobs.size > 0) await Promise.allSettled([...titleJobs.values()]);
        tasks.close();
        users.close();
        conversations.close();
        conversationRecords.close();
        await Promise.allSettled([
          ...(!options.planner ? [settleResourceClose(() => planner.close?.())] : []),
          ...(!options.chatService ? [settleResourceClose(() => chatService.close())] : []),
          ...(!options.parentAgent ? [settleResourceClose(() => parentAgent.close())] : []),
        ]);
        if (ownedMemory) await settleResourceClose(() => ownedMemory.close());
        if (!options.skillService) skills.close();
      };
      closePromise = activeRuns.size === 0
        ? closeResources()
        : Promise.allSettled([...activeRuns]).then(closeResources);
      return closePromise;
    },
  };
}

export type HttpRuntime = ReturnType<typeof createHttpRuntime>;
