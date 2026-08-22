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
      'data: {"type":"delta","text":"第一段"}\n\n',
      'data: {"type":"delta","text":"第二段"}\n\n',
      'data: {"type":"final","payload":{"success":true}}\n\n',
      "data: [DONE]\n\n",
    ].join(""));
  });

  it("emits an error and DONE frame for a business failure", async () => {
    const response = sseResponse(async () => {
      throw new Error("upstream failed");
    });

    expect(await response.text()).toBe([
      'data: {"type":"error","message":"upstream failed"}\n\n',
      "data: [DONE]\n\n",
    ].join(""));
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
    expect(await response.text()).toBe("");
    expect(received?.aborted).toBeTrue();
  });
});
