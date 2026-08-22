import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ValidatedSkillDocument } from "./skill-document.ts";

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

function assertRelativePath(path: string): void {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    throw new Error("package path must be a non-empty relative path");
  }
  const segments = path.split(/[\\/]/);
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("package path must not contain traversal segments");
  }
}

function assertDirectory(path: string): void {
  if (!lstatSync(path).isDirectory()) throw new Error(`package root is not a directory: ${path}`);
}

export class SkillPackageStore {
  readonly stagingRoot: string;
  readonly packagesRoot: string;
  readonly archiveRoot: string;

  constructor(root: string) {
    const resolvedRoot = resolve(root);
    mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
    chmodSync(resolvedRoot, 0o700);
    assertDirectory(resolvedRoot);
    this.stagingRoot = this.createOwnedDirectory(resolvedRoot, "staging");
    this.packagesRoot = this.createOwnedDirectory(resolvedRoot, "packages");
    this.archiveRoot = this.createOwnedDirectory(resolvedRoot, "archive");
  }

  createStagingDirectory(): string {
    return mkdtempSync(join(this.stagingRoot, "stage-"));
  }

  createDirectory(stagingDir: string, packagePath: string): void {
    const target = this.resolveStagingPath(stagingDir, packagePath);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    chmodSync(target, 0o700);
  }

  writeFile(stagingDir: string, packagePath: string, content: Uint8Array): void {
    const target = this.resolveStagingPath(stagingDir, packagePath);
    const parent = dirname(target);
    this.assertContained(stagingDir, parent, true);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    chmodSync(parent, 0o700);
    writeFileSync(target, content, { mode: 0o600, flag: "wx" });
    chmodSync(target, 0o600);
  }

  cleanupStaging(stagingDir: string): void {
    this.assertStagingDirectory(stagingDir);
    rmSync(stagingDir, { recursive: true, force: true });
  }

  commitStaging(stagingDir: string, packagePath: string): string {
    this.assertStagingDirectory(stagingDir);
    const target = this.resolvePackagePath(this.packagesRoot, packagePath);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    renameSync(stagingDir, target);
    return target;
  }

  archivePackage(packagePath: string, archivePath: string): string {
    const source = this.resolvePackagePath(this.packagesRoot, packagePath);
    const target = this.resolvePackagePath(this.archiveRoot, archivePath);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    renameSync(source, target);
    return target;
  }

  restoreArchivedPackage(archivePath: string, packagePath: string): string {
    const source = this.resolvePackagePath(this.archiveRoot, archivePath);
    const target = this.resolvePackagePath(this.packagesRoot, packagePath);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    renameSync(source, target);
    return target;
  }

  private createOwnedDirectory(root: string, child: string): string {
    const directory = join(root, child);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    assertDirectory(directory);
    return directory;
  }

  private resolveStagingPath(stagingDir: string, packagePath: string): string {
    this.assertStagingDirectory(stagingDir);
    assertRelativePath(packagePath);
    const target = resolve(stagingDir, packagePath);
    this.assertContained(stagingDir, target);
    return target;
  }

  private resolvePackagePath(root: string, packagePath: string): string {
    assertRelativePath(packagePath);
    const target = resolve(root, packagePath);
    this.assertContained(root, target);
    return target;
  }

  private assertStagingDirectory(stagingDir: string): void {
    const resolved = resolve(stagingDir);
    if (dirname(resolved) !== this.stagingRoot || !lstatSync(resolved).isDirectory()) {
      throw new Error("staging directory is not owned by this package store");
    }
  }

  private assertContained(root: string, target: string, allowRoot = false): void {
    const pathRelative = relative(root, target);
    if ((!allowRoot && pathRelative === "") || pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
      throw new Error("package path escapes its owned root");
    }
  }
}
