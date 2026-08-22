import { join } from "node:path";
import { getDataDir, getRepoRoot } from "./config/paths.ts";
import { getSettings, validateConfig } from "./config/settings.ts";
import { createHttpRuntime } from "./http/app.ts";

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
  const server = app.listen({ hostname: settings.host, port: settings.port });
  console.log(
    `${settings.app_name} v${settings.app_version} 已启动: http://${settings.host}:${settings.port}`,
  );
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`收到 ${signal}，正在关闭服务...`);
    server.stop(false);
    await runtime.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
