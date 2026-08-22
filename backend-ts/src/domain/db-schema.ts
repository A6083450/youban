import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasksTable = sqliteTable(
  "tasks",
  {
    taskId: text("task_id").primaryKey(),
    planId: text("plan_id").notNull(),
    userId: text("user_id").notNull().default(""),
    status: text("status").notNull(),
    shareToken: text("share_token").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    index("tasks_user_updated_idx").on(table.userId, table.updatedAt),
    uniqueIndex("tasks_share_token_idx").on(table.shareToken),
  ],
);

export const conversationsTable = sqliteTable("conversations", {
  planId: text("plan_id").primaryKey(),
  userId: text("user_id").notNull().default(""),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const usersTable = sqliteTable(
  "users",
  {
    userId: text("user_id").primaryKey(),
    nickname: text("nickname").notNull(),
    nicknameKey: text("nickname_key").notNull(),
    createdAt: text("created_at").notNull(),
    lastLoginAt: text("last_login_at").notNull(),
  },
  (table) => [uniqueIndex("users_nickname_key_idx").on(table.nicknameKey)],
);

export const schema = {
  tasks: tasksTable,
  conversations: conversationsTable,
  users: usersTable,
};

export type YoubanSchema = typeof schema;

export const CURRENT_SCHEMA_VERSION = 1;

// Referencing the drizzle schema here keeps migration DDL and typed queries aligned.
export const INITIAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY NOT NULL,
    plan_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    share_token TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_user_updated_idx ON tasks(user_id, updated_at);
  CREATE UNIQUE INDEX IF NOT EXISTS tasks_share_token_idx ON tasks(share_token) WHERE share_token <> '';
  CREATE TABLE IF NOT EXISTS conversations (
    plan_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY NOT NULL,
    nickname TEXT NOT NULL,
    nickname_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_nickname_key_idx ON users(nickname_key);
`;

// Prevent aggressive tree-shaking from treating the drizzle declarations as documentation only.
void integer;
