import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteImageCache } from "../src/services/remote-image-cache.ts";

const tempDirs: string[] = [];

function tempImagesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "youban-image-cache-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("RemoteImageCache", () => {
  it("downloads a valid image atomically and reuses it on later requests", async () => {
    const imagesDir = tempImagesDir();
    const body = new Uint8Array(2_048).fill(7);
    let remoteLookups = 0;
    let downloads = 0;
    const cache = new RemoteImageCache({
      imagesDir,
      fetch: async () => {
        downloads += 1;
        return new Response(body, { headers: { "content-type": "image/jpeg" } });
      },
    });
    const lookup = async () => {
      remoteLookups += 1;
      return "https://images.example/poi.jpg";
    };

    const first = await cache.resolve("杭州:西湖", lookup);
    const second = await cache.resolve("杭州:西湖", lookup);
    const digest = createHash("md5").update("杭州:西湖", "utf8").digest("hex").slice(0, 16);

    expect(first).toBe(`/api/images/${digest}.jpg`);
    expect(second).toBe(first);
    expect(remoteLookups).toBe(1);
    expect(downloads).toBe(1);
    expect(readFileSync(join(imagesDir, `${digest}.jpg`))).toEqual(Buffer.from(body));
    expect(readdirSync(imagesDir)).toEqual([`${digest}.jpg`]);
  });

  it("deduplicates concurrent misses for the same image key", async () => {
    const imagesDir = tempImagesDir();
    let remoteLookups = 0;
    let downloads = 0;
    const cache = new RemoteImageCache({
      imagesDir,
      fetch: async () => {
        downloads += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(new Uint8Array(2_048), {
          headers: { "content-type": "image/png" },
        });
      },
    });
    const lookup = async () => {
      remoteLookups += 1;
      return "https://images.example/poi.png";
    };

    const results = await Promise.all([
      cache.resolve("三亚:亚龙湾", lookup),
      cache.resolve("三亚:亚龙湾", lookup),
      cache.resolve("三亚:亚龙湾", lookup),
    ]);

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toMatch(/^\/api\/images\/[a-f0-9]{16}\.png$/);
    expect(remoteLookups).toBe(1);
    expect(downloads).toBe(1);
  });

  it("returns the remote URL without leaving partial files when validation fails", async () => {
    const imagesDir = tempImagesDir();
    const remoteUrl = "https://images.example/not-an-image";
    const cache = new RemoteImageCache({
      imagesDir,
      fetch: async () => new Response("upstream error", {
        headers: { "content-type": "text/plain" },
      }),
    });

    expect(await cache.resolve("北京:故宫", async () => remoteUrl)).toBe(remoteUrl);
    expect(readdirSync(imagesDir)).toEqual([]);
  });

  it("degrades a failed source lookup to an empty image without writing files", async () => {
    const imagesDir = tempImagesDir();
    const cache = new RemoteImageCache({ imagesDir });

    expect(await cache.resolve("上海:外滩", async () => {
      throw new Error("photo source unavailable");
    })).toBe("");
    expect(readdirSync(imagesDir)).toEqual([]);
  });
});
