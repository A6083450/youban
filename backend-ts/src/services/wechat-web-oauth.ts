type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ProviderPayload = Record<string, unknown>;

function payloadRecord(value: unknown): ProviderPayload | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ProviderPayload
    : null;
}

function payloadString(payload: ProviderPayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasProviderError(payload: ProviderPayload): boolean {
  return "errcode" in payload && Number(payload.errcode) !== 0;
}

function boundedNickname(value: string): string {
  return Array.from(value.normalize("NFKC").trim()).slice(0, 64).join("");
}

export interface WechatWebsiteProfile {
  openid: string;
  unionid: string;
  nickname: string;
  avatarUrl: string;
}

export interface WechatWebOAuthOptions {
  appId: string;
  appSecret: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class WechatWebOAuthError extends Error {
  constructor(
    message: string,
    readonly kind: "provider" | "identity" = "provider",
  ) {
    super(message);
  }
}

export class WechatWebOAuth {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: WechatWebOAuthOptions) {
    if (!options.appId.trim() || !options.appSecret.trim()) {
      throw new WechatWebOAuthError("微信扫码登录尚未配置");
    }
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async exchange(code: string): Promise<WechatWebsiteProfile> {
    const normalizedCode = code.trim();
    if (!normalizedCode) throw new WechatWebOAuthError("微信登录凭证无效");
    try {
      const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
      tokenUrl.searchParams.set("appid", this.options.appId.trim());
      tokenUrl.searchParams.set("secret", this.options.appSecret.trim());
      tokenUrl.searchParams.set("code", normalizedCode);
      tokenUrl.searchParams.set("grant_type", "authorization_code");
      const tokenResponse = await this.fetch(tokenUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!tokenResponse.ok) throw new WechatWebOAuthError("微信登录服务暂不可用");
      const token = payloadRecord(await tokenResponse.json());
      if (!token || hasProviderError(token)) {
        throw new WechatWebOAuthError("微信登录服务暂不可用");
      }
      const accessToken = payloadString(token, "access_token");
      const tokenOpenid = payloadString(token, "openid");
      const tokenUnionid = payloadString(token, "unionid");
      if (!accessToken || !tokenOpenid) {
        throw new WechatWebOAuthError("微信登录服务暂不可用");
      }

      const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
      profileUrl.searchParams.set("access_token", accessToken);
      profileUrl.searchParams.set("openid", tokenOpenid);
      profileUrl.searchParams.set("lang", "zh_CN");
      const profileResponse = await this.fetch(profileUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!profileResponse.ok) throw new WechatWebOAuthError("微信登录服务暂不可用");
      const profile = payloadRecord(await profileResponse.json());
      if (!profile || hasProviderError(profile)) {
        throw new WechatWebOAuthError("微信登录服务暂不可用");
      }
      const profileOpenid = payloadString(profile, "openid");
      const profileUnionid = payloadString(profile, "unionid");
      if (!profileOpenid || profileOpenid !== tokenOpenid) {
        throw new WechatWebOAuthError("无法确认微信账号", "identity");
      }
      if (tokenUnionid && profileUnionid && tokenUnionid !== profileUnionid) {
        throw new WechatWebOAuthError("无法确认微信账号", "identity");
      }
      const unionid = profileUnionid || tokenUnionid;
      if (!unionid) throw new WechatWebOAuthError("无法确认微信账号", "identity");

      return {
        openid: profileOpenid,
        unionid,
        nickname: boundedNickname(payloadString(profile, "nickname")),
        avatarUrl: payloadString(profile, "headimgurl"),
      };
    } catch (error) {
      if (error instanceof WechatWebOAuthError) throw error;
      throw new WechatWebOAuthError("微信登录服务暂不可用");
    }
  }
}
