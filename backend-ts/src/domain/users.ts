import { eq } from "drizzle-orm";
import { usersTable } from "./db-schema.ts";
import { YoubanDatabase } from "./database.ts";

export interface UserRecord {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  profile_complete: boolean;
  created_at: string;
  last_login_at: string;
}

function toRecord(row: typeof usersTable.$inferSelect): UserRecord {
  return {
    user_id: row.userId,
    nickname: row.nickname,
    avatar_url: row.avatarFile ? `/api/avatars/${row.avatarFile}` : null,
    profile_complete: Boolean(row.profileCompletedAt),
    created_at: row.createdAt,
    last_login_at: row.lastLoginAt,
  };
}

export class SqliteUserRepository {
  readonly database: YoubanDatabase;

  constructor(path: string) {
    this.database = new YoubanDatabase(path);
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
