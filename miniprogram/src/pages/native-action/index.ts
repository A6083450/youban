import { API_BASE_URL } from "../../config";
import { apiRequest } from "../../services/api";
import { authStore } from "../../services/auth-store";

type NativeActionType = "share" | "save_guide" | "add_calendar" | "avatar" | "logout";

interface CalendarEvent {
  title: string;
  startTime: number;
  endTime: number;
  allDay: boolean;
  description: string;
  location: string;
  alarm: boolean;
  alarmOffset: number;
}

interface NativeAction {
  type: NativeActionType;
  payload: {
    title?: string;
    path?: string;
    download_url?: string;
    events?: CalendarEvent[];
  };
  expires_at: string;
}

function wxCall(invoke: (callbacks: { success: () => void; fail: (error: any) => void }) => void): Promise<void> {
  return new Promise((resolve, reject) => invoke({ success: resolve, fail: reject }));
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "errMsg" in error) return String(error.errMsg || fallback);
  return fallback;
}

Page({
  data: {
    actionId: "",
    type: "" as NativeActionType | "",
    title: "正在准备...",
    payload: {} as NativeAction["payload"],
    ready: false,
    busy: false,
    error: "",
    permissionError: false,
  },

  onLoad(options: { action_id?: string; mode?: string }) {
    if (options.mode === "avatar" || options.mode === "logout") {
      this.setData({
        type: options.mode,
        title: options.mode === "avatar" ? "更换微信头像" : "退出游伴",
        ready: true,
      });
      return;
    }
    this.setData({ actionId: String(options.action_id || "").trim() });
    void this.loadAction();
  },

  async loadAction() {
    if (!this.data.actionId) {
      this.setData({ error: "动作票据无效" });
      return;
    }
    this.setData({ busy: true, error: "", permissionError: false });
    try {
      const action = await apiRequest<NativeAction>(`/api/miniprogram/actions/${encodeURIComponent(this.data.actionId)}`);
      this.setData({
        type: action.type,
        title: action.payload.title || "游伴",
        payload: action.payload,
        ready: true,
      });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : "动作加载失败" });
    } finally {
      this.setData({ busy: false });
    }
  },

  retry() {
    void this.loadAction();
  },

  async complete() {
    await apiRequest(`/api/miniprogram/actions/${encodeURIComponent(this.data.actionId)}/complete`, {
      method: "POST",
      data: {},
    });
  },

  finish() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: "/pages/web/index" }),
    });
  },

  async saveGuide() {
    const url = String(this.data.payload.download_url || "");
    if (!url || this.data.busy) return;
    this.setData({ busy: true, error: "", permissionError: false });
    try {
      const downloaded = await new Promise<any>((resolve, reject) => wx.downloadFile({
        url: `${API_BASE_URL}${url}`,
        header: { Authorization: `Bearer ${authStore.token}` },
        success: (response: any) => response.statusCode === 200 ? resolve(response) : reject(new Error("攻略下载失败")),
        fail: reject,
      }));
      await wxCall((callbacks) => wx.saveImageToPhotosAlbum({ filePath: downloaded.tempFilePath, ...callbacks }));
      await this.complete();
      wx.showToast({ title: "已保存到相册", icon: "success" });
      this.finish();
    } catch (error) {
      const message = actionErrorMessage(error, "保存失败");
      this.setData({ error: message, permissionError: /auth deny|authorize|permission/i.test(message) });
    } finally {
      this.setData({ busy: false });
    }
  },

  async addCalendar() {
    const events = this.data.payload.events || [];
    if (events.length === 0 || this.data.busy) return;
    this.setData({ busy: true, error: "", permissionError: false });
    try {
      for (const event of events) {
        await wxCall((callbacks) => wx.addPhoneCalendar({ ...event, ...callbacks }));
      }
      await this.complete();
      wx.showToast({ title: "已加入日历", icon: "success" });
      this.finish();
    } catch (error) {
      const message = actionErrorMessage(error, "日历写入失败");
      this.setData({ error: message, permissionError: /auth deny|authorize|permission/i.test(message) });
    } finally {
      this.setData({ busy: false });
    }
  },

  openSettings() {
    wx.openSetting({ success: () => this.setData({ permissionError: false, error: "" }) });
  },

  async chooseAvatar(event: { detail?: { avatarUrl?: string } }) {
    const filePath = String(event.detail?.avatarUrl || "").trim();
    if (!filePath || this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      await authStore.uploadAvatar(filePath);
      wx.showToast({ title: "头像已更新", icon: "success" });
      this.finish();
    } catch (error) {
      this.setData({ error: actionErrorMessage(error, "头像更新失败") });
    } finally {
      this.setData({ busy: false });
    }
  },

  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      await apiRequest("/api/auth/logout", { method: "POST", data: {} });
    } catch {
      // Local session cleanup still guarantees the next launch requires WeChat login.
    } finally {
      authStore.clear();
      wx.reLaunch({ url: "/pages/login/index" });
    }
  },

  onShareAppMessage() {
    void this.complete();
    return {
      title: this.data.payload.title || "游伴行程",
      path: this.data.payload.path || "/pages/web/index",
    };
  },
});
