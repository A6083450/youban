import { describe, expect, it } from "bun:test";
import { WechatCodeExchange, WechatCodeExchangeError } from "../src/services/wechat-code-exchange.ts";

describe("WechatCodeExchange", () => {
  it("exchanges a code for openid and UnionID without returning session_key", async () => {
    let requested = "";
    const exchange = new WechatCodeExchange({
      appId: "wx42ddc076b365bf0d",
      appSecret: "secret-value",
      fetch: async (input) => {
        requested = String(input);
        return Response.json({
          openid: "openid-1",
          unionid: "unionid-1",
          session_key: "session-secret",
        });
      },
    });
    const identity = await exchange.exchange("temporary-code");
    expect(identity).toEqual({ openid: "openid-1", unionid: "unionid-1" });
    expect(JSON.stringify(identity)).not.toContain("session-secret");
    expect(requested).toContain("appid=wx42ddc076b365bf0d");
    expect(requested).toContain("js_code=temporary-code");
  });

  it("rejects a production identity without UnionID", async () => {
    const exchange = new WechatCodeExchange({
      appId: "wx42ddc076b365bf0d",
      appSecret: "secret-value",
      fetch: async () => Response.json({ openid: "openid-1" }),
    });

    await expect(exchange.exchange("temporary-code")).rejects.toThrow(
      new WechatCodeExchangeError("微信账号统一标识不可用"),
    );
  });

  it("maps WeChat errors to a stable error without leaking credentials", async () => {
    const exchange = new WechatCodeExchange({
      appId: "wx42ddc076b365bf0d",
      appSecret: "do-not-leak",
      fetch: async () => Response.json({ errcode: 40029, errmsg: "invalid code" }),
    });
    try {
      await exchange.exchange("bad-code");
      throw new Error("expected exchange to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WechatCodeExchangeError);
      expect(String(error)).not.toContain("do-not-leak");
      expect(String(error)).not.toContain("bad-code");
    }
  });
});
