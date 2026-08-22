export type SseRun = (
  onDelta: (text: string) => void,
  signal: AbortSignal,
) => Promise<unknown>;

export function sseResponse(
  run: SseRun,
  signals: readonly AbortSignal[] = [],
): Response {
  const encoder = new TextEncoder();
  const disconnect = new AbortController();
  const signal = signals.length > 0
    ? AbortSignal.any([...signals, disconnect.signal])
    : disconnect.signal;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const send = (payload: unknown) => {
        if (closed || signal.aborted) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const abort = () => close();
      signal.addEventListener("abort", abort, { once: true });
      void (async () => {
        try {
          if (signal.aborted) return;
          const result = await run((text) => send({ type: "delta", text }), signal);
          send({ type: "final", payload: result });
        } catch (error) {
          if (!signal.aborted) {
            send({ type: "error", message: error instanceof Error ? error.message : String(error) });
          }
        } finally {
          signal.removeEventListener("abort", abort);
          if (!closed && !signal.aborted) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          close();
        }
      })();
    },
    cancel(reason) {
      closed = true;
      disconnect.abort(reason);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
