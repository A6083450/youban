import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesMemoryBridge } from "../src/services/hermes-memory.ts";

describe("HermesMemoryBridge", () => {
  it("stores and recalls user-isolated memory through the real plugin", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-hermes-bridge-"));
    const memory = new HermesMemoryBridge({ dataDir, timeoutMs: 10_000 });
    try {
      expect(await memory.remember("user-a", "用户偏好靠窗的火车座位。"))
        .toBe(true);
      expect(await memory.recall("user-a", "火车座位偏好")).toContain("靠窗");
      expect(await memory.recall("user-b", "火车座位偏好")).toBe("");
      const entries = await memory.list("user-a");
      expect(entries).toEqual([
        expect.objectContaining({ id: expect.any(String), memory: expect.stringContaining("靠窗") }),
      ]);
      expect(await memory.remove("user-a", entries[0].id)).toBe(true);
      expect(await memory.list("user-a")).toEqual([]);
      expect(await memory.recall("user-a", "火车座位偏好")).not.toContain("靠窗");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("degrades blank identities and queries without starting a worker", async () => {
    const memory = new HermesMemoryBridge({ dataDir: "/path/that/must/not/be/created" });
    expect(await memory.recall("", "偏好")).toBe("");
    expect(await memory.recall("user", "  ")).toBe("");
    expect(await memory.remember("", "内容")).toBe(false);
    expect(await memory.list("")).toEqual([]);
    expect(await memory.remove("", "1")).toBe(false);
  });
});
