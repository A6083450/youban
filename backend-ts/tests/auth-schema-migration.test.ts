import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
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
    expect((database.raw.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(7);
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
    const oauthStateTable = database.raw.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wechat_web_oauth_states'",
    ).get() as { name: string } | null;
    expect(oauthStateTable?.name).toBe("wechat_web_oauth_states");
    const oauthStateColumns = database.raw.query(
      "PRAGMA table_info(wechat_web_oauth_states)",
    ).all() as Array<{ name: string }>;
    expect(oauthStateColumns.map(column => column.name).sort()).toEqual([
      "browser_verifier_hash",
      "consumed_at",
      "created_at",
      "expires_at",
      "state_hash",
    ]);
    expect(database.quickCheck()).toBe("ok");
    database.close();
  });

  it("upgrades a version 6 database without replacing existing tables", () => {
    const directory = mkdtempSync(join(tmpdir(), "youban-auth-schema-v6-"));
    directories.push(directory);
    const databasePath = join(directory, "youban.db");
    const legacy = new Database(databasePath, { create: true });
    legacy.exec(`
      CREATE TABLE preserved_records (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO preserved_records (id, value) VALUES ('record-1', 'keep-me');
      PRAGMA user_version = 6;
    `);
    legacy.close();

    const database = new YoubanDatabase(databasePath);

    expect((database.raw.query("PRAGMA user_version").get() as { user_version: number }).user_version)
      .toBe(7);
    expect(database.raw.query("SELECT value FROM preserved_records WHERE id = ?")
      .get("record-1")).toEqual({ value: "keep-me" });
    expect(database.raw.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wechat_web_oauth_states'",
    ).get()).toEqual({ name: "wechat_web_oauth_states" });
    database.close();
  });
});
