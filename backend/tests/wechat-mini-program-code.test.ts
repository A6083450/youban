import { describe, expect, it } from "bun:test";
import {
  WechatMiniProgramCode,
  WechatMiniProgramCodeError,
} from "../src/services/wechat-mini-program-code.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("WechatMiniProgramCode", () => {
  it("reuses one access token and sends exact unlimited-code parameters", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const provider = new WechatMiniProgramCode({
      appId: "wx-mini",
      appSecret: "server-secret",
      envVersion: "trial",
      checkPath: false,
      fetch: async (input, init) => {
        requests.push({ url: String(input), body: String(init?.body ?? "") });
        if (requests.length === 1) {
          return Response.json({ access_token: "access-token", expires_in: 7_200 });
        }
        return new Response(PNG, { headers: { "content-type": "image/png" } });
      },
    });

    expect(await provider.createDataUrl("a".repeat(32))).toMatch(/^data:image\/png;base64,/);
    expect(await provider.createDataUrl("b".repeat(32))).toMatch(/^data:image\/png;base64,/);
    expect(requests.filter(({ url }) => url.includes("/cgi-bin/token"))).toHaveLength(1);
    expect(JSON.parse(requests[1]!.body)).toEqual({
      scene: "a".repeat(32),
      page: "pages/web-login/index",
      check_path: false,
      env_version: "trial",
      width: 320,
    });
  });

  it("refreshes the cached token before its safety margin", async () => {
    let now = 0;
    let tokenRequests = 0;
    const provider = new WechatMiniProgramCode({
      appId: "wx-mini",
      appSecret: "server-secret",
      now: () => now,
      fetch: async (input) => {
        if (String(input).includes("/cgi-bin/token")) {
          tokenRequests += 1;
          return Response.json({ access_token: `token-${tokenRequests}`, expires_in: 120 });
        }
        return new Response(PNG, { headers: { "content-type": "image/png" } });
      },
    });

    await provider.createDataUrl("a".repeat(32));
    now = 59_999;
    await provider.createDataUrl("b".repeat(32));
    now = 60_000;
    await provider.createDataUrl("c".repeat(32));

    expect(tokenRequests).toBe(2);
  });

  it("accepts a matching JPEG response", async () => {
    let calls = 0;
    const provider = new WechatMiniProgramCode({
      appId: "wx-mini",
      appSecret: "server-secret",
      fetch: async () => {
        calls += 1;
        if (calls === 1) return Response.json({ access_token: "token", expires_in: 7_200 });
        return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { "content-type": "image/jpeg" },
        });
      },
    });

    expect(await provider.createDataUrl("a".repeat(32))).toBe("data:image/jpeg;base64,/9j/2Q==");
  });

  it("rejects invalid scenes before making a request", async () => {
    let calls = 0;
    const provider = new WechatMiniProgramCode({
      appId: "wx-mini",
      appSecret: "server-secret",
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });

    await expect(provider.createDataUrl("含中文")).rejects.toThrow("微信扫码登录暂不可用");
    expect(calls).toBe(0);
  });

  it("rejects mismatched and oversized image responses", async () => {
    const responses = [
      new Response("not-png", { headers: { "content-type": "image/png" } }),
      new Response(PNG, { headers: { "content-type": "image/png", "content-length": "1048577" } }),
    ];
    let index = 0;
    const provider = new WechatMiniProgramCode({
      appId: "wx-mini",
      appSecret: "server-secret",
      fetch: async (input) => String(input).includes("/cgi-bin/token")
        ? Response.json({ access_token: "token", expires_in: 7_200 })
        : responses[index++]!,
    });

    await expect(provider.createDataUrl("a".repeat(32))).rejects.toBeInstanceOf(WechatMiniProgramCodeError);
    await expect(provider.createDataUrl("b".repeat(32))).rejects.toBeInstanceOf(WechatMiniProgramCodeError);
  });

  it("maps provider failures without leaking credentials or scene values", async () => {
    const provider = new WechatMiniProgramCode({
      appId: "wx-mini",
      appSecret: "do-not-leak",
      fetch: async () => Response.json({ errcode: 40125, errmsg: "invalid appsecret do-not-leak" }),
    });
    const scene = "f".repeat(32);

    try {
      await provider.createDataUrl(scene);
      throw new Error("expected provider failure");
    }
    catch (error) {
      expect(error).toBeInstanceOf(WechatMiniProgramCodeError);
      expect(String(error)).not.toContain("do-not-leak");
      expect(String(error)).not.toContain(scene);
    }
  });
});
