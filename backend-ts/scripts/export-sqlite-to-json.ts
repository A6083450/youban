import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface ExportOptions {
  databasePath: string;
  outputDir: string;
}

export function exportSqliteToJson(options: ExportOptions): {
  tasks: number;
  users: number;
  conversations: number;
} {
  mkdirSync(options.outputDir, { recursive: true });
  const tasksDir = join(options.outputDir, "trip_tasks");
  const conversationsDir = join(options.outputDir, "conversations");
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(conversationsDir, { recursive: true });
  const db = new Database(options.databasePath, { readonly: true, strict: true });
  try {
    const taskRows = db.query("SELECT task_id, payload FROM tasks ORDER BY task_id").all() as Array<{
      task_id: string;
      payload: string;
    }>;
    for (const row of taskRows) {
      writeFileSync(join(tasksDir, `${row.task_id}.json`), `${JSON.stringify(JSON.parse(row.payload), null, 2)}\n`);
    }

    const conversationRows = db.query(
      "SELECT plan_id, payload FROM conversations ORDER BY plan_id",
    ).all() as Array<{ plan_id: string; payload: string }>;
    for (const row of conversationRows) {
      writeFileSync(
        join(conversationsDir, `${row.plan_id}.json`),
        `${JSON.stringify(JSON.parse(row.payload), null, 2)}\n`,
      );
    }

    const users = db.query(
      "SELECT user_id, nickname, created_at, last_login_at FROM users ORDER BY user_id",
    ).all();
    writeFileSync(join(options.outputDir, "users.json"), `${JSON.stringify({ users }, null, 2)}\n`);
    return { tasks: taskRows.length, users: users.length, conversations: conversationRows.length };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const databasePath = Bun.argv.find((arg) => arg.startsWith("--database="))?.slice("--database=".length);
  const outputDir = Bun.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
  if (!databasePath || !outputDir) {
    throw new Error("usage: bun run scripts/export-sqlite-to-json.ts --database=/path/youban.db --output=/path/export");
  }
  mkdirSync(dirname(outputDir), { recursive: true });
  console.log(JSON.stringify(exportSqliteToJson({ databasePath, outputDir }), null, 2));
}
