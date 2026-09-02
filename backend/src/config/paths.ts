/**
 * 路径解析模块。
 * 仓库根定位：从 import.meta.dir 向上三级（backend/src/config → 仓库根）。
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** 仓库根目录（backend/src/config 向上三级）。 */
export function getRepoRoot(): string {
  return resolve(import.meta.dir, "..", "..", "..");
}

let cachedDataDir: string | null = null;

/** 数据根目录：env DATA_DIR 优先，默认 <仓库根>/data。进程内缓存。 */
export function getDataDir(): string {
  if (cachedDataDir !== null) return cachedDataDir;
  const envDir = process.env.DATA_DIR?.trim();
  cachedDataDir = envDir ? resolve(envDir) : join(getRepoRoot(), "data");
  return cachedDataDir;
}

/** 确保并返回子目录路径（不存在则递归创建）。 */
export function ensureDataSubdir(name: string): string {
  const dir = join(getDataDir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** @internal 仅测试用：清除进程内目录缓存。 */
export function _resetDataDirCacheForTest(): void {
  cachedDataDir = null;
}
