import { eq } from "drizzle-orm";
import { usersTable } from "./db-schema.ts";
import { YoubanDatabase } from "./database.ts";

export interface UserRecord {
  user_id: string;
  nickname: string;
  created_at: string;
  last_login_at: string;
}

export class UserInputError extends Error {}

function normalizeNickname(value: string): string {
  return String(value ?? "").trim().split(/\s+/u).filter(Boolean).join(" ");
}

function nicknameKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}

function toRecord(row: typeof usersTable.$inferSelect): UserRecord {
  return {
    user_id: row.userId,
    nickname: row.nickname,
    created_at: row.createdAt,
    last_login_at: row.lastLoginAt,
  };
}

export class SqliteUserRepository {
  readonly database: YoubanDatabase;

  constructor(path: string) {
    this.database = new YoubanDatabase(path);
  }

  login(rawNickname: string): UserRecord {
    const nickname = normalizeNickname(rawNickname);
    if (!nickname) throw new UserInputError("昵称不能为空");
    if ([...nickname].length > 20) throw new UserInputError("昵称不能超过 20 个字符");
    const key = nicknameKey(nickname);
    const now = new Date().toISOString();
    const existing = this.database.orm
      .select()
      .from(usersTable)
      .where(eq(usersTable.nicknameKey, key))
      .get();
    if (existing) {
      this.database.orm
        .update(usersTable)
        .set({ lastLoginAt: now })
        .where(eq(usersTable.userId, existing.userId))
        .run();
      return { ...toRecord(existing), last_login_at: now };
    }
    const row = {
      userId: crypto.randomUUID().replaceAll("-", "").slice(0, 8),
      nickname,
      nicknameKey: key,
      createdAt: now,
      lastLoginAt: now,
    };
    this.database.orm.insert(usersTable).values(row).run();
    return toRecord(row);
  }

  get(userId: string): UserRecord | undefined {
    const row = this.database.orm
      .select()
      .from(usersTable)
      .where(eq(usersTable.userId, userId.trim()))
      .get();
    return row ? toRecord(row) : undefined;
  }

  close(): void {
    this.database.close();
  }
}
