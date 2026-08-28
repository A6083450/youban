import { API_BASE_URL } from "../config";
import { copyFor } from "./i18n";

const TOKEN_KEY = "youban.auth_token";
const USER_KEY = "youban.user";
const avatarDisplayCache = new Map<string, Promise<string>>();

export interface MiniUser {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  profile_complete: boolean;
}

export function resolveAvatarUrl(value: string | null | undefined): string {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/^https?:\/\//i.test(source)) return source;
  return `${API_BASE_URL}${source.startsWith("/") ? source : `/${source}`}`;
}

export function resolveAvatarDisplayUrl(value: string | null | undefined): Promise<string> {
  const source = resolveAvatarUrl(value);
  if (!source || !/^http:\/\//i.test(source)) return Promise.resolve(source);

  const cached = avatarDisplayCache.get(source);
  if (cached) return cached;

  const request = new Promise<string>((resolve) => {
    wx.downloadFile({
      url: source,
      header: authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {},
      success: (response: { statusCode?: number; tempFilePath?: string }) => {
        const statusCode = Number(response.statusCode || 0);
        resolve(statusCode >= 200 && statusCode < 300 ? String(response.tempFilePath || "") : "");
      },
      fail: () => resolve(""),
    });
  }).then((displayUrl) => {
    if (!displayUrl) avatarDisplayCache.delete(source);
    return displayUrl;
  });
  avatarDisplayCache.set(source, request);
  return request;
}

type AuthListener = (authenticated: boolean) => void;

interface WechatSession {
  token: string;
  user: MiniUser;
}

class AuthStore {
  token = "";
  user: MiniUser | null = null;
  private loginPromise: Promise<MiniUser> | null = null;
  private listeners = new Set<AuthListener>();

  restore(): void {
    this.token = wx.getStorageSync(TOKEN_KEY) || "";
    this.user = wx.getStorageSync(USER_KEY) || null;
    if (!this.isReady()) {
      this.token = "";
      this.user = null;
      wx.removeStorageSync(TOKEN_KEY);
      wx.removeStorageSync(USER_KEY);
    }
    this.emit();
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isReady(): boolean {
    return Boolean(this.token && this.user?.profile_complete && this.user.avatar_url);
  }

  async loginWithAvatar(filePath: string): Promise<MiniUser> {
    const copy = copyFor(wx.getStorageSync("youban.locale"));
    if (!filePath.trim()) throw new Error(copy.profile.failed);
    if (this.loginPromise) return this.loginPromise;
    this.clear();
    this.loginPromise = (async () => {
      const session = await this.createWechatSession();
      this.token = session.token;
      this.user = session.user;
      try {
        const user = await this.uploadAvatarWithToken(filePath, session.token);
        if (!user.profile_complete || !user.avatar_url) throw new Error(copy.profile.failed);
        this.user = user;
        wx.setStorageSync(TOKEN_KEY, session.token);
        wx.setStorageSync(USER_KEY, user);
        this.emit();
        return user;
      } catch (error) {
        await this.revokePendingSession(session.token);
        this.clear();
        throw error;
      }
    })().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  updateUser(user: MiniUser): MiniUser {
    this.user = user;
    wx.setStorageSync(USER_KEY, user);
    this.emit();
    return user;
  }

  avatarUrl(): Promise<string> {
    return resolveAvatarDisplayUrl(this.user?.avatar_url);
  }

  async uploadAvatar(filePath: string): Promise<MiniUser> {
    if (!this.isReady()) throw new Error(copyFor(wx.getStorageSync("youban.locale")).common.loginExpired);
    const user = await this.uploadAvatarWithToken(filePath, this.token);
    return this.updateUser(user);
  }

  private createWechatSession(): Promise<WechatSession> {
    const copy = copyFor(wx.getStorageSync("youban.locale"));
    return new Promise<WechatSession>((resolve, reject) => {
      wx.login({
        success: (loginResult: { code?: string }) => {
          if (!loginResult.code) return reject(new Error(copy.common.loginFailed));
          wx.request({
            url: `${API_BASE_URL}/api/auth/wechat/login`,
            method: "POST",
            data: { code: loginResult.code },
            success: (response: any) => {
              if (response.statusCode !== 200 || !response.data?.token || !response.data?.user) {
                return reject(new Error(response.data?.detail || copy.common.loginFailed));
              }
              resolve({ token: response.data.token, user: response.data.user as MiniUser });
            },
            fail: () => reject(new Error(copy.common.networkUnavailable)),
          });
        },
        fail: () => reject(new Error(copy.common.loginFailed)),
      });
    });
  }

  private uploadAvatarWithToken(filePath: string, token: string): Promise<MiniUser> {
    const copy = copyFor(wx.getStorageSync("youban.locale"));
    return new Promise<any>((resolve, reject) => {
      wx.uploadFile({
        url: `${API_BASE_URL}/api/account/profile/avatar`,
        filePath,
        name: "avatar",
        header: { Authorization: `Bearer ${token}` },
        success: (response: any) => {
          let payload: any = {};
          try { payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data; } catch { /* invalid server response */ }
          if (response.statusCode < 200 || response.statusCode >= 300 || !payload?.user) {
            reject(new Error(payload?.detail || copy.common.requestFailed));
            return;
          }
          resolve(payload.user as MiniUser);
        },
        fail: () => reject(new Error(copy.common.networkUnavailable)),
      });
    });
  }

  private revokePendingSession(token: string): Promise<void> {
    return new Promise((resolve) => {
      wx.request({
        url: `${API_BASE_URL}/api/auth/logout`,
        method: "POST",
        header: { Authorization: `Bearer ${token}` },
        complete: () => resolve(),
        success: () => resolve(),
        fail: () => resolve(),
      });
    });
  }

  clear(): void {
    this.token = "";
    this.user = null;
    avatarDisplayCache.clear();
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(USER_KEY);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.isReady());
  }
}

export const authStore = new AuthStore();
