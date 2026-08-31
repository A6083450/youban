import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function imageExtension(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export interface WechatAvatarImporterOptions {
  avatarsDir: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maximumBytes?: number;
}

export class WechatAvatarImporter {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly maximumBytes: number;

  constructor(private readonly options: WechatAvatarImporterOptions) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maximumBytes = options.maximumBytes ?? 5 * 1024 * 1024;
    mkdirSync(options.avatarsDir, { recursive: true });
  }

  async import(avatarUrl: string): Promise<string | null> {
    let temporaryPath = "";
    try {
      const url = new URL(avatarUrl);
      if (url.protocol !== "https:") return null;
      const response = await this.fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      if (response.url && new URL(response.url).protocol !== "https:") return null;
      const contentType = String(response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const expectedExtension = MIME_EXTENSIONS.get(contentType);
      if (!expectedExtension) return null;
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > this.maximumBytes) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > this.maximumBytes) return null;
      const extension = imageExtension(bytes);
      if (!extension || extension !== expectedExtension) return null;
      const fileName = `${randomBytes(16).toString("hex")}.${extension}`;
      const targetPath = join(this.options.avatarsDir, fileName);
      temporaryPath = join(this.options.avatarsDir, `.${fileName}.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, targetPath);
      temporaryPath = "";
      return fileName;
    } catch {
      return null;
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
