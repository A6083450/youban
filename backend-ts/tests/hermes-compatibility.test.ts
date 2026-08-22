import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("pi-hermes-memory compatibility", () => {
  it("mirrors a public memory_add write to Markdown and SQLite under Bun", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-hermes-"));
    const probe = Bun.spawn(
      [process.execPath, join(import.meta.dir, "fixtures/hermes-dual-store-probe.mjs"), tempRoot],
      {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    try {
      const exitCode = await probe.exited;
      const [stdout, stderr] = await Promise.all([
        new Response(probe.stdout).text(),
        new Response(probe.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      const result = JSON.parse(stdout.trim()) as {
        markdown: boolean;
        sqlite: boolean;
        warning: string | null;
      };
      expect(result).toEqual({ markdown: true, sqlite: true, warning: null });
    } finally {
      probe.kill();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
