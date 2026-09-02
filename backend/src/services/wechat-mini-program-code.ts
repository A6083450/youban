type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type WechatMiniProgramCodeOptions = {
  appId: string;
  appSecret: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  envVersion?: "release" | "trial" | "develop";
  checkPath?: boolean;
};

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const CODE_URL = "https://api.weixin.qq.com/wxa/getwxacodeunlimit";
const WEB_LOGIN_PAGE = "pages/web-login/index";
const MAX_IMAGE_BYTES = 1024 * 1024;
const TOKEN_SAFETY_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export class WechatMiniProgramCodeError extends Error {}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new WechatMiniProgramCodeError("微信扫码登录暂不可用");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new WechatMiniProgramCodeError("微信扫码登录暂不可用");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class WechatMiniProgramCode {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private accessToken = "";
  private accessTokenExpiresAt = 0;

  constructor(private readonly options: WechatMiniProgramCodeOptions) {
    if (!options.appId.trim() || !options.appSecret.trim()) {
      throw new Error("WeChat AppID and AppSecret are required");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createDataUrl(scene: string): Promise<string> {
    if (!/^[0-9a-f]{32}$/.test(scene)) throw this.failure();
    try {
      const token = await this.getAccessToken();
      const url = new URL(CODE_URL);
      url.searchParams.set("access_token", token);
      const response = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scene,
          page: WEB_LOGIN_PAGE,
          check_path: this.options.checkPath ?? true,
          env_version: this.options.envVersion ?? "release",
          width: 320,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw this.failure();
      const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const bytes = await readBounded(response);
      if (mime === "image/png" && isPng(bytes)) return this.dataUrl(mime, bytes);
      if (mime === "image/jpeg" && isJpeg(bytes)) return this.dataUrl(mime, bytes);
      throw this.failure();
    }
    catch (error) {
      if (error instanceof WechatMiniProgramCodeError) throw error;
      throw this.failure();
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.accessTokenExpiresAt) return this.accessToken;
    const url = new URL(TOKEN_URL);
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", this.options.appId);
    url.searchParams.set("secret", this.options.appSecret);
    const response = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw this.failure();
    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown; errcode?: unknown };
    if (payload.errcode || typeof payload.access_token !== "string" || !payload.access_token.trim()) {
      throw this.failure();
    }
    const expiresIn = Number(payload.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw this.failure();
    this.accessToken = payload.access_token.trim();
    this.accessTokenExpiresAt = this.now() + Math.max(0, expiresIn * 1_000 - TOKEN_SAFETY_MS);
    return this.accessToken;
  }

  private dataUrl(mime: string, bytes: Uint8Array): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  }

  private failure(): WechatMiniProgramCodeError {
    return new WechatMiniProgramCodeError("微信扫码登录暂不可用");
  }
}
