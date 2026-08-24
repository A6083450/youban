import { describe, expect, it } from "bun:test";
import { sseResponse } from "../src/http/sse.ts";

describe("SSE response", () => {
  it("emits delta, final, and DONE frames in order", async () => {
    const response = sseResponse(async (onDelta, signal) => {
      expect(signal.aborted).toBeFalse();
      onDelta("第一段");
      onDelta("第二段");
      return { success: true };
    });

    expect(await response.text()).toBe([
      'data: {"type":"status","status":"connected"}\n\n',
      'data: {"type":"delta","text":"第一段"}\n\n',
      'data: {"type":"delta","text":"第二段"}\n\n',
      'data: {"type":"final","payload":{"success":true}}\n\n',
      "data: [DONE]\n\n",
    ].join(""));
  });

  it("adds an optional normalized thinking event without changing delta or completion frames", async () => {
    const response = sseResponse(async (onDelta, _signal, onThinking) => {
      onThinking("正在梳理旅行偏好");
      onDelta("正常回复");
      return { success: true };
    });

    expect(await response.text()).toBe([
      'data: {"type":"status","status":"connected"}\n\n',
      'data: {"type":"thinking","detail":{"type":"thinking","title":"正在梳理旅行偏好"}}\n\n',
      'data: {"type":"delta","text":"正常回复"}\n\n',
      'data: {"type":"final","payload":{"success":true}}\n\n',
      "data: [DONE]\n\n",
    ].join(""));
  });

  it("emits an error and DONE frame for a business failure", async () => {
    const response = sseResponse(async () => {
      throw new Error("upstream failed");
    });

    expect(await response.text()).toBe([
      'data: {"type":"status","status":"connected"}\n\n',
      'data: {"type":"error","message":"upstream failed"}\n\n',
      "data: [DONE]\n\n",
    ].join(""));
  });

  it("keeps a slow upstream connection alive before its first delta", async () => {
    const response = sseResponse(async () => {
      await Bun.sleep(25);
      return { success: true };
    }, [], { heartbeatMs: 5 });

    const text = await response.text();
    expect(text.startsWith('data: {"type":"status","status":"connected"}\n\n')).toBeTrue();
    expect(text.match(/data: {"type":"heartbeat"}\n\n/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text.endsWith('data: [DONE]\n\n')).toBeTrue();
  });

  it("aborts upstream without extra frames when the reader is cancelled", async () => {
    let received: AbortSignal | undefined;
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
    const response = sseResponse((_onDelta, signal) => {
      received = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          resolveAbort();
          reject(signal.reason);
        }, { once: true });
      });
    });

    const reader = response.body!.getReader();
    await reader.cancel("client-left");
    await aborted;

    expect(received?.aborted).toBeTrue();
    expect(received?.reason).toBe("client-left");
  });

  it("composes an external shutdown signal", async () => {
    const shutdown = new AbortController();
    let received: AbortSignal | undefined;
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { resolveAbort = resolve; });
    const response = sseResponse((_onDelta, signal) => {
      received = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          resolveAbort();
          reject(signal.reason);
        }, { once: true });
      });
    }, [shutdown.signal]);

    shutdown.abort(new Error("server stopping"));
    await aborted;
    expect(await response.text()).toBe('data: {"type":"status","status":"connected"}\n\n');
    expect(received?.aborted).toBeTrue();
  });
});
