import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as runtimeConfig from "../src/config";
import { resolveWebViewLaunch, shouldRefreshWebViewOnShow } from "../src/services/webview-route";
import * as webViewRoute from "../src/services/webview-route";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("mini-program WebView shell", () => {
  it("uses the local Web UI in develop and the production domain in trial or release", () => {
    const resolveRuntimeBaseUrl = (runtimeConfig as {
      resolveRuntimeBaseUrl?: (envVersion?: string) => string;
    }).resolveRuntimeBaseUrl;

    expect(resolveRuntimeBaseUrl?.("develop")).toBe("http://127.0.0.1:7860");
    expect(resolveRuntimeBaseUrl?.("trial")).toBe("https://youban.me");
    expect(resolveRuntimeBaseUrl?.("release")).toBe("https://youban.me");
  });

  it("registers only login, WebView, and generic native action pages", () => {
    const app = JSON.parse(source("../src/app.json"));
    expect(app.pages).toEqual([
      "pages/login/index",
      "pages/web/index",
      "pages/native-action/index",
    ]);
  });

  it("uses the short native WebView title instead of an ineffective custom navigation setting", () => {
    const page = JSON.parse(source("../src/pages/web/index.json"));
    expect(page.navigationStyle).toBeUndefined();
    expect(page.navigationBarTitleText).toBe("游伴");
    expect(page.navigationBarBackgroundColor).toBe("#fffaf6");
  });

  it("applies only a validated navigation color passed to the native shell", () => {
    const applyNavigationBarColor = webViewRoute.applyNavigationBarColor;
    expect(typeof applyNavigationBarColor).toBe("function");

    const calls: Array<Record<string, unknown>> = [];
    const stored: Array<[string, string]> = [];
    expect(applyNavigationBarColor("#EEF7F9", {
      setNavigationBarColor: (options) => calls.push(options),
      setStorageSync: (key, value) => stored.push([key, value]),
    })).toBe(true);
    expect(calls).toEqual([{
      frontColor: "#000000",
      backgroundColor: "#eef7f9",
      animation: { duration: 0, timingFunc: "linear" },
    }]);
    expect(stored).toEqual([["youban.navigation_color", "#eef7f9"]]);
    expect(applyNavigationBarColor("bad", {
      setNavigationBarColor: () => { throw new Error("invalid color must not reach wx"); },
      setStorageSync: () => { throw new Error("invalid color must not be cached"); },
    })).toBe(false);
  });

  it("routes public shares directly and private routes through a session exchange", () => {
    expect(resolveWebViewLaunch({ share: "a".repeat(32), nav_color: "eef7f9" })).toEqual({
      public: true,
      path: `/share/${"a".repeat(32)}?host=miniprogram&mini_nav=eef7f9`,
    });
    expect(resolveWebViewLaunch({ plan_id: "plan-123", section: "weather", nav_color: "eef7f9" })).toEqual({
      public: false,
      path: "/plan/plan-123?section=weather&mini_nav=eef7f9",
    });
    expect(resolveWebViewLaunch({ conversation: "session-123", nav_color: "fffaf6" })).toEqual({
      public: false,
      path: "/?conversation=session-123&mini_nav=fffaf6",
    });
    expect(resolveWebViewLaunch({ path: "/privacy" })).toEqual({ public: true, path: "/privacy?host=miniprogram" });
    expect(resolveWebViewLaunch({ path: "https://evil.example" })).toEqual({ public: false, path: "/" });
    expect(resolveWebViewLaunch({ conversation: "bad/id", nav_color: "transparent" })).toEqual({ public: false, path: "/" });
  });

  it("applies a launch color before opening the WebView and no longer relies on bindload URLs", () => {
    const pageSource = source("../src/pages/web/index.ts");
    expect(pageSource).toContain("options.nav_color");
    expect(pageSource).not.toContain("navigationBarColorFromWebViewUrl");
  });

  it("refreshes the existing WebView only when it returns from a native proxy", () => {
    expect(shouldRefreshWebViewOnShow(false)).toBe(false);
    expect(shouldRefreshWebViewOnShow(true)).toBe(true);
  });

  it("uses the native WebView and share button without duplicating business UI", () => {
    expect(source("../src/pages/web/index.wxml")).toContain("<web-view")
    expect(source("../src/pages/web/index.wxml")).toContain('binderror="onWebViewError"')
    expect(source("../src/pages/native-action/index.wxml")).toContain('open-type="share"')
    expect(source("../src/pages/native-action/index.wxml")).toContain('open-type="chooseAvatar"')
    expect(source("../src/pages/native-action/index.wxml")).toContain('bindtap="logout"')
    expect(source("../src/pages/web/index.ts")).toContain("/api/auth/miniprogram/web-session/public?path=")

    for (const path of [
      "../src/pages/planning",
      "../src/pages/progress",
      "../src/pages/trip-detail",
      "../src/pages/map",
      "../src/services/trip-view.ts",
      "../src/services/task-watcher.ts",
      "../src/services/sse-decoder.ts",
      "../src/fixtures/trip-result-parity.generated.ts",
      "../src/styles/theme.generated.wxss",
    ]) {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false)
    }
  });
});
