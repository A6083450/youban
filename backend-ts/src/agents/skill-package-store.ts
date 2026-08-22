import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ValidatedSkillDocument } from "./skill-document.ts";

const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "COM¹", "COM²", "COM³",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  "LPT¹", "LPT²", "LPT³",
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

function ensureOwnedDirectoryHierarchy(path: string, label: string): void {
  const missingDirectories: string[] = [];
  let current = path;
  while (true) {
    try {
      assertOwnedDirectory(current, label);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missingDirectories.unshift(current);
      current = parent;
    }
  }
  for (const directory of missingDirectories) {
    mkdirSync(directory, { mode: 0o700 });
    assertOwnedDirectory(directory, label);
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
    ensureOwnedDirectoryHierarchy(resolvedRoot, "package root");
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

  restoreCommittedPackageToStaging(packagePath: string, stagingDir: string): void {
    const resolvedStaging = this.resolveOwnedStagingPath(stagingDir);
    const source = this.resolveExistingPackagePath(this.packagesRoot, packagePath);
    renameSync(source, resolvedStaging);
    this.cleanupEmptyPackageParents(dirname(source), this.packagesRoot);
  }

  recoverCommittedPackageToStaging(packagePath: string, stagingDir: string): void {
    const resolvedStaging = this.resolveOwnedStagingPath(stagingDir);
    const packageTarget = this.resolvePackagePath(this.packagesRoot, packagePath);
    const stagingExists = existsSync(resolvedStaging);
    const packageExists = existsSync(packageTarget);
    if (stagingExists && !packageExists) return;
    if (!stagingExists && packageExists) {
      const source = this.resolveExistingPackagePath(this.packagesRoot, packagePath);
      renameSync(source, resolvedStaging);
      this.cleanupEmptyPackageParents(dirname(source), this.packagesRoot);
      return;
    }
    throw new Error("candidate package recovery state is ambiguous");
  }

  discardCommittedPackage(packagePath: string): void {
    const source = this.resolveExistingPackagePath(this.packagesRoot, packagePath);
    rmSync(source, { recursive: true, force: false });
    this.cleanupEmptyPackageParents(dirname(source), this.packagesRoot);
  }

  createEditedStaging(packagePath: string, skillContent: Uint8Array): string {
    const source = this.resolveExistingPackagePath(this.packagesRoot, packagePath);
    const stagingDir = this.createStagingDirectory();
    const copyDirectory = (directory: string, prefix: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (relativePath === "SKILL.md") continue;
        const sourcePath = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("package contains an unsafe symbolic link");
        if (entry.isDirectory()) {
          this.createDirectory(stagingDir, relativePath);
          copyDirectory(sourcePath, relativePath);
          continue;
        }
        if (!entry.isFile()) throw new Error("package contains a non-regular file");
        this.writeFile(stagingDir, relativePath, readFileSync(sourcePath));
      }
    };
    try {
      copyDirectory(source, "");
      this.writeFile(stagingDir, "SKILL.md", skillContent);
      return stagingDir;
    } catch (error) {
      this.cleanupStaging(stagingDir);
      throw error;
    }
  }

  listFinalPackages(): string[] {
    const packages: string[] = [];
    const visit = (directory: string, prefix: string): void => {
      const entries = readdirSync(directory, { withFileTypes: true });
      if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
        packages.push(prefix);
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        visit(join(directory, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    };
    visit(this.packagesRoot, "");
    return packages.sort();
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

  recoverArchivedPackage(archivePath: string, packagePath: string): void {
    this.recoverPackageLocation(this.packagesRoot, packagePath, this.archiveRoot, archivePath);
  }

  recoverRestoredPackage(packagePath: string, archivePath: string): void {
    this.recoverPackageLocation(this.archiveRoot, archivePath, this.packagesRoot, packagePath);
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

  private cleanupEmptyPackageParents(directory: string, root: string): void {
    try {
      this.removeEmptyPackageParents(directory, root);
    } catch {
      // The authoritative rename already completed; empty parent removal is cosmetic.
    }
  }

  private removeEmptyPackageParents(directory: string, root: string): void {
    let current = directory;
    while (current !== root) {
      if (readdirSync(current).length !== 0) return;
      rmdirSync(current);
      current = dirname(current);
    }
  }

  private recoverPackageLocation(
    desiredRoot: string,
    desiredPath: string,
    alternateRoot: string,
    alternatePath: string,
  ): void {
    const desired = this.resolvePackagePath(desiredRoot, desiredPath);
    const alternate = this.resolvePackagePath(alternateRoot, alternatePath);
    const desiredExists = existsSync(desired);
    const alternateExists = existsSync(alternate);
    if (desiredExists && !alternateExists) return;
    if (!desiredExists && alternateExists) {
      const source = this.resolveExistingPackagePath(alternateRoot, alternatePath);
      const target = this.preparePackageTarget(desiredRoot, desiredPath);
      renameSync(source, target);
      return;
    }
    throw new Error("package recovery state is ambiguous");
  }

  private resolvePackagePath(root: string, packagePath: string): string {
    const normalizedPath = normalizeSkillPackagePath(packagePath);
    const target = join(root, ...normalizedPath.split("/"));
    const pathRelative = relative(root, target);
    if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
      throw new Error("package path escapes its owned root");
    }
    return target;
  }

  private resolveOwnedStagingPath(stagingDir: string): string {
    const resolvedStaging = resolve(stagingDir);
    if (dirname(resolvedStaging) !== this.stagingRoot || !resolvedStaging.startsWith(join(this.stagingRoot, "stage-"))) {
      throw new Error("staging directory is not owned by this package store");
    }
    return resolvedStaging;
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
