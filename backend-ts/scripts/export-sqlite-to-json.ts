import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ExportOptions {
  databasePath: string;
  outputDir: string;
}

function identifierHash(identifier: string): string {
  return new Bun.CryptoHasher("sha256").update(identifier).digest("hex");
}

function portableStem(identifier: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(identifier)
    ? identifier
    : `id-${identifierHash(identifier)}`;
}

function exportPath(directory: string, identifier: string, usedNames: Set<string>): string {
  const stem = portableStem(identifier);
  const hash = identifierHash(identifier);
  let filename = `${stem}.json`;
  let sequence = 1;
  const collisionKey = (name: string) => name.normalize("NFC").toLocaleLowerCase("und");
  while (usedNames.has(collisionKey(filename))) {
    filename = `${stem}-${hash}${sequence === 1 ? "" : `-${sequence}`}.json`;
    sequence += 1;
  }
  usedNames.add(collisionKey(filename));

  const resolvedDirectory = resolve(directory);
  const path = resolve(resolvedDirectory, filename);
  if (dirname(path) !== resolvedDirectory) throw new Error(`unsafe export identifier: ${identifier}`);
  return path;
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
    const taskNames = new Set<string>();
    for (const row of taskRows) {
      writeFileSync(
        exportPath(tasksDir, row.task_id, taskNames),
        `${JSON.stringify(JSON.parse(row.payload), null, 2)}\n`,
      );
    }

    const conversationRows = db.query(
      "SELECT plan_id, user_id, payload FROM conversations ORDER BY plan_id",
    ).all() as Array<{ plan_id: string; user_id: string; payload: string }>;
    const conversationNames = new Set<string>();
    for (const row of conversationRows) {
      const payload: unknown = JSON.parse(row.payload);
      const messages = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).messages
        : payload;
      writeFileSync(
        exportPath(conversationsDir, row.plan_id, conversationNames),
        `${JSON.stringify({ plan_id: row.plan_id, user_id: row.user_id, messages }, null, 2)}\n`,
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
