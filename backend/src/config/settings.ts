/**
 * 配置管理模块（对齐 Python backend/app/config.py 的行为）。
 *
 * 优先级：runtime_settings.json 的非空值 > env > 默认值。
 * env 由 Bun 自动从 .env 加载，直接读 process.env。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { _resetDataDirCacheForTest, getDataDir, getRepoRoot } from "./paths.ts";

export interface RuntimeSettings {
  vite_amap_web_key: string;
  vite_amap_web_js_key: string;
  openai_api_key: string;
  openai_base_url: string;
  openai_model: string;
  // 新增键（全部有默认值）：
  trip_segment_days: number; // 默认 5
  trip_segment_concurrency: number; // 默认 8
  trip_review_enabled: boolean; // 默认 true
  llm_thinking_enabled: boolean; // 默认 false
  llm_thinking_visible: boolean; // 默认 false
  trip_planner_timeout: number; // 默认 120（秒）
  trip_duplicate_repair_rounds: number; // 默认 2
  pi_parent_session_limit: number; // 默认 64
  pi_parent_session_idle_seconds: number; // 默认 1800
  llm_api_style: "responses" | "completions"; // 默认 "responses"
  chat_edit_agent: "pi" | "simple"; // 默认 "pi"
}

export interface AppSettings extends RuntimeSettings {
  app_name: string; // 默认 "HelloAgents智能旅行助手"
  app_version: string; // 默认 "2.0.4"
  debug: boolean;
  host: string; // env HOST，默认 "0.0.0.0"
  port: number; // env PORT，默认 8000（生产部署用 7860）
  cors_origins: string[]; // env CORS_ORIGINS 逗号分隔，默认 ["http://localhost:5173","http://localhost:3000","http://127.0.0.1:5173"]
  llm_timeout: number; // env LLM_TIMEOUT，默认 60
  fliggy_proxy_token: string;
  fliggy_proxy_url: string;
  fliggy_price_timeout_ms: number;
  fliggy_price_cache_ttl_seconds: number;
}

type RuntimeKey = keyof RuntimeSettings;

const RUNTIME_STRING_KEYS = [
  "vite_amap_web_key",
  "vite_amap_web_js_key",
  "openai_api_key",
  "openai_base_url",
  "openai_model",
] as const;

const RUNTIME_NUMBER_KEYS = [
  "trip_segment_days",
  "trip_segment_concurrency",
  "trip_planner_timeout",
  "trip_duplicate_repair_rounds",
  "pi_parent_session_limit",
  "pi_parent_session_idle_seconds",
] as const;

const RUNTIME_NUMBER_RANGES = {
  pi_parent_session_limit: { min: 1, max: 1024, fallback: 64 },
  pi_parent_session_idle_seconds: { min: 60, max: 86400, fallback: 1800 },
} as const;

const RUNTIME_BOOLEAN_KEYS = [
  "trip_review_enabled",
  "llm_thinking_enabled",
  "llm_thinking_visible",
] as const;

const RUNTIME_ENUM_VALUES = {
  llm_api_style: ["responses", "completions"],
  chat_edit_agent: ["pi", "simple"],
} as const;

const RUNTIME_KEYS = [
  ...RUNTIME_STRING_KEYS,
  ...RUNTIME_NUMBER_KEYS,
  ...RUNTIME_BOOLEAN_KEYS,
  ...Object.keys(RUNTIME_ENUM_VALUES),
] as RuntimeKey[];

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:9000",
  "http://127.0.0.1:9000",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];

// ---------------------------------------------------------------------------
// env 读取辅助（env 名为大小写不敏感：先精确名，再小写名，对齐 pydantic 行为）
// ---------------------------------------------------------------------------

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    for (const candidate of [name, name.toLowerCase()]) {
      const value = process.env[candidate];
      if (value !== undefined && value.trim() !== "") return value;
    }
  }
  return undefined;
}

function readEnvInt(fallback: number, ...names: string[]): number {
  const raw = readEnv(...names);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readEnvBoundedInt(
  name: string,
  bounds: { min: number; max: number; fallback: number },
): number {
  const raw = readEnv(name);
  if (raw === undefined) return bounds.fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= bounds.min && value <= bounds.max
    ? value
    : bounds.fallback;
}

function readEnvBool(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readEnvEnum<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = readEnv(name);
  if (raw !== undefined && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// 运行时覆盖项：键过滤 + 类型校验
// ---------------------------------------------------------------------------

function isRuntimeKey(key: string): key is RuntimeKey {
  return (
    (RUNTIME_STRING_KEYS as readonly string[]).includes(key) ||
    (RUNTIME_NUMBER_KEYS as readonly string[]).includes(key) ||
    (RUNTIME_BOOLEAN_KEYS as readonly string[]).includes(key) ||
    key in RUNTIME_ENUM_VALUES
  );
}

function isValidRuntimeValue(key: RuntimeKey, value: unknown): boolean {
  if ((RUNTIME_STRING_KEYS as readonly string[]).includes(key)) {
    return typeof value === "string";
  }
  if ((RUNTIME_NUMBER_KEYS as readonly string[]).includes(key)) {
    if (key in RUNTIME_NUMBER_RANGES) {
      const range = RUNTIME_NUMBER_RANGES[key as keyof typeof RUNTIME_NUMBER_RANGES];
      return typeof value === "number" && Number.isInteger(value)
        && value >= range.min && value <= range.max;
    }
    return typeof value === "number" && Number.isFinite(value);
  }
  if ((RUNTIME_BOOLEAN_KEYS as readonly string[]).includes(key)) {
    return typeof value === "boolean";
  }
  const allowed = (RUNTIME_ENUM_VALUES as Record<string, readonly string[]>)[key];
  return (
    Array.isArray(allowed) && typeof value === "string" && allowed.includes(value)
  );
}

/** 空字符串覆盖视为「移除覆盖」，语义上等价于回退到 env/默认值。 */
function isEffectiveOverride(value: unknown): boolean {
  return !(typeof value === "string" && value.trim() === "");
}

// ---------------------------------------------------------------------------
// 覆盖文件读写（DATA_DIR 优先；旧位置 backend/runtime_settings.json 迁移）
// ---------------------------------------------------------------------------

function runtimeSettingsFile(): string {
  return join(getDataDir(), "runtime_settings.json");
}

/** 旧位置覆盖文件路径；undefined = 默认真实路径，null = 禁用迁移（测试用）。 */
let legacyRuntimeFileOverride: string | null | undefined = undefined;

function legacyRuntimeFile(): string | null {
  if (legacyRuntimeFileOverride === undefined) {
    return join(getRepoRoot(), "backend", "runtime_settings.json");
  }
  return legacyRuntimeFileOverride;
}

function readOverridesFile(path: string): Partial<RuntimeSettings> {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: Partial<RuntimeSettings> = {};
    for (const [key, value] of Object.entries(raw)) {
      // 非法键丢弃；类型不符丢弃；空字符串不生效（非空值才覆盖 env）
      if (!isRuntimeKey(key) || !isValidRuntimeValue(key, value)) continue;
      if (!isEffectiveOverride(value)) continue;
      (out as Record<string, unknown>)[key] = value;
    }
    return out;
  } catch (error) {
    console.warn(`⚠️  读取运行时配置失败，已回退到环境变量: ${error}`);
    return {};
  }
}

/** 原子写（tmp + rename）持久化覆盖项到 DATA_DIR 位置。 */
function persistOverrides(overrides: Partial<RuntimeSettings>): void {
  const target = runtimeSettingsFile();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(overrides, null, 2), { encoding: "utf-8", mode: 0o600 });
  // mode 仅在新建文件时生效；失败遗留的 tmp 也必须收紧权限。
  chmodSync(tmp, 0o600);
  renameSync(tmp, target);
}

function loadRuntimeOverrides(): Partial<RuntimeSettings> {
  const target = runtimeSettingsFile();
  if (existsSync(target)) return readOverridesFile(target);

  const legacy = legacyRuntimeFile();
  if (legacy && existsSync(legacy)) {
    const overrides = readOverridesFile(legacy);
    // 迁移写入 DATA_DIR 位置，之后以 DATA_DIR 为准（不删除旧文件）
    persistOverrides(overrides);
    return overrides;
  }
  return {};
}

// ---------------------------------------------------------------------------
// 单例构建与合并
// ---------------------------------------------------------------------------

function buildSettings(overrides: Partial<RuntimeSettings>): AppSettings {
  const settings: AppSettings = {
    // 应用基本配置
    app_name: readEnv("APP_NAME") ?? "HelloAgents智能旅行助手",
    app_version: readEnv("APP_VERSION") ?? "2.0.4",
    debug: readEnvBool("DEBUG", false),
    // 服务器配置
    host: readEnv("HOST") ?? "0.0.0.0",
    port: readEnvInt(8000, "PORT"),
    cors_origins: (() => {
      const raw = readEnv("CORS_ORIGINS");
      if (!raw) return [...DEFAULT_CORS_ORIGINS];
      const list = raw.split(",").map((o) => o.trim()).filter((o) => o !== "");
      return list.length > 0 ? list : [...DEFAULT_CORS_ORIGINS];
    })(),
    // 高德地图
    vite_amap_web_key: readEnv("VITE_AMAP_WEB_KEY") ?? "",
    vite_amap_web_js_key: readEnv("VITE_AMAP_WEB_JS_KEY") ?? "",
    // LLM 配置（别名回退，与 Python 的 AliasChoices 一致）
    openai_api_key: readEnv("OPENAI_API_KEY", "LLM_API_KEY") ?? "",
    openai_base_url:
      readEnv("OPENAI_BASE_URL", "LLM_BASE_URL") ?? "https://api.openai.com/v1",
    openai_model: readEnv("OPENAI_MODEL", "LLM_MODEL_ID") ?? "gpt-4",
    // 规划器调参（新增键）
    trip_segment_days: readEnvInt(5, "TRIP_SEGMENT_DAYS"),
    trip_segment_concurrency: readEnvInt(8, "TRIP_SEGMENT_CONCURRENCY"),
    trip_review_enabled: readEnvBool("TRIP_REVIEW_ENABLED", true),
    llm_thinking_enabled: readEnvBool("LLM_THINKING_ENABLED", false),
    llm_thinking_visible: readEnvBool("LLM_THINKING_VISIBLE", false),
    trip_planner_timeout: readEnvInt(120, "TRIP_PLANNER_TIMEOUT"),
    trip_duplicate_repair_rounds: readEnvInt(2, "TRIP_DUPLICATE_REPAIR_ROUNDS"),
    pi_parent_session_limit: readEnvBoundedInt(
      "PI_PARENT_SESSION_LIMIT",
      RUNTIME_NUMBER_RANGES.pi_parent_session_limit,
    ),
    pi_parent_session_idle_seconds: readEnvBoundedInt(
      "PI_PARENT_SESSION_IDLE_SECONDS",
      RUNTIME_NUMBER_RANGES.pi_parent_session_idle_seconds,
    ),
    llm_api_style: readEnvEnum("LLM_API_STYLE", RUNTIME_ENUM_VALUES.llm_api_style, "responses"),
    chat_edit_agent: readEnvEnum("CHAT_EDIT_AGENT", RUNTIME_ENUM_VALUES.chat_edit_agent, "pi"),
    llm_timeout: readEnvInt(60, "LLM_TIMEOUT"),
    // 酒店参考价仅允许通过服务端环境变量配置，不进入运行时配置面。
    fliggy_proxy_token: readEnv("FLIGGY_PROXY_TOKEN") ?? "",
    fliggy_proxy_url: readEnv("FLIGGY_PROXY_URL")
      ?? "https://1439498936-6sysdjjt99.ap-guangzhou.tencentscf.com",
    fliggy_price_timeout_ms: readEnvBoundedInt("FLIGGY_PRICE_TIMEOUT_MS", {
      min: 500,
      max: 5_000,
      fallback: 3_000,
    }),
    fliggy_price_cache_ttl_seconds: readEnvBoundedInt("FLIGGY_PRICE_CACHE_TTL_SECONDS", {
      min: 0,
      max: 1_800,
      fallback: 300,
    }),
  };

  // runtime 覆盖（非空值）在 env 之上
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || !isEffectiveOverride(value)) continue;
    (settings as unknown as Record<string, unknown>)[key] = value;
  }
  return settings;
}

// ---------------------------------------------------------------------------
// 模块状态与公开 API
// ---------------------------------------------------------------------------

let settingsCache: AppSettings | null = null;
let runtimeOverrides: Partial<RuntimeSettings> = {};
let overridesLoaded = false;
let settingsRevision = 0;
const resetListeners: Array<() => void> = [];

function ensureLoaded(): void {
  if (overridesLoaded) return;
  runtimeOverrides = loadRuntimeOverrides();
  overridesLoaded = true;
}

/** 获取配置单例；env 为底、runtime 覆盖在上。 */
export function getSettings(): AppSettings {
  if (settingsCache !== null) return settingsCache;
  ensureLoaded();
  settingsCache = buildSettings(runtimeOverrides);
  return settingsCache;
}

export function runtimeSettingsSnapshot(settings: AppSettings): RuntimeSettings {
  const snapshot: Partial<RuntimeSettings> = {};
  for (const key of RUNTIME_KEYS) {
    (snapshot as Record<string, unknown>)[key] = settings[key];
  }
  return snapshot as RuntimeSettings;
}

export function effectiveThinkingVisible(
  settings: Pick<RuntimeSettings, "llm_thinking_enabled" | "llm_thinking_visible">,
): boolean {
  return settings.llm_thinking_enabled && settings.llm_thinking_visible;
}

export interface PreparedRuntimeSettings {
  settings: AppSettings;
  commit(): AppSettings;
}

/** 准备候选配置但不改变文件或全局配置；调用 commit 后才原子生效。 */
export function prepareRuntimeSettings(
  partial: Partial<RuntimeSettings>,
): PreparedRuntimeSettings {
  ensureLoaded();
  const baseRevision = settingsRevision;
  const nextOverrides = { ...runtimeOverrides };
  for (const [key, value] of Object.entries(partial)) {
    if (!isRuntimeKey(key) || !isValidRuntimeValue(key, value)) {
      console.warn(`⚠️  忽略非法运行时配置项: ${key}`);
      continue;
    }
    if (!isEffectiveOverride(value)) {
      // 空字符串 = 移除该键的覆盖，回退 env/默认值
      delete (nextOverrides as Record<string, unknown>)[key];
    } else {
      (nextOverrides as Record<string, unknown>)[key] = value;
    }
  }
  const candidate = buildSettings(nextOverrides);
  let committed = false;
  return {
    settings: candidate,
    commit() {
      if (committed) return candidate;
      if (settingsRevision !== baseRevision) {
        throw new Error("运行时配置已被其他更新修改，请重试");
      }
      persistOverrides(nextOverrides);
      runtimeOverrides = nextOverrides;
      settingsCache = candidate;
      settingsRevision += 1;
      committed = true;
      for (const listener of resetListeners) {
        try {
          listener();
        } catch (error) {
          console.warn(`⚠️  配置重置监听器执行失败: ${error}`);
        }
      }
      return candidate;
    },
  };
}

/** 更新运行时配置：过滤非法键→持久化→应用→触发重置监听器；返回最新 settings。 */
export function updateRuntimeSettings(
  partial: Partial<RuntimeSettings>,
): AppSettings {
  return prepareRuntimeSettings(partial).commit();
}

/** 注册热更新监听（如 resetModels），在 updateRuntimeSettings 应用后依次调用。 */
export function onSettingsReset(listener: () => void): void {
  resetListeners.push(listener);
}

/** 配置校验：返回警告列表（如缺 amap key、缺 LLM key），只警告不阻断。 */
export function validateConfig(): string[] {
  const settings = getSettings();
  const warnings: string[] = [];
  if (!settings.vite_amap_web_key) {
    warnings.push("VITE_AMAP_WEB_KEY未配置，景点地理编码等功能将不可用");
  }
  if (!settings.openai_api_key) {
    warnings.push("LLM API Key未配置，AI 生成功能将不可用");
  }
  return warnings;
}

/**
 * @internal 仅测试用：重置单例、覆盖项、监听器与目录缓存。
 * options.legacyRuntimeSettingsFile：指定迁移源（string）或禁用迁移（null），
 * 避免测试触碰真实的 backend/runtime_settings.json。
 */
export function _resetSettingsForTest(options?: {
  legacyRuntimeSettingsFile?: string | null;
}): void {
  settingsCache = null;
  runtimeOverrides = {};
  overridesLoaded = false;
  settingsRevision = 0;
  resetListeners.length = 0;
  legacyRuntimeFileOverride = undefined;
  _resetDataDirCacheForTest();
  if (options && "legacyRuntimeSettingsFile" in options) {
    legacyRuntimeFileOverride = options.legacyRuntimeSettingsFile ?? null;
  }
}
