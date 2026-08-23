import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface TripMemory {
  recall(userId: string, query: string): Promise<string>;
  remember(userId: string, content: string): Promise<boolean>;
}

export interface UserMemoryItem {
  id: string;
  memory: string;
  created_at?: string;
}

export interface UserMemoryService extends TripMemory {
  list(userId: string): Promise<UserMemoryItem[]>;
  remove(userId: string, memoryId: string): Promise<boolean>;
}

export interface HermesMemoryBridgeOptions {
  dataDir: string;
  timeoutMs?: number;
  terminationGraceMs?: number;
  workerPath?: string;
}

export class HermesMemoryBridge implements UserMemoryService {
  private readonly timeoutMs: number;
  private readonly terminationGraceMs: number;
  private readonly activeCalls = new Set<Promise<void>>();
  private readonly activeWorkers = new Set<ReturnType<typeof Bun.spawn>>();
  private readonly terminations = new WeakMap<ReturnType<typeof Bun.spawn>, Promise<void>>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: HermesMemoryBridgeOptions) {
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.terminationGraceMs = options.terminationGraceMs ?? 250;
  }

  async recall(userId: string, query: string): Promise<string> {
    this.assertOpen();
    const normalizedUser = userId.trim();
    const normalizedQuery = query.trim();
    if (!normalizedUser || !normalizedQuery) return "";
    const result = await this.run(normalizedUser, { action: "recall", text: normalizedQuery });
    if (result.ok && result.output) return result.output;
    try {
      return readFileSync(join(this.userRoot(normalizedUser), "agent", "pi-hermes-memory", "USER.md"), "utf8")
        .replaceAll(/<!--[^]*?-->/g, "")
        .trim()
        .slice(0, 4_000);
    } catch {
      return "";
    }
  }

  async remember(userId: string, content: string): Promise<boolean> {
    this.assertOpen();
    const normalizedUser = userId.trim();
    const normalizedContent = content.trim();
    if (!normalizedUser || !normalizedContent) return false;
    return (await this.run(normalizedUser, { action: "remember", text: normalizedContent })).ok;
  }

  async list(userId: string): Promise<UserMemoryItem[]> {
    this.assertOpen();
    const normalizedUser = userId.trim();
    if (!normalizedUser) return [];
    const result = await this.run(normalizedUser, { action: "list" });
    return result.ok ? result.items : [];
  }

  async remove(userId: string, memoryId: string): Promise<boolean> {
    this.assertOpen();
    const normalizedUser = userId.trim();
    const normalizedId = memoryId.trim();
    if (!normalizedUser || !normalizedId) return false;
    return (await this.run(normalizedUser, { action: "remove", memoryId: normalizedId })).ok;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await Promise.allSettled([...this.activeWorkers].map((worker) => this.terminate(worker)));
      await Promise.allSettled([...this.activeCalls]);
    })();
    return this.closePromise;
  }

  private run(
    userId: string,
    input:
      | { action: "remember" | "recall"; text: string }
      | { action: "list" }
      | { action: "remove"; memoryId: string },
  ): Promise<{ ok: boolean; output: string; items: UserMemoryItem[] }> {
    this.assertOpen();
    const operation = this.runWorker(userId, input);
    const drain = operation.then(
      () => undefined,
      () => undefined,
    );
    this.activeCalls.add(drain);
    void drain.then(() => this.activeCalls.delete(drain));
    return operation;
  }

  private async runWorker(
    userId: string,
    input:
      | { action: "remember" | "recall"; text: string }
      | { action: "list" }
      | { action: "remove"; memoryId: string },
  ): Promise<{ ok: boolean; output: string; items: UserMemoryItem[] }> {
    const userRoot = this.userRoot(userId);
    const worker = Bun.spawn(
      [process.execPath, this.options.workerPath ?? join(import.meta.dir, "hermes-memory-worker.mjs"), userRoot],
      {
        cwd: join(import.meta.dir, "..", ".."),
        env: { ...process.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    this.activeWorkers.add(worker);
    const stdout = new Response(worker.stdout).text();
    const stderr = new Response(worker.stderr).text();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      worker.stdin.write(JSON.stringify(input));
      worker.stdin.end();
      const expired = new Promise<"expired">((resolve) => {
        timeout = setTimeout(() => {
          resolve("expired");
        }, this.timeoutMs);
      });
      const completed = Promise.all([worker.exited, stdout, stderr] as const);
      const outcome = await Promise.race([
        completed.then((result) => ({ type: "completed" as const, result })),
        expired.then(() => ({ type: "expired" as const })),
      ]);
      if (outcome.type === "expired") {
        await this.terminate(worker);
        await Promise.allSettled([completed]);
        return { ok: false, output: "", items: [] };
      }
      const [exitCode, output] = outcome.result;
      if (exitCode !== 0) return { ok: false, output: "", items: [] };
      const lastLine = output.trim().split(/\r?\n/).at(-1) ?? "";
      const result = JSON.parse(lastLine) as Record<string, unknown>;
      const items = Array.isArray(result.items)
        ? result.items.flatMap((item): UserMemoryItem[] => {
            if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
            const entry = item as Record<string, unknown>;
            if (typeof entry.id !== "string" || typeof entry.memory !== "string") return [];
            return [{
              id: entry.id,
              memory: entry.memory,
              ...(typeof entry.created_at === "string" ? { created_at: entry.created_at } : {}),
            }];
          })
        : [];
      return { ok: result.ok === true, output: String(result.output ?? ""), items };
    } catch {
      await this.terminate(worker);
      await Promise.allSettled([stdout, stderr]);
      return { ok: false, output: "", items: [] };
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeWorkers.delete(worker);
    }
  }

  private terminate(worker: ReturnType<typeof Bun.spawn>): Promise<void> {
    const active = this.terminations.get(worker);
    if (active) return active;
    const termination = (async () => {
      const exited = worker.exited.then(() => undefined, () => undefined);
      try {
        worker.kill("SIGTERM");
      } catch {
        // The worker already exited.
      }
      let escalation: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          escalation = setTimeout(() => {
            try {
              worker.kill("SIGKILL");
            } catch {
              // The worker exited during the grace period.
            }
            resolve();
          }, this.terminationGraceMs);
        }),
      ]);
      if (escalation) clearTimeout(escalation);
      await exited;
    })();
    this.terminations.set(worker, termination);
    return termination;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Hermes memory bridge is closed");
  }

  private userRoot(userId: string): string {
    const userHash = createHash("sha256").update(userId).digest("hex");
    return join(this.options.dataDir, "memory", "users", userHash);
  }
}
