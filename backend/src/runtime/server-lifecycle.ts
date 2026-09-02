import type { ParentSessionPoolSnapshot } from "../agents/persistent-parent-agent.ts";
import { MAX_PRODUCTION_REQUEST_BODY_BYTES } from "../http/admin-skill-limits.ts";

export interface ProductionHttpListenOptions {
  hostname: string;
  port: number;
}

export function listenProductionHttpServer<TServer>(
  app: {
    listen(options: ProductionHttpListenOptions & { maxRequestBodySize: number }): TServer;
  },
  options: ProductionHttpListenOptions,
): TServer {
  return app.listen({
    ...options,
    maxRequestBodySize: MAX_PRODUCTION_REQUEST_BODY_BYTES,
  });
}

export interface MemoryPressureProcess {
  on(event: "memoryPressure", listener: (level: unknown) => void): unknown;
  off(event: "memoryPressure", listener: (level: unknown) => void): unknown;
}

export interface LifecycleLogger {
  info(message: string, details?: unknown): void;
  warn(message: string): void;
  error(message: string): void;
}

export function installMemoryPressureHandler(
  runtime: { releaseIdleResources(reason: "memory-pressure"): Promise<ParentSessionPoolSnapshot> },
  processRef: MemoryPressureProcess = process as unknown as MemoryPressureProcess,
  logger: LifecycleLogger = console,
): () => void {
  const listener = (level: unknown) => {
    void runtime.releaseIdleResources("memory-pressure")
      .then((snapshot) => {
        logger.info("Bun memory pressure cleanup", { level, ...snapshot });
      })
      .catch((error) => {
        logger.warn(`Bun memory pressure cleanup failed: ${error}`);
      });
  };
  processRef.on("memoryPressure", listener);
  return () => processRef.off("memoryPressure", listener);
}

export async function shutdownServer(
  server: { stop(force?: boolean): unknown | Promise<unknown> },
  runtime: { beginShutdown?(): unknown | Promise<unknown>; close(): Promise<void> },
  options: { timeoutMs?: number; exit?: (code: number) => never; logger?: LifecycleLogger } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logger = options.logger ?? console;
  const graceful = (async () => {
    const errors: unknown[] = [];
    try {
      await runtime.beginShutdown?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      await server.stop(false);
    } catch (error) {
      errors.push(error);
    }
    try {
      await runtime.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "server shutdown failed");
  })();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${timeoutMs}ms`);
      try {
        exit(1);
      } catch (error) {
        reject(error);
      }
      reject(new Error(`Graceful shutdown timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([graceful, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
