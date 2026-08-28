type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface WechatCodeExchangeOptions {
  appId: string;
  appSecret: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class WechatCodeExchangeError extends Error {}

export class WechatCodeExchange {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: WechatCodeExchangeOptions) {
    if (!options.appId.trim() || !options.appSecret.trim()) {
      throw new Error("WeChat AppID and AppSecret are required");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async exchange(code: string): Promise<string> {
    if (!code.trim()) throw new WechatCodeExchangeError("微信登录凭证无效");
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.options.appId);
    url.searchParams.set("secret", this.options.appSecret);
    url.searchParams.set("js_code", code.trim());
    url.searchParams.set("grant_type", "authorization_code");
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new WechatCodeExchangeError("微信登录服务暂不可用");
      const payload = await response.json() as { openid?: unknown; errcode?: unknown };
      if (typeof payload.openid !== "string" || !payload.openid.trim() || payload.errcode) {
        throw new WechatCodeExchangeError("微信登录凭证无效");
      }
      return payload.openid.trim();
    } catch (error) {
      if (error instanceof WechatCodeExchangeError) throw error;
      throw new WechatCodeExchangeError("微信登录服务暂不可用");
    }
  }
}
