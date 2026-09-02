import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProductionCutover } from "../scripts/prepare-production-cutover.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("production cutover preparation", () => {
  it("deletes only enumerated business data and preserves runtime configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "youban-cutover-"));
    directories.push(root);
    const dataDir = join(root, "data");
    const backupRoot = join(root, "backups");
    mkdirSync(join(dataDir, "images"), { recursive: true });
    mkdirSync(join(dataDir, "memory"), { recursive: true });
    mkdirSync(join(dataDir, "avatars"), { recursive: true });
    writeFileSync(join(dataDir, "images", "one.jpg"), "image");
    writeFileSync(join(dataDir, "memory", "memory.txt"), "memory");
    writeFileSync(join(dataDir, "avatars", "avatar.png"), "avatar");
    writeFileSync(join(dataDir, "users.json"), JSON.stringify({ users: [] }));
    writeFileSync(join(dataDir, "youban.db"), "database");
    writeFileSync(join(dataDir, "runtime_settings.json"), "{}");
    writeFileSync(join(dataDir, "admin_password.txt"), "secret");

    const result = prepareProductionCutover({
      dataDir,
      backupRoot,
      execute: true,
      confirmedDataDir: dataDir,
    } as any);
    expect(result.removed).toEqual(expect.arrayContaining([
      "avatars", "images", "memory", "users.json", "youban.db",
    ]));
    expect(existsSync(join(dataDir, "images"))).toBe(false);
    expect(existsSync(join(dataDir, "memory"))).toBe(false);
    expect(existsSync(join(dataDir, "avatars"))).toBe(false);
    expect(existsSync(join(dataDir, "users.json"))).toBe(false);
    expect(existsSync(join(dataDir, "youban.db"))).toBe(false);
    expect(existsSync(join(dataDir, "runtime_settings.json"))).toBe(true);
    expect(existsSync(join(dataDir, "admin_password.txt"))).toBe(true);
  });

  it("requires an exact resolved data-directory confirmation before deletion", () => {
    const root = mkdtempSync(join(tmpdir(), "youban-cutover-"));
    directories.push(root);
    expect(() => prepareProductionCutover({
      dataDir: root,
      backupRoot: join(root, "backup"),
      execute: true,
      confirmedDataDir: `${root}-wrong`,
    } as any)).toThrow("confirmation must exactly match the resolved data directory");
  });
});
