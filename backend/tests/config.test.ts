/**
 * 配置模块测试（bun test）。
 * 隔离策略：每个用例使用独立 tests/tmp/case-N 作为 DATA_DIR；env 快照/恢复；
 * 迁移源通过 _resetSettingsForTest({ legacyRuntimeSettingsFile }) 指向伪造文件，
 * 不触碰真实的 backend/runtime_settings.json 与 data/。
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ensureDataSubdir, getDataDir } from "../src/config/paths.ts";
import {
  _resetSettingsForTest,
  effectiveThinkingVisible,
  getSettings,
  onSettingsReset,
  prepareRuntimeSettings,
  runtimeSettingsSnapshot,
  updateRuntimeSettings,
  validateConfig,
  type RuntimeSettings,
} from "../src/config/settings.ts";

const TMP_ROOT = join(import.meta.dir, "tmp");

/** 测试会改动的全部 env 键，beforeEach 快照并清空、afterEach 恢复。 */
const ENV_KEYS = [
  "DATA_DIR",
  "OPENAI_API_KEY",
  "LLM_API_KEY",
  "OPENAI_BASE_URL",
  "LLM_BASE_URL",
  "OPENAI_MODEL",
  "LLM_MODEL_ID",
  "VITE_AMAP_WEB_KEY",
  "VITE_AMAP_WEB_JS_KEY",
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_PROXY",
  "XHS_COOKIE",
  "APP_NAME",
  "APP_VERSION",
  "DEBUG",
  "HOST",
  "PORT",
  "CORS_ORIGINS",
  "FLYAI_ENABLED",
  "FLYAI_CLI_PATH",
  "FLYAI_API_KEY",
  "FLYAI_TIMEOUT_SECONDS",
  "FLYAI_CACHE_TTL_SECONDS",
  "LLM_TIMEOUT",
  "TRIP_SEGMENT_DAYS",
  "TRIP_SEGMENT_CONCURRENCY",
  "TRIP_REVIEW_ENABLED",
  "TRIP_PLANNER_TIMEOUT",
  "TRIP_DUPLICATE_REPAIR_ROUNDS",
  "LLM_API_STYLE",
  "CHAT_EDIT_AGENT",
  "PI_PARENT_SESSION_LIMIT",
  "PI_PARENT_SESSION_IDLE_SECONDS",
  "LLM_THINKING_ENABLED",
  "LLM_THINKING_VISIBLE",
  "FLIGGY_PROXY_TOKEN",
  "FLIGGY_PROXY_URL",
  "FLIGGY_PRICE_TIMEOUT_MS",
  "FLIGGY_PRICE_CACHE_TTL_SECONDS",
  "WECHAT_WEB_APP_ID",
  "WECHAT_WEB_APP_SECRET",
  "WECHAT_WEB_REDIRECT_URI",
];

let savedEnv: Record<string, string | undefined> = {};
let caseDir = "";
let caseSeq = 0;

function writeRuntimeFile(dir: string, data: Record<string, unknown>): string {
  const file = join(dir, "runtime_settings.json");
  writeFileSync(file, JSON.stringify(data), "utf-8");
  return file;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  caseSeq += 1;
  caseDir = join(TMP_ROOT, `case-${caseSeq}`);
  mkdirSync(caseDir, { recursive: true });
  process.env.DATA_DIR = caseDir;
  // 默认禁用迁移，避免读到真实的 backend/runtime_settings.json
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetSettingsForTest();
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("paths", () => {
  it("getDataDir 默认指向仓库根 data/", () => {
    delete process.env.DATA_DIR;
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
    const expected = resolve(import.meta.dir, "..", "..", "data");
    expect(getDataDir()).toBe(expected);
  });

  it("getDataDir 优先使用 DATA_DIR env", () => {
    expect(getDataDir()).toBe(caseDir);
  });

  it("ensureDataSubdir 递归创建并返回路径", () => {
    const dir = ensureDataSubdir(join("nested", "sub"));
    expect(dir).toBe(join(caseDir, "nested", "sub"));
    expect(existsSync(dir)).toBe(true);
  });
});

describe("settings: env 读取", () => {
  it("env 别名回退：未设 OPENAI_* 时回退 LLM_*", () => {
    process.env.LLM_API_KEY = "alias-key";
    process.env.LLM_BASE_URL = "https://alias.example/v1";
    process.env.LLM_MODEL_ID = "alias-model";
    const settings = getSettings();
    expect(settings.openai_api_key).toBe("alias-key");
    expect(settings.openai_base_url).toBe("https://alias.example/v1");
    expect(settings.openai_model).toBe("alias-model");
  });

  it("OPENAI_* 优先于 LLM_* 别名", () => {
    process.env.OPENAI_API_KEY = "primary-key";
    process.env.LLM_API_KEY = "alias-key";
    process.env.OPENAI_MODEL = "primary-model";
    process.env.LLM_MODEL_ID = "alias-model";
    const settings = getSettings();
    expect(settings.openai_api_key).toBe("primary-key");
    expect(settings.openai_model).toBe("primary-model");
  });

  it("未配置时应用默认值", () => {
    const settings = getSettings();
    expect(settings.openai_base_url).toBe("https://api.openai.com/v1");
    expect(settings.openai_model).toBe("gpt-4");
    expect(settings.app_name).toBe("HelloAgents智能旅行助手");
    expect(settings.app_version).toBe("2.0.9");
    expect(settings.host).toBe("0.0.0.0");
    expect(settings.port).toBe(8000);
    expect(settings.cors_origins).toEqual([
      "http://localhost:9000",
      "http://127.0.0.1:9000",
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
    ]);
    expect(settings.trip_segment_days).toBe(5);
    expect(settings.trip_segment_concurrency).toBe(8);
    expect(settings.trip_review_enabled).toBe(true);
    expect(settings.trip_planner_timeout).toBe(120);
    expect(settings.trip_duplicate_repair_rounds).toBe(2);
    expect(settings.llm_api_style).toBe("responses");
    expect(settings.chat_edit_agent).toBe("pi");
    expect(settings.llm_timeout).toBe(60);
    expect(settings.pi_parent_session_limit).toBe(64);
    expect(settings.pi_parent_session_idle_seconds).toBe(1800);
    expect(settings.llm_thinking_enabled).toBe(false);
    expect(settings.llm_thinking_visible).toBe(false);
    expect(settings.fliggy_proxy_token).toBe("");
    expect(settings.fliggy_proxy_url).toBe("https://1439498936-6sysdjjt99.ap-guangzhou.tencentscf.com");
    expect(settings.fliggy_price_timeout_ms).toBe(3000);
    expect(settings.fliggy_price_cache_ttl_seconds).toBe(300);
  });

  it("reads bounded Fliggy server-only settings", () => {
    process.env.FLIGGY_PROXY_TOKEN = "server-token";
    process.env.FLIGGY_PROXY_URL = "https://proxy.example/hotel";
    process.env.FLIGGY_PRICE_TIMEOUT_MS = "1200";
    process.env.FLIGGY_PRICE_CACHE_TTL_SECONDS = "60";
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    expect(getSettings()).toEqual(expect.objectContaining({
      fliggy_proxy_token: "server-token",
      fliggy_proxy_url: "https://proxy.example/hotel",
      fliggy_price_timeout_ms: 1200,
      fliggy_price_cache_ttl_seconds: 60,
    }));

    process.env.FLIGGY_PRICE_TIMEOUT_MS = "499";
    process.env.FLIGGY_PRICE_CACHE_TTL_SECONDS = "1801";
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
    expect(getSettings().fliggy_price_timeout_ms).toBe(3000);
    expect(getSettings().fliggy_price_cache_ttl_seconds).toBe(300);
  });

  it("keeps retired website OAuth environment variables outside application settings", () => {
    process.env.WECHAT_WEB_APP_ID = "wx-web-app";
    process.env.WECHAT_WEB_APP_SECRET = "web-secret";
    process.env.WECHAT_WEB_REDIRECT_URI =
      "https://youban.me/api/v2/auth/wechat-web/callback";
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    const settings = getSettings();

    expect(Object.keys(settings as unknown as Record<string, unknown>)
      .filter((key) => key.startsWith("wechat_web_"))).toEqual([]);
    const runtime = runtimeSettingsSnapshot(settings);
    expect(runtime).not.toHaveProperty("wechat_web_app_id");
    expect(runtime).not.toHaveProperty("wechat_web_app_secret");
    expect(runtime).not.toHaveProperty("wechat_web_redirect_uri");
  });

  it("reads valid model thinking environment overrides", () => {
    process.env.LLM_THINKING_ENABLED = "true";
    process.env.LLM_THINKING_VISIBLE = "true";
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    const settings = getSettings();

    expect(settings.llm_thinking_enabled).toBe(true);
    expect(settings.llm_thinking_visible).toBe(true);
  });

  it("读取父 Agent 会话池的有界环境变量", () => {
    process.env.PI_PARENT_SESSION_LIMIT = "8";
    process.env.PI_PARENT_SESSION_IDLE_SECONDS = "120";
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    const settings = getSettings();

    expect(settings.pi_parent_session_limit).toBe(8);
    expect(settings.pi_parent_session_idle_seconds).toBe(120);
  });

  it("忽略越界的父 Agent 会话池环境变量和运行时覆盖", () => {
    process.env.PI_PARENT_SESSION_LIMIT = "2048";
    process.env.PI_PARENT_SESSION_IDLE_SECONDS = "59";
    writeRuntimeFile(caseDir, {
      pi_parent_session_limit: 0,
      pi_parent_session_idle_seconds: 86401,
    });
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    const settings = getSettings();

    expect(settings.pi_parent_session_limit).toBe(64);
    expect(settings.pi_parent_session_idle_seconds).toBe(1800);
  });

  it("已移除的 FlyAI 环境变量不会重新进入服务配置面", () => {
    process.env.FLYAI_ENABLED = "true";
    process.env.FLYAI_API_KEY = "must-not-leak";

    const settings = getSettings() as unknown as Record<string, unknown>;

    expect(Object.keys(settings).filter((key) => key.startsWith("flyai_"))).toEqual([]);
  });

  it("已移除的 Google 地图和小红书配置不会重新进入活动配置面", () => {
    process.env.GOOGLE_MAPS_API_KEY = "legacy-google-key";
    process.env.GOOGLE_MAPS_PROXY = "http://127.0.0.1:7890";
    process.env.XHS_COOKIE = "legacy-xhs-cookie";
    writeRuntimeFile(caseDir, {
      google_maps_api_key: "persisted-google-key",
      google_maps_proxy: "socks5://127.0.0.1:1080",
      xhs_cookie: "persisted-xhs-cookie",
      openai_model: "active-model",
    });
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    const settings = getSettings() as unknown as Record<string, unknown>;
    const runtime = runtimeSettingsSnapshot(getSettings()) as unknown as Record<string, unknown>;

    expect(settings.openai_model).toBe("active-model");
    expect(settings).not.toHaveProperty("google_maps_api_key");
    expect(settings).not.toHaveProperty("google_maps_proxy");
    expect(settings).not.toHaveProperty("xhs_cookie");
    expect(runtime).not.toHaveProperty("google_maps_api_key");
    expect(runtime).not.toHaveProperty("google_maps_proxy");
    expect(runtime).not.toHaveProperty("xhs_cookie");
  });
});

describe("settings: runtime 覆盖", () => {
  it("runtime_settings.json 非空值覆盖 env，空字符串与非法键不生效", () => {
    process.env.OPENAI_MODEL = "env-model";
    process.env.OPENAI_API_KEY = "env-key";
    writeRuntimeFile(caseDir, {
      openai_model: "runtime-model",
      openai_api_key: "",
      trip_segment_days: 7,
      bogus_key: "should-be-dropped",
      trip_planner_timeout: "not-a-number",
    });
    const settings = getSettings();
    expect(settings.openai_model).toBe("runtime-model");
    expect(settings.openai_api_key).toBe("env-key");
    expect(settings.trip_segment_days).toBe(7);
    expect(settings.trip_planner_timeout).toBe(120);
    expect((settings as unknown as Record<string, unknown>).bogus_key).toBeUndefined();
  });

  it("旧位置 backend/runtime_settings.json 迁移到 DATA_DIR", () => {
    const legacyDir = join(caseDir, "backend");
    mkdirSync(legacyDir, { recursive: true });
    const legacyFile = writeRuntimeFile(legacyDir, {
      openai_model: "legacy-model",
      illegal_key: 1,
      openai_api_key: 123,
    });
    _resetSettingsForTest({ legacyRuntimeSettingsFile: legacyFile });

    const settings = getSettings();
    expect(settings.openai_model).toBe("legacy-model");
    expect(settings.openai_api_key).toBe(""); // 数字类型非法，被丢弃

    const migrated = join(caseDir, "runtime_settings.json");
    expect(existsSync(migrated)).toBe(true);
    const data = readJson(migrated);
    expect(data.openai_model).toBe("legacy-model");
    expect(data.illegal_key).toBeUndefined();
    expect(data.openai_api_key).toBeUndefined();
  });

  it("DATA_DIR 已有 runtime_settings.json 时不迁移旧文件", () => {
    writeRuntimeFile(caseDir, { openai_model: "current-model" });
    const legacyDir = join(caseDir, "backend");
    mkdirSync(legacyDir, { recursive: true });
    const legacyFile = writeRuntimeFile(legacyDir, { openai_model: "legacy-model" });
    _resetSettingsForTest({ legacyRuntimeSettingsFile: legacyFile });

    expect(getSettings().openai_model).toBe("current-model");
    const data = readJson(join(caseDir, "runtime_settings.json"));
    expect(data.openai_model).toBe("current-model");
  });
});

describe("settings: updateRuntimeSettings", () => {
  it("does not allow runtime settings to expose or overwrite the Fliggy token", () => {
    process.env.FLIGGY_PROXY_TOKEN = "server-token";
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });

    const updated = updateRuntimeSettings({
      fliggy_proxy_token: "runtime-leak",
    } as unknown as Partial<RuntimeSettings>);

    expect((updated as unknown as Record<string, unknown>).fliggy_proxy_token).toBe("server-token");
    expect(readJson(join(caseDir, "runtime_settings.json")).fliggy_proxy_token).toBeUndefined();
  });

  it("keeps a prepared candidate invisible until it is committed", () => {
    const previous = getSettings().openai_model;
    const prepared = prepareRuntimeSettings({ openai_model: "candidate-model" });

    expect(prepared.settings.openai_model).toBe("candidate-model");
    expect(getSettings().openai_model).toBe(previous);
    expect(existsSync(join(caseDir, "runtime_settings.json"))).toBe(false);

    expect(prepared.commit().openai_model).toBe("candidate-model");
    expect(getSettings().openai_model).toBe("candidate-model");
    expect(readJson(join(caseDir, "runtime_settings.json")).openai_model).toBe("candidate-model");
  });

  it("过滤非法键与错误类型，原子持久化，触发监听器", () => {
    let listenerCalls = 0;
    onSettingsReset(() => {
      listenerCalls += 1;
    });

    const updated = updateRuntimeSettings({
      openai_model: "new-model",
      trip_segment_days: 9,
      hack_key: "x",
      trip_planner_timeout: "fast",
    } as unknown as Partial<RuntimeSettings>);

    expect(updated.openai_model).toBe("new-model");
    expect(updated.trip_segment_days).toBe(9);
    expect(updated.trip_planner_timeout).toBe(120); // 类型错误被过滤
    expect(listenerCalls).toBe(1);
    // 单例已同步更新
    expect(getSettings().openai_model).toBe("new-model");

    const persisted = readJson(join(caseDir, "runtime_settings.json"));
    expect(persisted.openai_model).toBe("new-model");
    expect(persisted.trip_segment_days).toBe(9);
    expect(persisted.hack_key).toBeUndefined();
    expect(persisted.trip_planner_timeout).toBeUndefined();
    // 原子写不遗留 tmp 文件
    expect(existsSync(join(caseDir, "runtime_settings.json.tmp"))).toBe(false);
  });

  it("运行时配置始终仅允许文件所有者读取，即使覆盖了宽权限 tmp", () => {
    const tmp = join(caseDir, "runtime_settings.json.tmp");
    writeFileSync(tmp, "stale", "utf8");
    chmodSync(tmp, 0o644);

    updateRuntimeSettings({ openai_model: "secure-model" });

    const mode = statSync(join(caseDir, "runtime_settings.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("accepts boolean thinking overrides, rejects invalid values, and requires enabled thinking for visibility", () => {
    const updated = updateRuntimeSettings({
      llm_thinking_enabled: true,
      llm_thinking_visible: true,
    });

    expect(updated.llm_thinking_enabled).toBe(true);
    expect(updated.llm_thinking_visible).toBe(true);
    expect(effectiveThinkingVisible(updated)).toBe(true);
    expect(effectiveThinkingVisible({
      llm_thinking_enabled: false,
      llm_thinking_visible: true,
    })).toBe(false);

    const invalid = updateRuntimeSettings({
      llm_thinking_enabled: "true",
      llm_thinking_visible: 1,
    } as unknown as Partial<RuntimeSettings>);
    expect(invalid.llm_thinking_enabled).toBe(true);
    expect(invalid.llm_thinking_visible).toBe(true);
  });

  it("空字符串视为移除覆盖，回退到 env", () => {
    process.env.OPENAI_MODEL = "env-model";
    updateRuntimeSettings({ openai_model: "runtime-model" });
    expect(getSettings().openai_model).toBe("runtime-model");

    updateRuntimeSettings({ openai_model: "" });
    expect(getSettings().openai_model).toBe("env-model");
    const persisted = readJson(join(caseDir, "runtime_settings.json"));
    expect("openai_model" in persisted).toBe(false);
  });
});

describe("settings: validateConfig", () => {
  it("缺少必要 key 时返回警告列表", () => {
    const warnings = validateConfig();
    expect(warnings.some((w) => w.includes("VITE_AMAP_WEB_KEY"))).toBe(true);
    expect(warnings.some((w) => w.includes("LLM"))).toBe(true);
  });

  it("配置齐全时无警告", () => {
    process.env.VITE_AMAP_WEB_KEY = "amap-key";
    process.env.OPENAI_API_KEY = "llm-key";
    expect(validateConfig()).toEqual([]);
  });
});
