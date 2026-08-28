import { createHash } from "node:crypto";

const WEB_SESSION_TTL_MS = 60_000;
const NATIVE_ACTION_TTL_MS = 5 * 60_000;
const SHARE_CODE_PATTERN = /^[a-f0-9]{32}$/i;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RESULT_SECTIONS = new Set([
  "today",
  "overview",
  "days",
  "weather",
  "budget",
  "map",
]);

export type NativeActionType = "share" | "save_guide" | "add_calendar";

export interface MiniWebSessionTicket {
  exchange_url: string;
  expires_at: string;
}

export interface NativeActionTicket {
  action_id: string;
  expires_at: string;
}

interface MiniProgramBridgeOptions {
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  removeTemporaryFile?: (path: string) => void;
}

interface WebSessionRecord {
  userId: string;
  redirectPath: string;
  expiresAt: number;
}

interface NativeActionRecord {
  userId: string;
  type: NativeActionType;
  payload: Record<string, unknown>;
  temporaryFilePath?: string;
  expiresAt: number;
}

export class MiniProgramBridgeError extends Error {}

function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

function routePath(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  if (segments.length === 1 && segments[0] === "privacy") return "/privacy";
  if (segments.length === 2 && segments[0] === "plan" && ROUTE_ID_PATTERN.test(segments[1]!)) {
    return `/plan/${segments[1]}`;
  }
  if (segments.length === 2 && segments[0] === "share" && SHARE_CODE_PATTERN.test(segments[1]!)) {
    return `/share/${segments[1]}`;
  }
  throw new MiniProgramBridgeError("WebView 跳转地址不在白名单内");
}

export function normalizeMiniProgramRedirectPath(input: string): string {
  const raw = input.trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("#")) {
    throw new MiniProgramBridgeError("WebView 跳转地址无效");
  }
  let url: URL;
  try {
    url = new URL(raw, "https://youban.invalid");
  } catch {
    throw new MiniProgramBridgeError("WebView 跳转地址无效");
  }
  if (url.origin !== "https://youban.invalid") throw new MiniProgramBridgeError("WebView 跳转地址无效");
  const pathname = routePath(url);
  for (const key of url.searchParams.keys()) {
    if (key !== "section" && key !== "host" && key !== "conversation" && key !== "mini_nav") {
      throw new MiniProgramBridgeError("WebView 跳转参数不在白名单内");
    }
  }
  const conversation = url.searchParams.get("conversation")?.trim() ?? "";
  if (conversation && (pathname !== "/" || !ROUTE_ID_PATTERN.test(conversation))) {
    throw new MiniProgramBridgeError("对话地址不在白名单内");
  }
  const section = url.searchParams.get("section")?.trim() ?? "";
  if (section && !RESULT_SECTIONS.has(section)) {
    throw new MiniProgramBridgeError("结果分区不在白名单内");
  }
  const navigationColor = url.searchParams.get("mini_nav")?.trim().toLowerCase() ?? "";
  if (navigationColor && !/^[0-9a-f]{6}$/.test(navigationColor)) {
    throw new MiniProgramBridgeError("导航颜色无效");
  }
  const query = new URLSearchParams({ host: "miniprogram" });
  if (conversation) query.set("conversation", conversation);
  if (section) query.set("section", section);
  if (navigationColor) query.set("mini_nav", navigationColor);
  return `${pathname}?${query.toString()}`;
}

export class MiniProgramBridgeService {
  private readonly now: () => number;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly removeTemporaryFile: (path: string) => void;
  private readonly webSessions = new Map<string, WebSessionRecord>();
  private readonly actions = new Map<string, NativeActionRecord>();
  private readonly actionExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: MiniProgramBridgeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? ((length) => crypto.getRandomValues(new Uint8Array(length)));
    this.removeTemporaryFile = options.removeTemporaryFile ?? (() => undefined);
  }

  createWebSession(userId: string, redirectPath: string): { ticket: string; expires_at: string } {
    const ticket = this.newTicket();
    const expiresAt = this.now() + WEB_SESSION_TTL_MS;
    this.webSessions.set(hashTicket(ticket), {
      userId,
      redirectPath: normalizeMiniProgramRedirectPath(redirectPath),
      expiresAt,
    });
    return { ticket, expires_at: new Date(expiresAt).toISOString() };
  }

  consumeWebSession(ticket: string): { user_id: string; redirect_path: string } {
    const key = hashTicket(ticket.trim());
    const record = this.webSessions.get(key);
    if (!record) throw new MiniProgramBridgeError("票据无效或已兑换");
    this.webSessions.delete(key);
    if (record.expiresAt <= this.now()) throw new MiniProgramBridgeError("票据已过期");
    return { user_id: record.userId, redirect_path: record.redirectPath };
  }

  createAction(
    userId: string,
    type: NativeActionType,
    payload: Record<string, unknown>,
    temporaryFilePath?: string,
  ): NativeActionTicket {
    const actionId = this.newTicket();
    const expiresAt = this.now() + NATIVE_ACTION_TTL_MS;
    const key = hashTicket(actionId);
    this.actions.set(key, {
      userId,
      type,
      payload: structuredClone(payload),
      temporaryFilePath,
      expiresAt,
    });
    const timer = setTimeout(() => {
      const record = this.actions.get(key);
      if (record && record.expiresAt <= this.now()) this.deleteAction(key, record);
    }, NATIVE_ACTION_TTL_MS + 10);
    timer.unref?.();
    this.actionExpiryTimers.set(key, timer);
    return { action_id: actionId, expires_at: new Date(expiresAt).toISOString() };
  }

  getAction(actionId: string, userId: string): {
    type: NativeActionType;
    payload: Record<string, unknown>;
    expires_at: string;
  } {
    const key = hashTicket(actionId.trim());
    const record = this.actions.get(key);
    if (!record) throw new MiniProgramBridgeError("动作票据无效或已完成");
    if (record.expiresAt <= this.now()) {
      this.deleteAction(key, record);
      throw new MiniProgramBridgeError("动作票据已过期");
    }
    if (record.userId !== userId) throw new MiniProgramBridgeError("动作票据无权访问");
    return {
      type: record.type,
      payload: structuredClone(record.payload),
      expires_at: new Date(record.expiresAt).toISOString(),
    };
  }

  getTemporaryFile(actionId: string, userId: string): string | undefined {
    this.getAction(actionId, userId);
    return this.actions.get(hashTicket(actionId.trim()))?.temporaryFilePath;
  }

  completeAction(actionId: string, userId: string): void {
    const key = hashTicket(actionId.trim());
    const record = this.actions.get(key);
    if (!record) throw new MiniProgramBridgeError("动作票据无效或已完成");
    if (record.userId !== userId) throw new MiniProgramBridgeError("动作票据无权访问");
    this.deleteAction(key, record);
  }

  debugStoredTicketMaterial(): string {
    return JSON.stringify({ web: [...this.webSessions.keys()], actions: [...this.actions.keys()] });
  }

  private deleteAction(key: string, record: NativeActionRecord): void {
    this.actions.delete(key);
    const timer = this.actionExpiryTimers.get(key);
    if (timer) clearTimeout(timer);
    this.actionExpiryTimers.delete(key);
    if (record.temporaryFilePath) this.removeTemporaryFile(record.temporaryFilePath);
  }

  close(): void {
    for (const [key, record] of this.actions) this.deleteAction(key, record);
    this.webSessions.clear();
  }

  private newTicket(): string {
    return Buffer.from(this.randomBytes(32)).toString("base64url");
  }
}
