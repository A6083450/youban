import { describe, expect, it } from "bun:test";
import {
  MiniProgramBridgeError,
  MiniProgramBridgeService,
  normalizeMiniProgramRedirectPath,
} from "../src/domain/miniprogram-bridge.ts";

function fixture() {
  let now = Date.parse("2026-08-27T00:00:00.000Z");
  let byte = 0;
  const removed: string[] = [];
  const bridge = new MiniProgramBridgeService({
    now: () => now,
    randomBytes: (length) => Buffer.alloc(length, ++byte),
    removeTemporaryFile: (path) => removed.push(path),
  });
  return {
    bridge,
    removed,
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

describe("mini-program bridge", () => {
  it("accepts only private and public Web routes used by the mini-program shell", () => {
    expect(normalizeMiniProgramRedirectPath("/")).toBe("/?host=miniprogram");
    expect(normalizeMiniProgramRedirectPath("/plan/plan-123?section=weather"))
      .toBe("/plan/plan-123?host=miniprogram&section=weather");
    expect(normalizeMiniProgramRedirectPath("/plan/plan-123?section=weather&mini_nav=eef7f9"))
      .toBe("/plan/plan-123?host=miniprogram&section=weather&mini_nav=eef7f9");
    expect(normalizeMiniProgramRedirectPath("/?conversation=session-123&mini_nav=fffaf6"))
      .toBe("/?host=miniprogram&conversation=session-123&mini_nav=fffaf6");
    expect(normalizeMiniProgramRedirectPath("/plan/plan-123?section=days"))
      .toBe("/plan/plan-123?host=miniprogram&section=days");
    expect(normalizeMiniProgramRedirectPath("/share/0123456789abcdef0123456789abcdef"))
      .toBe("/share/0123456789abcdef0123456789abcdef?host=miniprogram");
    expect(normalizeMiniProgramRedirectPath("/privacy")).toBe("/privacy?host=miniprogram");

    for (const path of [
      "https://evil.example/",
      "//evil.example/",
      "/admin",
      "/login",
      "/plan/../admin",
      "/plan/id?next=https://evil.example",
      "/?conversation=bad/id",
      "/?mini_nav=transparent",
      "/plan/id#ticket=secret",
    ]) {
      expect(() => normalizeMiniProgramRedirectPath(path)).toThrow(MiniProgramBridgeError);
    }
  });

  it("stores only a hash and consumes a 60-second Web session ticket once", () => {
    const { bridge, advance } = fixture();
    const created = bridge.createWebSession("user-1", "/plan/plan-1");

    expect(created.ticket).toHaveLength(43);
    expect(bridge.debugStoredTicketMaterial()).not.toContain(created.ticket);
    expect(bridge.consumeWebSession(created.ticket)).toEqual({
      user_id: "user-1",
      redirect_path: "/plan/plan-1?host=miniprogram",
    });
    expect(() => bridge.consumeWebSession(created.ticket)).toThrow("票据无效或已兑换");

    const expired = bridge.createWebSession("user-1", "/");
    advance(60_001);
    expect(() => bridge.consumeWebSession(expired.ticket)).toThrow("票据已过期");
  });

  it("binds five-minute native actions to their owner and cleans temporary files", () => {
    const { bridge, removed, advance } = fixture();
    const created = bridge.createAction("user-1", "save_guide", {
      title: "新疆攻略",
      download_url: "/api/miniprogram/actions/file-1/image",
    }, "/tmp/guide-file-1.png");

    expect(bridge.debugStoredTicketMaterial()).not.toContain(created.action_id);
    expect(() => bridge.getAction(created.action_id, "user-2")).toThrow("动作票据无权访问");
    expect(bridge.getAction(created.action_id, "user-1")).toMatchObject({
      type: "save_guide",
      payload: { title: "新疆攻略" },
    });
    bridge.completeAction(created.action_id, "user-1");
    expect(removed).toEqual(["/tmp/guide-file-1.png"]);
    expect(() => bridge.getAction(created.action_id, "user-1")).toThrow("动作票据无效或已完成");

    const expired = bridge.createAction("user-1", "share", { share_code: "code" });
    advance(300_001);
    expect(() => bridge.getAction(expired.action_id, "user-1")).toThrow("动作票据已过期");
  });
});
