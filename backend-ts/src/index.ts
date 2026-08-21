/**
 * 临时最小入口（T3 会扩展为完整 HTTP 骨架）。
 * export const app 供测试用 .handle() 直接打请求；仅直接运行时监听端口。
 */
import { Elysia } from "elysia";
import { getSettings, validateConfig } from "./config/settings.ts";

export const app = new Elysia()
  .get("/health", () => {
    const settings = getSettings();
    return {
      status: "healthy",
      version: settings.app_version,
      service: settings.app_name,
    };
  })
  .get("/api/settings", () => {
    const settings = getSettings();
    // 只出 4 个公开字段，不含 LLM Key 等敏感项
    return {
      success: true,
      data: {
        vite_amap_web_key: settings.vite_amap_web_key,
        vite_amap_web_js_key: settings.vite_amap_web_js_key,
        google_maps_api_key: settings.google_maps_api_key,
        google_maps_proxy: settings.google_maps_proxy,
      },
    };
  });

if (import.meta.main) {
  const settings = getSettings();
  const warnings = validateConfig();
  if (warnings.length > 0) {
    console.log("\n⚠️  配置警告:");
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }
  app.listen({ hostname: settings.host, port: settings.port });
  console.log(
    `${settings.app_name} v${settings.app_version} 已启动: http://${settings.host}:${settings.port}`,
  );
}
