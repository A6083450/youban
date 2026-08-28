const LOCAL_DEVELOPMENT_BASE_URL = "http://127.0.0.1:7860";
const PRODUCTION_BASE_URL = "https://youban.me";

export function resolveRuntimeBaseUrl(envVersion?: string): string {
  return envVersion === "develop" ? LOCAL_DEVELOPMENT_BASE_URL : PRODUCTION_BASE_URL;
}

function currentEnvVersion(): string | undefined {
  if (typeof wx === "undefined" || typeof wx.getAccountInfoSync !== "function") return undefined;
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return undefined;
  }
}

export const WEB_BASE_URL = resolveRuntimeBaseUrl(currentEnvVersion());
export const API_BASE_URL = WEB_BASE_URL;
