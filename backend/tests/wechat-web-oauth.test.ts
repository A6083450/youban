import { describe, expect, it } from "bun:test";
import {
  WechatWebOAuth,
  WechatWebOAuthError,
} from "../src/services/wechat-web-oauth.ts";

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error;
  }
}

describe("WechatWebOAuth", () => {
  it("exchanges a website code for a verified UnionID profile", async () => {
    const requested: URL[] = [];
    const oauth = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async (input) => {
        const url = new URL(String(input));
        requested.push(url);
        if (requested.length === 1) {
          return Response.json({
            access_token: "provider-token",
            openid: "web-openid",
            unionid: "shared-unionid",
          });
        }
        return Response.json({
          openid: "web-openid",
          unionid: "shared-unionid",
          nickname: "旅行者",
          headimgurl: "https://thirdwx.qlogo.cn/avatar.jpg",
        });
      },
    });

    expect(await oauth.exchange("temporary-code")).toEqual({
      openid: "web-openid",
      unionid: "shared-unionid",
      nickname: "旅行者",
      avatarUrl: "https://thirdwx.qlogo.cn/avatar.jpg",
    });
    expect(requested[0]?.origin + requested[0]?.pathname).toBe(
      "https://api.weixin.qq.com/sns/oauth2/access_token",
    );
    expect(requested[0]?.searchParams.get("code")).toBe("temporary-code");
    expect(requested[1]?.origin + requested[1]?.pathname).toBe(
      "https://api.weixin.qq.com/sns/userinfo",
    );
    expect(requested[1]?.searchParams.get("access_token")).toBe("provider-token");
  });

  it("rejects a profile whose openid does not match the token response", async () => {
    let calls = 0;
    const oauth = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ access_token: "provider-token", openid: "token-openid" })
          : Response.json({
              openid: "different-openid",
              unionid: "shared-unionid",
              nickname: "旅行者",
            });
      },
    });

    const error = await captureError(() => oauth.exchange("temporary-code"));
    expect(error).toBeInstanceOf(WechatWebOAuthError);
    expect((error as WechatWebOAuthError).kind).toBe("identity");
  });

  it("rejects a profile without UnionID as an identity failure", async () => {
    let calls = 0;
    const oauth = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ access_token: "provider-token", openid: "web-openid" })
          : Response.json({ openid: "web-openid", nickname: "旅行者" });
      },
    });

    const error = await captureError(() => oauth.exchange("temporary-code"));
    expect(error).toBeInstanceOf(WechatWebOAuthError);
    expect((error as WechatWebOAuthError).kind).toBe("identity");
  });

  it("rejects conflicting token and profile UnionIDs", async () => {
    let calls = 0;
    const oauth = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({
              access_token: "provider-token",
              openid: "web-openid",
              unionid: "token-unionid",
            })
          : Response.json({
              openid: "web-openid",
              unionid: "profile-unionid",
              nickname: "旅行者",
            });
      },
    });

    const error = await captureError(() => oauth.exchange("temporary-code"));
    expect(error).toBeInstanceOf(WechatWebOAuthError);
    expect((error as WechatWebOAuthError).kind).toBe("identity");
  });

  it("bounds authorized nicknames by Unicode code points", async () => {
    let calls = 0;
    const oauth = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ access_token: "provider-token", openid: "web-openid" })
          : Response.json({
              openid: "web-openid",
              unionid: "shared-unionid",
              nickname: `  ${"旅".repeat(63)}🧳extra  `,
            });
      },
    });

    const profile = await oauth.exchange("temporary-code");
    expect(Array.from(profile.nickname)).toHaveLength(64);
    expect(profile.nickname.endsWith("🧳")).toBe(true);
  });

  it("maps provider and transport failures without leaking secrets", async () => {
    const provider = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async () => Response.json({ errcode: 40029, errmsg: "temporary-code rejected" }),
    });
    const transport = new WechatWebOAuth({
      appId: "wx-web-app",
      appSecret: "web-secret",
      fetch: async () => {
        throw new Error("web-secret temporary-code provider-token");
      },
    });

    for (const oauth of [provider, transport]) {
      const error = await captureError(() => oauth.exchange("temporary-code"));
      expect(error).toBeInstanceOf(WechatWebOAuthError);
      expect((error as WechatWebOAuthError).kind).toBe("provider");
      expect(String(error)).not.toContain("web-secret");
      expect(String(error)).not.toContain("temporary-code");
      expect(String(error)).not.toContain("provider-token");
    }
  });
});
