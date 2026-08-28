export interface WebViewLaunchOptions {
  share?: string;
  plan_id?: string;
  section?: string;
  path?: string;
  conversation?: string;
  nav_color?: string;
}

export interface WebViewLaunch {
  public: boolean;
  path: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SHARE_PATTERN = /^[A-Fa-f0-9]{32}$/;
const SECTIONS = new Set(["today", "overview", "days", "map", "budget", "weather"]);
export const NAVIGATION_COLOR_STORAGE_KEY = "youban.navigation_color";

interface NavigationColorPlatform {
  setNavigationBarColor(options: {
    frontColor: "#000000";
    backgroundColor: string;
    animation: { duration: number; timingFunc: "linear" };
  }): void;
  setStorageSync(key: string, value: string): void;
}

function normalizeNavigationColor(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}

export function applyNavigationBarColor(
  value: unknown,
  platform: NavigationColorPlatform = wx,
): boolean {
  const color = normalizeNavigationColor(value);
  if (!color) return false;
  platform.setNavigationBarColor({
    frontColor: "#000000",
    backgroundColor: color,
    animation: { duration: 0, timingFunc: "linear" },
  });
  platform.setStorageSync(NAVIGATION_COLOR_STORAGE_KEY, color);
  return true;
}

export function resolveWebViewLaunch(options: WebViewLaunchOptions): WebViewLaunch {
  const navigationColor = normalizeNavigationColor(`#${String(options.nav_color || "")}`)?.slice(1) ?? "";
  const withNavigationColor = (path: string): string => {
    if (!navigationColor) return path;
    return `${path}${path.includes("?") ? "&" : "?"}mini_nav=${navigationColor}`;
  };
  const share = String(options.share || "").trim();
  if (SHARE_PATTERN.test(share)) {
    return { public: true, path: withNavigationColor(`/share/${share}?host=miniprogram`) };
  }
  if (options.path === "/privacy") {
    return { public: true, path: withNavigationColor("/privacy?host=miniprogram") };
  }
  const planId = String(options.plan_id || "").trim();
  if (ID_PATTERN.test(planId)) {
    const section = String(options.section || "").trim();
    return {
      public: false,
      path: withNavigationColor(`/plan/${planId}${SECTIONS.has(section) ? `?section=${section}` : ""}`),
    };
  }
  const conversation = String(options.conversation || "").trim();
  if (ID_PATTERN.test(conversation)) {
    return { public: false, path: withNavigationColor(`/?conversation=${conversation}`) };
  }
  return { public: false, path: withNavigationColor("/") };
}

export function isPublicWebViewLaunch(options: WebViewLaunchOptions): boolean {
  return resolveWebViewLaunch(options).public;
}

export function shouldRefreshWebViewOnShow(hasShown: boolean): boolean {
  return hasShown;
}
