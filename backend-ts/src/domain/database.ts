import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import {
  CURRENT_SCHEMA_VERSION,
  CONVERSATION_SESSIONS_SCHEMA_SQL,
  INITIAL_SCHEMA_SQL,
  SKILL_CATALOG_SCHEMA_SQL,
  schema,
  type YoubanSchema,
} from "./db-schema.ts";

export class YoubanDatabase {
  readonly raw: Database;
  readonly orm: BunSQLiteDatabase<YoubanSchema>;
  private closed = false;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new Database(path, { create: true, strict: true });
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA synchronous = NORMAL");
    this.raw.exec("PRAGMA busy_timeout = 5000");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    const integrity = this.quickCheck();
    if (integrity !== "ok") {
      this.raw.close();
      throw new Error(`SQLite quick_check failed: ${integrity}`);
    }
    this.orm = drizzle(this.raw, { schema });
  }

  private migrate(): void {
    const { user_version: currentVersion } = this.raw.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `database schema ${currentVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
      );
    }
    if (currentVersion === CURRENT_SCHEMA_VERSION) return;
    const migrations: Readonly<Record<number, () => void>> = {
      1: () => this.migrateVersionOne(),
      2: () => this.migrateVersionTwo(),
      3: () => this.migrateVersionThree(),
    };
    const migrate = this.raw.transaction(() => {
      for (let version = currentVersion + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
        const apply = migrations[version];
        if (!apply) throw new Error(`missing migration for schema version ${version}`);
        apply();
        this.raw.exec(`PRAGMA user_version = ${version}`);
      }
    });
    migrate();
  }

  private migrateVersionOne(): void {
    this.raw.exec(INITIAL_SCHEMA_SQL);
  }

  private migrateVersionTwo(): void {
    this.raw.exec(SKILL_CATALOG_SCHEMA_SQL);
  }

  private migrateVersionThree(): void {
    this.raw.exec(CONVERSATION_SESSIONS_SCHEMA_SQL);
  }

  quickCheck(): string {
    const result = this.raw.query("PRAGMA quick_check").get() as { quick_check: string };
    return result.quick_check;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.raw.close();
  }
}
