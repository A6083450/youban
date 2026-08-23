import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasksTable = sqliteTable(
  "tasks",
  {
    taskId: text("task_id").primaryKey(),
    planId: text("plan_id").notNull(),
    userId: text("user_id").notNull().default(""),
    status: text("status").notNull(),
    shareToken: text("share_token").notNull().default(""),
    userDeletedAt: text("user_deleted_at"),
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

export const conversationSessionsTable = sqliteTable(
  "conversation_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    titleStatus: text("title_status").notNull(),
    state: text("state").notNull(),
    planId: text("plan_id"),
    snapshot: text("snapshot").notNull(),
    firstMessage: text("first_message").notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("conversation_sessions_plan_id_idx").on(table.planId),
    index("conversation_sessions_user_deleted_updated_idx").on(table.userId, table.deletedAt, table.updatedAt),
  ],
);

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

export const managedSkillsTable = sqliteTable(
  "managed_skills",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    repositoryUrl: text("repository_url"),
    sourceRef: text("source_ref"),
    sourceSubdirectory: text("source_subdirectory"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    activeVersionId: text("active_version_id"),
    candidateVersionId: text("candidate_version_id"),
    generation: integer("generation").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [uniqueIndex("managed_skills_name_idx").on(table.name)],
);

export const skillVersionsTable = sqliteTable(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id").notNull().references(() => managedSkillsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    state: text("state").notNull(),
    content: text("content").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    sha256: text("sha256").notNull(),
    packageRelativePath: text("package_relative_path").notNull(),
    sourceCommit: text("source_commit"),
    createdAt: text("created_at").notNull(),
    activatedAt: text("activated_at"),
  },
  (table) => [
    index("skill_versions_skill_idx").on(table.skillId),
    uniqueIndex("skill_versions_skill_id_id_idx").on(table.skillId, table.id),
    uniqueIndex("skill_versions_skill_version_idx").on(table.skillId, table.versionNumber),
  ],
);

export const skillAgentAssignmentsTable = sqliteTable(
  "skill_agent_assignments",
  {
    skillId: text("skill_id").notNull().references(() => managedSkillsTable.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.skillId, table.agentId] })],
);

export const skillAuditEventsTable = sqliteTable(
  "skill_audit_events",
  {
    id: text("id").primaryKey(),
    operation: text("operation").notNull(),
    skillId: text("skill_id").notNull().references(() => managedSkillsTable.id, { onDelete: "cascade" }),
    versionId: text("version_id").references(() => skillVersionsTable.id, { onDelete: "set null" }),
    sanitizedSource: text("sanitized_source"),
    result: text("result").notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("skill_audit_events_skill_created_idx").on(table.skillId, table.createdAt)],
);

export const schema = {
  tasks: tasksTable,
  conversations: conversationsTable,
  conversationSessions: conversationSessionsTable,
  users: usersTable,
  managedSkills: managedSkillsTable,
  skillVersions: skillVersionsTable,
  skillAgentAssignments: skillAgentAssignmentsTable,
  skillAuditEvents: skillAuditEventsTable,
};

export type YoubanSchema = typeof schema;

export const CURRENT_SCHEMA_VERSION = 3;

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

export const SKILL_CATALOG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS managed_skills (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('builtin', 'custom')),
    source TEXT NOT NULL CHECK (source IN ('builtin', 'upload', 'git')),
    repository_url TEXT,
    source_ref TEXT,
    source_subdirectory TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    active_version_id TEXT,
    candidate_version_id TEXT,
    generation INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT,
    FOREIGN KEY (id, active_version_id)
      REFERENCES skill_versions(skill_id, id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (id, candidate_version_id)
      REFERENCES skill_versions(skill_id, id) DEFERRABLE INITIALLY DEFERRED
  );
  CREATE UNIQUE INDEX IF NOT EXISTS managed_skills_name_idx ON managed_skills(name);

  CREATE TABLE IF NOT EXISTS skill_versions (
    id TEXT PRIMARY KEY NOT NULL,
    skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('candidate', 'active', 'superseded', 'archived')),
    content TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    package_relative_path TEXT NOT NULL,
    source_commit TEXT,
    created_at TEXT NOT NULL,
    activated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS skill_versions_skill_idx ON skill_versions(skill_id);
  CREATE UNIQUE INDEX IF NOT EXISTS skill_versions_skill_id_id_idx ON skill_versions(skill_id, id);
  CREATE UNIQUE INDEX IF NOT EXISTS skill_versions_skill_version_idx
    ON skill_versions(skill_id, version_number);
  CREATE UNIQUE INDEX IF NOT EXISTS skill_versions_one_candidate_idx
    ON skill_versions(skill_id) WHERE state = 'candidate';
  CREATE UNIQUE INDEX IF NOT EXISTS skill_versions_one_active_idx
    ON skill_versions(skill_id) WHERE state = 'active';

  CREATE TABLE IF NOT EXISTS skill_agent_assignments (
    skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    PRIMARY KEY (skill_id, agent_id)
  );

  CREATE TABLE IF NOT EXISTS skill_audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    operation TEXT NOT NULL,
    skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE CASCADE,
    version_id TEXT REFERENCES skill_versions(id) ON DELETE SET NULL,
    sanitized_source TEXT,
    result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
    error_code TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS skill_audit_events_skill_created_idx
    ON skill_audit_events(skill_id, created_at);
`;

export const CONVERSATION_SESSIONS_SCHEMA_SQL = `
  ALTER TABLE tasks ADD COLUMN user_deleted_at TEXT;

  CREATE TABLE IF NOT EXISTS conversation_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_status TEXT NOT NULL CHECK (title_status IN ('pending', 'generated', 'fallback')),
    state TEXT NOT NULL CHECK (state IN ('chatting', 'generating', 'planned')),
    plan_id TEXT,
    snapshot TEXT NOT NULL,
    first_message TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS conversation_sessions_plan_id_idx
    ON conversation_sessions(plan_id) WHERE plan_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS conversation_sessions_user_deleted_updated_idx
    ON conversation_sessions(user_id, deleted_at, updated_at);
`;
