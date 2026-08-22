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

interface HermesMemoryBridgeOptions {
  dataDir: string;
  timeoutMs?: number;
}

export class HermesMemoryBridge implements UserMemoryService {
  private readonly timeoutMs: number;

  constructor(private readonly options: HermesMemoryBridgeOptions) {
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async recall(userId: string, query: string): Promise<string> {
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
    const normalizedUser = userId.trim();
    const normalizedContent = content.trim();
    if (!normalizedUser || !normalizedContent) return false;
    return (await this.run(normalizedUser, { action: "remember", text: normalizedContent })).ok;
  }

  async list(userId: string): Promise<UserMemoryItem[]> {
    const normalizedUser = userId.trim();
    if (!normalizedUser) return [];
    const result = await this.run(normalizedUser, { action: "list" });
    return result.ok ? result.items : [];
  }

  async remove(userId: string, memoryId: string): Promise<boolean> {
    const normalizedUser = userId.trim();
    const normalizedId = memoryId.trim();
    if (!normalizedUser || !normalizedId) return false;
    return (await this.run(normalizedUser, { action: "remove", memoryId: normalizedId })).ok;
  }

  private async run(
    userId: string,
    input:
      | { action: "remember" | "recall"; text: string }
      | { action: "list" }
      | { action: "remove"; memoryId: string },
  ): Promise<{ ok: boolean; output: string; items: UserMemoryItem[] }> {
    const userRoot = this.userRoot(userId);
    const worker = Bun.spawn(
      [process.execPath, join(import.meta.dir, "hermes-memory-worker.mjs"), userRoot],
      {
        cwd: join(import.meta.dir, "..", ".."),
        env: { ...process.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    worker.stdin.write(JSON.stringify(input));
    worker.stdin.end();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          worker.kill();
          reject(new Error("Hermes memory worker timed out"));
        }, this.timeoutMs);
      });
      const exitCode = await Promise.race([worker.exited, expired]);
      if (exitCode !== 0) return { ok: false, output: "", items: [] };
      const stdout = await new Response(worker.stdout).text();
      const lastLine = stdout.trim().split(/\r?\n/).at(-1) ?? "";
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
      return { ok: false, output: "", items: [] };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private userRoot(userId: string): string {
    const userHash = createHash("sha256").update(userId).digest("hex");
    return join(this.options.dataDir, "memory", "users", userHash);
  }
}
