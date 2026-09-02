import { join } from "node:path";
import { getDataDir, getRepoRoot } from "./config/paths.ts";
import { getSettings, validateConfig } from "./config/settings.ts";
import { createHttpRuntime } from "./http/app.ts";
import { WechatAvatarImporter } from "./services/wechat-avatar-import.ts";
import { WechatCodeExchange } from "./services/wechat-code-exchange.ts";
import { WechatWebOAuth } from "./services/wechat-web-oauth.ts";
import {
  installMemoryPressureHandler,
  listenProductionHttpServer,
  shutdownServer,
} from "./runtime/server-lifecycle.ts";

function runtimeAuthentication() {
  const settings = getSettings();
  const website = (() => {
    const appId = settings.wechat_web_app_id.trim();
    const appSecret = settings.wechat_web_app_secret.trim();
    const redirectUri = settings.wechat_web_redirect_uri.trim();
    if (!appId || !appSecret || !redirectUri) return undefined;
    try {
      const redirect = new URL(redirectUri);
      if (redirect.protocol !== "https:") return undefined;
      if (process.env.NODE_ENV?.trim() === "production" && redirect.hostname !== "youban.me") {
        return undefined;
      }
    } catch {
      return undefined;
    }
    const oauth = new WechatWebOAuth({ appId, appSecret });
    const avatarImporter = new WechatAvatarImporter({
      avatarsDir: join(getDataDir(), "avatars"),
    });
    return {
      appId,
      redirectUri,
      exchangeCode: (code: string) => oauth.exchange(code),
      importAvatar: (avatarUrl: string) => avatarImporter.import(avatarUrl),
    };
  })();
  const developmentMode = process.env.YOUBAN_DEV_WECHAT_AUTH?.trim() === "1";
  if (developmentMode) {
    if (process.env.NODE_ENV?.trim() === "production") {
      throw new Error("YOUBAN_DEV_WECHAT_AUTH cannot be enabled in production");
    }
    return {
      pepper: process.env.AUTH_PEPPER?.trim() || "youban-local-development-only-auth-pepper-v1",
      exchangeWechatCode: async () => ({
        openid: "youban-local-wechat-openid",
        unionid: "youban-local-wechat-unionid",
      }),
      website,
    };
  }
  const appSecret = process.env.WECHAT_APP_SECRET?.trim() ?? "";
  const pepper = process.env.AUTH_PEPPER?.trim() ?? "";
  if (!appSecret) throw new Error("WECHAT_APP_SECRET is required");
  if (Buffer.byteLength(pepper, "utf8") < 32) {
    throw new Error("AUTH_PEPPER must contain at least 32 bytes");
  }
  const exchange = new WechatCodeExchange({
    appId: process.env.WECHAT_APP_ID?.trim() || "wx42ddc076b365bf0d",
    appSecret,
  });
  return {
    pepper,
    exchangeWechatCode: (code: string) => exchange.exchange(code),
    website,
  };
}

export const runtime = createHttpRuntime({
  dataDir: getDataDir(),
  frontendDist: join(getRepoRoot(), "frontend", "dist", "build", "h5"),
  authentication: runtimeAuthentication(),
});
export const app = runtime.app;

if (import.meta.main) {
  const settings = getSettings();
  const warnings = validateConfig();
  if (warnings.length > 0) {
    console.log("\n⚠️  配置警告:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
  const server = listenProductionHttpServer(app, { hostname: settings.host, port: settings.port });
  console.log(
    `${settings.app_name} v${settings.app_version} 已启动: http://${settings.host}:${settings.port}`,
  );
  const removeMemoryPressureHandler = installMemoryPressureHandler(runtime);
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`收到 ${signal}，正在关闭服务...`);
    removeMemoryPressureHandler();
    try {
      await shutdownServer(server, runtime, { timeoutMs: 30_000 });
    } catch (error) {
      console.error(`服务关闭失败: ${error}`);
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
