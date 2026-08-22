import { join } from "node:path";
import { getDataDir, getRepoRoot } from "./config/paths.ts";
import { getSettings, validateConfig } from "./config/settings.ts";
import { createHttpRuntime } from "./http/app.ts";
import {
  installMemoryPressureHandler,
  listenProductionHttpServer,
  shutdownServer,
} from "./runtime/server-lifecycle.ts";

export const runtime = createHttpRuntime({
  dataDir: getDataDir(),
  frontendDist: join(getRepoRoot(), "frontend", "dist"),
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
