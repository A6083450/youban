import { authStore } from "../../services/auth-store";
import { copyFor } from "../../services/i18n";

const copy = () => copyFor(wx.getSystemInfoSync().language);

Page({
  data: {
    busy: false,
    previewUrl: "",
    copy: copy(),
  },

  onShow() {
    this.setData({ copy: copy() });
    if (authStore.isReady()) wx.reLaunch({ url: "/pages/web/index" });
  },

  async chooseAvatar(event: { detail?: { avatarUrl?: string } }) {
    const filePath = String(event.detail?.avatarUrl || "").trim();
    if (!filePath || this.data.busy) return;
    this.setData({ busy: true, previewUrl: filePath });
    wx.showLoading({ title: this.data.copy.login.connecting, mask: true });
    try {
      await authStore.loginWithAvatar(filePath);
      wx.hideLoading();
      wx.reLaunch({ url: "/pages/web/index" });
    } catch (error) {
      wx.hideLoading();
      this.setData({ busy: false, previewUrl: "" });
      wx.showToast({
        title: error instanceof Error ? error.message : this.data.copy.common.loginFailed,
        icon: "none",
      });
    }
  },

  openPrivacy() {
    wx.navigateTo({ url: "/pages/web/index?path=%2Fprivacy" });
  },
});
