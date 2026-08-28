import { existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { parse, resolve } from "node:path";

export const BUSINESS_DATA_ENTRIES = [
  "youban.db",
  "youban.db-wal",
  "youban.db-shm",
  "tasks.db",
  "users.json",
  "trip_tasks",
  "conversations",
  "images",
  "avatars",
  "memory",
  "pi-runtime",
  "tool_audit",
  "migration-backups",
  "skills",
] as const;

export const PRESERVED_OPERATIONAL_ENTRIES = [
  "runtime_settings.json",
  "admin_password.txt",
] as const;

export interface CutoverPreparationOptions {
  dataDir: string;
  confirmedDataDir?: string;
  execute?: boolean;
  // Accepted only so older callers fail safely without creating a compatibility backup.
  backupRoot?: string;
}

export interface CutoverPreparationResult {
  dataDir: string;
  executed: boolean;
  removed: string[];
  missing: string[];
  preserved: string[];
}

function checkedDataDir(input: string): string {
  const requested = resolve(input);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new Error(`data directory does not exist: ${requested}`);
  }
  const dataDir = realpathSync(requested);
  if (dataDir === parse(dataDir).root || dataDir === realpathSync(homedir())) {
    throw new Error(`refusing broad data directory: ${dataDir}`);
  }
  return dataDir;
}

export function prepareProductionCutover(options: CutoverPreparationOptions): CutoverPreparationResult {
  const dataDir = checkedDataDir(options.dataDir);
  const existing = BUSINESS_DATA_ENTRIES.filter((entry) => existsSync(resolve(dataDir, entry)));
  const missing = BUSINESS_DATA_ENTRIES.filter((entry) => !existing.includes(entry));
  const preserved = PRESERVED_OPERATIONAL_ENTRIES.filter((entry) => existsSync(resolve(dataDir, entry)));

  if (!options.execute) {
    return { dataDir, executed: false, removed: [], missing: [...missing], preserved: [...preserved] };
  }
  const confirmed = resolve(String(options.confirmedDataDir || ""));
  const canonicalConfirmation = existsSync(confirmed) ? realpathSync(confirmed) : confirmed;
  if (canonicalConfirmation !== dataDir) {
    throw new Error("confirmation must exactly match the resolved data directory");
  }
  for (const entry of existing) {
    rmSync(resolve(dataDir, entry), { recursive: true, force: false });
  }
  return { dataDir, executed: true, removed: [...existing], missing: [...missing], preserved: [...preserved] };
}

if (import.meta.main) {
  const dataDir = Bun.argv.find((arg) => arg.startsWith("--data-dir="))?.slice("--data-dir=".length);
  const confirmedDataDir = Bun.argv.find((arg) => arg.startsWith("--confirm-dir="))?.slice("--confirm-dir=".length);
  const execute = Bun.argv.includes("--execute");
  if (!dataDir) {
    throw new Error("usage: bun run scripts/prepare-production-cutover.ts --data-dir=/absolute/data/path [--execute --confirm-dir=/same/absolute/data/path]");
  }
  console.log(JSON.stringify(prepareProductionCutover({ dataDir, confirmedDataDir, execute }), null, 2));
}
