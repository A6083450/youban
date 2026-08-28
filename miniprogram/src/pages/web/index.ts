import { API_BASE_URL } from "../../config";
import { apiRequest } from "../../services/api";
import { authStore } from "../../services/auth-store";
import {
  applyNavigationBarColor,
  NAVIGATION_COLOR_STORAGE_KEY,
  resolveWebViewLaunch,
  shouldRefreshWebViewOnShow,
  type WebViewLaunchOptions,
} from "../../services/webview-route";

interface MiniWebSessionTicket {
  exchange_url: string;
  expires_at: string;
}

Page({
  data: {
    src: "",
    error: "",
    launchOptions: {} as WebViewLaunchOptions,
    hasShown: false,
  },

  onLoad(options: WebViewLaunchOptions) {
    const launchColor = options.nav_color ? `#${options.nav_color}` : "";
    applyNavigationBarColor(launchColor || wx.getStorageSync(NAVIGATION_COLOR_STORAGE_KEY), wx);
    this.setData({ launchOptions: options || {} });
    void this.open();
  },

  onShow() {
    const refresh = shouldRefreshWebViewOnShow(this.data.hasShown);
    this.setData({ hasShown: true });
    if (refresh) void this.open();
  },

  async open() {
    const launch = resolveWebViewLaunch(this.data.launchOptions);
    this.setData({ src: "", error: "" });
    if (launch.public) {
      const path = encodeURIComponent(launch.path);
      this.setData({ src: `${API_BASE_URL}/api/auth/miniprogram/web-session/public?path=${path}` });
      return;
    }
    if (!authStore.isReady()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    try {
      const ticket = await apiRequest<MiniWebSessionTicket>("/api/auth/miniprogram/web-session", {
        method: "POST",
        data: { path: launch.path },
      });
      this.setData({ src: `${API_BASE_URL}${ticket.exchange_url}` });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : "网络连接失败" });
    }
  },

  retry() {
    void this.open();
  },

  onWebViewLoad() {
    this.setData({ error: "" });
  },

  onWebViewError(event: { detail?: { errMsg?: string } }) {
    this.setData({ src: "", error: event.detail?.errMsg || "网页加载失败" });
  },
});
