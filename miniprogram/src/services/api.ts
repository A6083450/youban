import { API_BASE_URL } from "../config";
import { authStore } from "./auth-store";
import { copyFor } from "./i18n";

const copy = () => copyFor(typeof wx === "undefined" ? "zh-CN" : wx.getStorageSync("youban.locale"));

interface RequestOptions {
  method?: string;
  data?: unknown;
  public?: boolean;
  retry401?: boolean;
}

function detail(data: any, fallback: string): string {
  return typeof data?.detail === "string" ? data.detail : fallback;
}

export class LoginRequiredError extends Error {}

export function requireAuthenticated(): void {
  if (authStore.isReady()) return;
  wx.reLaunch({ url: "/pages/login/index" });
  throw new LoginRequiredError(copy().common.loginExpired);
}

function expireSession(): never {
  authStore.clear();
  wx.reLaunch({ url: "/pages/login/index" });
  throw new LoginRequiredError(copy().common.loginExpired);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!options.public) requireAuthenticated();
  const send = () => new Promise<any>((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: options.public ? {} : { Authorization: `Bearer ${authStore.token}` },
      success: resolve,
      fail: () => reject(new Error(copy().common.networkUnavailable)),
    });
  });
  const response = await send();
  if (response.statusCode === 401 && !options.public) expireSession();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(detail(response.data, `请求失败（${response.statusCode}）`));
  }
  return response.data as T;
}
