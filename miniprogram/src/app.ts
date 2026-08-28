import { authStore } from "./services/auth-store";
import { isPublicWebViewLaunch } from "./services/webview-route";

App({
  onLaunch() {
    authStore.restore();
  },
  onShow() {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    if (!current || current.route === "pages/login/index") return;
    if (current.route === "pages/web/index" && isPublicWebViewLaunch(current.options || {})) return;
    if (!authStore.isReady()) wx.reLaunch({ url: "/pages/login/index" });
  },
});
