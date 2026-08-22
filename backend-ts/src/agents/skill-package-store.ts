import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ValidatedSkillDocument } from "./skill-document.ts";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export interface StagedSkillPackage {
  stagingDir: string;
  document: ValidatedSkillDocument;
  files: readonly string[];
  source: "upload" | "git";
  sanitizedSource?: string;
  sourceRef?: string;
  sourceCommit?: string;
  cleanup(): void;
}

function assertPortableComponent(component: string): void {
  if (!component || component === "." || component === ".." || component.endsWith(".") || component.endsWith(" ")) {
    throw new Error("package path contains an unsafe component");
  }
  if (/[\0-\x1f<>:"|?*]/.test(component)) {
    throw new Error("package path contains non-portable characters");
  }
  const deviceName = component.split(".", 1)[0].toLocaleUpperCase("en-US");
  if (WINDOWS_RESERVED_NAMES.has(deviceName)) {
    throw new Error("package path contains a reserved Windows device name");
  }
}

/** Normalizes repeated forward slashes while rejecting paths unsafe on supported hosts. */
export function normalizeSkillPackagePath(path: string): string {
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path) || path.startsWith("/")) {
    throw new Error("package path must be a non-empty relative path");
  }
  const components = path.split("/");
  if (components.some((component) => component === "." || component === "..")) {
    throw new Error("package path must not contain traversal segments");
  }
  const normalizedComponents = components.filter(Boolean);
  if (normalizedComponents.length === 0) throw new Error("package path must be a non-empty relative path");
  for (const component of normalizedComponents) assertPortableComponent(component);
  return normalizedComponents.join("/");
}

function assertOwnedDirectory(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} is not a directory`);
  }
}

function ensureOwnedDirectory(path: string, label: string): void {
  try {
    assertOwnedDirectory(path, label);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    mkdirSync(path, { mode: 0o700 });
    assertOwnedDirectory(path, label);
  }
}

function assertRealContained(root: string, target: string, allowRoot = false): void {
  const rootRealPath = realpathSync(root);
  const targetRealPath = realpathSync(target);
  const pathRelative = relative(rootRealPath, targetRealPath);
  if ((!allowRoot && pathRelative === "") || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
    throw new Error("package path escapes its owned root");
  }
}

export class SkillPackageStore {
  readonly stagingRoot: string;
  readonly packagesRoot: string;
  readonly archiveRoot: string;

  constructor(root: string) {
    const resolvedRoot = resolve(root);
    ensureOwnedDirectory(resolvedRoot, "package root");
    this.stagingRoot = this.createOwnedDirectory(resolvedRoot, "staging");
    this.packagesRoot = this.createOwnedDirectory(resolvedRoot, "packages");
    this.archiveRoot = this.createOwnedDirectory(resolvedRoot, "archive");
  }

  createStagingDirectory(): string {
    assertOwnedDirectory(this.stagingRoot, "staging root");
    const stagingDir = mkdtempSync(join(this.stagingRoot, "stage-"));
    assertOwnedDirectory(stagingDir, "staging directory");
    assertRealContained(this.stagingRoot, stagingDir);
    return stagingDir;
  }

  createDirectory(stagingDir: string, packagePath: string): void {
    const normalizedPath = normalizeSkillPackagePath(packagePath);
    this.assertStagingDirectory(stagingDir);
    this.ensureRelativeDirectories(stagingDir, normalizedPath.split("/"));
  }

  writeFile(stagingDir: string, packagePath: string, content: Uint8Array): void {
    const normalizedPath = normalizeSkillPackagePath(packagePath);
    this.assertStagingDirectory(stagingDir);
    const components = normalizedPath.split("/");
    const parent = this.ensureRelativeDirectories(stagingDir, components.slice(0, -1));
    const target = join(parent, components.at(-1)!);
    assertRealContained(stagingDir, parent, true);

    const descriptor = openSync(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      // Recheck immediately after no-follow creation in case a parent changed between mkdir and open.
      assertRealContained(stagingDir, parent, true);
      if (!lstatSync(target).isFile()) throw new Error("package file is not a regular file");
      writeFileSync(descriptor, content);
    } finally {
      closeSync(descriptor);
    }
  }

  cleanupStaging(stagingDir: string): void {
    const resolved = resolve(stagingDir);
    if (dirname(resolved) !== this.stagingRoot) {
      throw new Error("staging directory is not owned by this package store");
    }
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      unlinkSync(resolved);
      return;
    }
    this.assertStagingDirectory(resolved);
    rmSync(resolved, { recursive: true, force: true });
  }

  commitStaging(stagingDir: string, packagePath: string): string {
    this.assertStagingDirectory(stagingDir);
    const target = this.preparePackageTarget(this.packagesRoot, packagePath);
    renameSync(stagingDir, target);
    return target;
  }

  archivePackage(packagePath: string, archivePath: string): string {
    const source = this.resolveExistingPackagePath(this.packagesRoot, packagePath);
    const target = this.preparePackageTarget(this.archiveRoot, archivePath);
    renameSync(source, target);
    return target;
  }

  restoreArchivedPackage(archivePath: string, packagePath: string): string {
    const source = this.resolveExistingPackagePath(this.archiveRoot, archivePath);
    const target = this.preparePackageTarget(this.packagesRoot, packagePath);
    renameSync(source, target);
    return target;
  }

  private createOwnedDirectory(root: string, child: string): string {
    assertOwnedDirectory(root, "package root");
    const directory = join(root, child);
    ensureOwnedDirectory(directory, `${child} root`);
    assertRealContained(root, directory);
    return directory;
  }

  private ensureRelativeDirectories(root: string, components: readonly string[]): string {
    let directory = root;
    for (const component of components) {
      directory = join(directory, component);
      ensureOwnedDirectory(directory, "package directory");
      assertRealContained(root, directory, true);
    }
    return directory;
  }

  private preparePackageTarget(root: string, packagePath: string): string {
    const normalizedPath = normalizeSkillPackagePath(packagePath);
    assertOwnedDirectory(root, "package root");
    const components = normalizedPath.split("/");
    const parent = this.ensureRelativeDirectories(root, components.slice(0, -1));
    assertRealContained(root, parent, true);
    return join(parent, components.at(-1)!);
  }

  private resolveExistingPackagePath(root: string, packagePath: string): string {
    const target = this.preparePackageTarget(root, packagePath);
    assertOwnedDirectory(target, "package directory");
    assertRealContained(root, target);
    return target;
  }

  private assertStagingDirectory(stagingDir: string): void {
    const resolved = resolve(stagingDir);
    if (dirname(resolved) !== this.stagingRoot) {
      throw new Error("staging directory is not owned by this package store");
    }
    assertOwnedDirectory(resolved, "staging directory");
    assertRealContained(this.stagingRoot, resolved);
  }
}
