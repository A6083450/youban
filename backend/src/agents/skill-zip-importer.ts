import { isUtf8 } from "node:buffer";
import { type Entry, fromBuffer, type ZipFile } from "yauzl";
import { SkillValidationError, validateSkillDocument } from "./skill-document.ts";
import {
  normalizeSkillPackagePath,
  type SkillPackageStore,
  type StagedSkillPackage,
} from "./skill-package-store.ts";

const MAX_REGULAR_FILES = 100;
const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_DOCUMENT_BYTES = 256 * 1024;

export type SkillZipImportErrorCode =
  | "invalid_zip_archive"
  | "invalid_zip_entry"
  | "invalid_skill_package"
  | "skill_package_too_large";

export class SkillZipImportError extends Error {
  constructor(public readonly code: SkillZipImportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SkillZipImportError";
  }
}

interface ZipRecord {
  entry: Entry;
  archivePath: string;
  packagePath: string;
  directory: boolean;
}

function zipError(code: SkillZipImportErrorCode, message: string, cause?: unknown): never {
  throw new SkillZipImportError(code, message, cause === undefined ? undefined : { cause });
}

function decodePath(entry: Entry): string {
  if (!isUtf8(entry.fileNameRaw)) zipError("invalid_zip_entry", "ZIP entry filename is not valid UTF-8");
  const rawName = entry.fileNameRaw.toString("utf8");
  try {
    return normalizeSkillPackagePath(rawName);
  } catch {
    zipError("invalid_zip_entry", "ZIP entry filename is not a safe relative path");
  }
}

function entryIsDirectory(entry: Entry, archivePath: string): boolean {
  const unixMode = entry.externalFileAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  const pathSaysDirectory = entry.fileNameRaw.toString("utf8").endsWith("/");

  if (entry.extraFields.some((field) => field.id === 0x000d && field.data.length !== 12)) {
    zipError("invalid_zip_entry", `ZIP entry uses an unsupported Unix link encoding: ${archivePath}`);
  }
  if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
    zipError("invalid_zip_entry", `ZIP entry is not a regular file or directory: ${archivePath}`);
  }
  if (fileType === 0o040000) return true;
  if (pathSaysDirectory) {
    if (fileType === 0o100000) {
      zipError("invalid_zip_entry", `ZIP entry type conflicts with directory path: ${archivePath}`);
    }
    return true;
  }
  return false;
}

function openZip(bytes: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(Buffer.from(bytes), {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
      decodeStrings: false,
    }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("ZIP archive could not be opened"));
        return;
      }
      resolve(zip);
    });
  });
}

function collectEntries(zip: ZipFile, add: (entry: Entry) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      try {
        zip.close();
      } catch {
        // ZIP buffers need no resource cleanup; close only stops lazy iteration.
      }
      reject(error);
    };
    zip.once("error", fail);
    zip.once("end", () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    });
    zip.on("entry", (entry: Entry) => {
      if (finished) return;
      try {
        add(entry);
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });
}

function commonRoot(records: readonly ZipRecord[]): string | undefined {
  if (records.length === 0) return undefined;
  const firstSegment = records[0].archivePath.split("/")[0];
  if (!records.every(({ archivePath }) => archivePath.split("/")[0] === firstSegment)) return undefined;
  if (!records.every(({ archivePath, directory }) => archivePath.split("/").length > 1 || directory)) return undefined;
  return firstSegment;
}

function stagePath(archivePath: string, root: string | undefined): string {
  if (!root) return archivePath;
  const prefix = `${root}/`;
  return archivePath.startsWith(prefix) ? archivePath.slice(prefix.length) : "";
}

async function readEntry(zip: ZipFile, entry: Entry, maximumBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (openError, stream) => {
      if (openError || !stream) {
        reject(new SkillZipImportError("invalid_zip_archive", "ZIP entry stream could not be opened", { cause: openError }));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(error instanceof SkillZipImportError
          ? error
          : new SkillZipImportError("invalid_zip_archive", "ZIP entry stream could not be read safely", { cause: error }));
      };
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > maximumBytes || total > entry.uncompressedSize) {
          fail(new SkillZipImportError("invalid_zip_archive", "ZIP entry exceeds its declared size limit"));
          return;
        }
        chunks.push(bytes);
      });
      stream.once("error", fail);
      stream.once("end", () => {
        if (settled) return;
        settled = true;
        if (total !== entry.uncompressedSize) {
          reject(new SkillZipImportError("invalid_zip_archive", "ZIP entry actual size does not match its declared size"));
          return;
        }
        resolve(Buffer.concat(chunks, total));
      });
    });
  });
}

export class ZipSkillImporter {
  constructor(private readonly store: SkillPackageStore) {}

  async stage(bytes: Uint8Array): Promise<StagedSkillPackage> {
    let zip: ZipFile;
    try {
      zip = await openZip(bytes);
    } catch (error) {
      zipError("invalid_zip_archive", "upload is not a readable ZIP archive", error);
    }

    const records: ZipRecord[] = [];
    const normalizedNames = new Set<string>();
    let regularFileCount = 0;
    let declaredBytes = 0;
    try {
      await collectEntries(zip, (entry) => {
        const archivePath = decodePath(entry);
        if ((entry.generalPurposeBitFlag & 0x1) !== 0 || entry.isEncrypted()) {
          zipError("invalid_zip_entry", `encrypted ZIP entries are not accepted: ${archivePath}`);
        }
        if (!entry.canDecodeFileData() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
          zipError("invalid_zip_entry", `ZIP entry compression is not supported: ${archivePath}`);
        }
        if (normalizedNames.has(archivePath)) {
          zipError("invalid_zip_entry", `ZIP archive contains a duplicate path: ${archivePath}`);
        }
        normalizedNames.add(archivePath);
        const directory = entryIsDirectory(entry, archivePath);
        if (directory && (entry.uncompressedSize !== 0 || entry.compressedSize !== 0)) {
          zipError("invalid_zip_entry", `ZIP directory entry must not carry data: ${archivePath}`);
        }
        if (!directory) {
          regularFileCount += 1;
          declaredBytes += entry.uncompressedSize;
          if (regularFileCount > MAX_REGULAR_FILES || declaredBytes > MAX_UNCOMPRESSED_BYTES) {
            zipError("skill_package_too_large", "ZIP archive exceeds the package limits");
          }
        }
        records.push({ entry, archivePath, packagePath: "", directory });
      });
    } catch (error) {
      if (error instanceof SkillZipImportError) throw error;
      zipError("invalid_zip_archive", "ZIP archive metadata could not be read safely", error);
    }

    const root = commonRoot(records);
    for (const record of records) record.packagePath = stagePath(record.archivePath, root);
    const skillEntries = records.filter(({ directory, packagePath }) => !directory && packagePath === "SKILL.md");
    const allSkillDocuments = records.filter(({ directory, archivePath }) =>
      !directory && (archivePath.endsWith("/SKILL.md") || archivePath === "SKILL.md")
    );
    if (skillEntries.length !== 1 || allSkillDocuments.length !== 1) {
      zipError("invalid_skill_package", "ZIP archive must contain exactly one root SKILL.md");
    }

    const stagingDir = this.store.createStagingDirectory();
    try {
      let actualBytes = 0;
      let skillContent: Buffer | undefined;
      const files: string[] = [];
      for (const record of records) {
        if (!record.packagePath) continue;
        if (record.directory) {
          this.store.createDirectory(stagingDir, record.packagePath);
          continue;
        }
        const content = await readEntry(zip, record.entry, MAX_UNCOMPRESSED_BYTES - actualBytes);
        actualBytes += content.length;
        if (actualBytes > MAX_UNCOMPRESSED_BYTES) {
          zipError("skill_package_too_large", "ZIP archive exceeds the package limits");
        }
        if (record.packagePath === "SKILL.md") {
          if (content.length > MAX_SKILL_DOCUMENT_BYTES) {
            zipError("skill_package_too_large", "SKILL.md exceeds 256 KiB");
          }
          if (!isUtf8(content)) {
            throw new SkillValidationError("invalid_skill_encoding", "skill document must be valid UTF-8 text");
          }
          skillContent = content;
        }
        this.store.writeFile(stagingDir, record.packagePath, content);
        files.push(record.packagePath);
      }
      if (!skillContent) zipError("invalid_skill_package", "ZIP archive did not provide SKILL.md content");
      const document = validateSkillDocument(skillContent.toString("utf8"));
      const staged: StagedSkillPackage = {
        stagingDir,
        document,
        files,
        source: "upload",
        cleanup: () => this.store.cleanupStaging(stagingDir),
      };
      return staged;
    } catch (error) {
      this.store.cleanupStaging(stagingDir);
      throw error;
    }
  }
}
