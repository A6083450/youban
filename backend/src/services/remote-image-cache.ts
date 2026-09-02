import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type ImageFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RemoteImageCacheOptions {
  imagesDir: string;
  fetch?: ImageFetch;
  timeoutMs?: number;
  minimumBytes?: number;
  maximumBytes?: number;
}

export class RemoteImageCache {
  private readonly imagesDir: string;
  private readonly fetch: ImageFetch;
  private readonly timeoutMs: number;
  private readonly minimumBytes: number;
  private readonly maximumBytes: number;
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(options: RemoteImageCacheOptions) {
    this.imagesDir = options.imagesDir;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.minimumBytes = options.minimumBytes ?? 1_024;
    this.maximumBytes = options.maximumBytes ?? 12 * 1024 * 1024;
    mkdirSync(this.imagesDir, { recursive: true });
  }

  async resolve(cacheKey: string, lookupRemoteUrl: () => Promise<string>): Promise<string> {
    const digest = createHash("md5").update(cacheKey, "utf8").digest("hex").slice(0, 16);
    const cached = this.findCached(digest);
    if (cached) return cached;

    const active = this.inflight.get(digest);
    if (active) return active;

    const operation = this.resolveMiss(digest, lookupRemoteUrl).finally(() => {
      if (this.inflight.get(digest) === operation) this.inflight.delete(digest);
    });
    this.inflight.set(digest, operation);
    return operation;
  }

  private findCached(digest: string): string {
    for (const extension of CACHE_EXTENSIONS) {
      const fileName = `${digest}.${extension}`;
      try {
        if (existsSync(join(this.imagesDir, fileName)) && statSync(join(this.imagesDir, fileName)).size > 0) {
          return `/api/images/${fileName}`;
        }
      } catch {
        // Treat unreadable entries as misses so the source can recover them.
      }
    }
    return "";
  }

  private async resolveMiss(digest: string, lookupRemoteUrl: () => Promise<string>): Promise<string> {
    let remoteUrl: string;
    try {
      remoteUrl = String(await lookupRemoteUrl()).trim();
    } catch {
      return "";
    }
    if (!/^https?:\/\//i.test(remoteUrl)) return remoteUrl;

    let temporaryPath = "";
    try {
      const response = await this.fetch(remoteUrl, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return remoteUrl;

      const contentType = String(response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      const extension = CONTENT_TYPE_EXTENSIONS.get(contentType);
      if (!extension) return remoteUrl;

      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > this.maximumBytes) return remoteUrl;

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < this.minimumBytes || bytes.byteLength > this.maximumBytes) return remoteUrl;

      const fileName = `${digest}.${extension}`;
      const targetPath = join(this.imagesDir, fileName);
      temporaryPath = join(this.imagesDir, `.${fileName}.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, targetPath);
      temporaryPath = "";
      return `/api/images/${fileName}`;
    } catch {
      return remoteUrl;
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
