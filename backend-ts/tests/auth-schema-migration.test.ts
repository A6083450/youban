import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YoubanDatabase } from "../src/domain/database.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("authentication schema migration", () => {
  it("creates a fresh WeChat-only schema without nickname identity or migration tables", () => {
    const directory = mkdtempSync(join(tmpdir(), "youban-auth-schema-"));
    directories.push(directory);
    const databasePath = join(directory, "youban.db");
    const database = new YoubanDatabase(databasePath);
    expect((database.raw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(6);
    const userColumns = database.raw.query("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    expect(userColumns.map((entry) => entry.name).sort()).toEqual([
      "avatar_file",
      "created_at",
      "last_login_at",
      "nickname",
      "profile_completed_at",
      "user_id",
    ]);
    const legacyTable = database.raw.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_migration_codes'",
    ).get();
    expect(legacyTable).toBeNull();
    expect(database.quickCheck()).toBe("ok");
    database.close();
  });
});
