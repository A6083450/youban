import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserMemoryItem, UserMemoryService } from "../src/services/hermes-memory.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class FakeMemory implements UserMemoryService {
  readonly entries = new Map<string, UserMemoryItem[]>();

  async recall() { return ""; }
  async remember() { return true; }
  async list(userId: string) { return this.entries.get(userId) ?? []; }
  async remove(userId: string, memoryId: string) {
    const entries = this.entries.get(userId) ?? [];
    const next = entries.filter((entry) => entry.id !== memoryId);
    this.entries.set(userId, next);
    return next.length !== entries.length;
  }
}

let runtime: HttpRuntime;
let dataDir = "";

afterEach(() => {
  runtime?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("auth memory HTTP", () => {
  it("lists and removes only the authenticated user's memories", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "youban-auth-memory-"));
    const memory = new FakeMemory();
    runtime = createHttpRuntime({ dataDir, memory });
    const user = runtime.users.login("小艾");
    memory.entries.set(user.user_id, [
      { id: "7", memory: "喜欢安静的自然景点", created_at: "2026-08-21" },
      { id: "9", memory: "不吃辣", created_at: "2026-08-20" },
    ]);

    const headers = { "X-User-Id": user.user_id };
    const listed = await runtime.app.handle(new Request("http://localhost/api/auth/memories", { headers }));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      success: true,
      items: [
        { id: "7", memory: "喜欢安静的自然景点", created_at: "2026-08-21" },
        { id: "9", memory: "不吃辣", created_at: "2026-08-20" },
      ],
    });

    const removed = await runtime.app.handle(new Request("http://localhost/api/auth/memories/7", {
      method: "DELETE",
      headers,
    }));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ success: true });
    expect(await memory.list(user.user_id)).toEqual([
      { id: "9", memory: "不吃辣", created_at: "2026-08-20" },
    ]);

    const missing = await runtime.app.handle(new Request("http://localhost/api/auth/memories/7", {
      method: "DELETE",
      headers,
    }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ detail: "记忆不存在" });
  });

  it("rejects memory access for an unknown user", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "youban-auth-memory-"));
    runtime = createHttpRuntime({ dataDir, memory: new FakeMemory() });
    const response = await runtime.app.handle(new Request("http://localhost/api/auth/memories", {
      headers: { "X-User-Id": "ghost" },
    }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: "用户不存在,请重新登录" });
  });
});
