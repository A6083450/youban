import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WechatAvatarImporter } from "../src/services/wechat-avatar-import.ts";

const tempDirs: string[] = [];

function tempAvatarsDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "youban-wechat-avatar-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("WechatAvatarImporter", () => {
  it("atomically imports a validated WeChat JPEG", async () => {
    const avatarsDir = tempAvatarsDir();
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xdb,
      ...new Array(64).fill(0),
      0xff, 0xd9,
    ]);
    const importer = new WechatAvatarImporter({
      avatarsDir,
      fetch: async () => new Response(jpeg, {
        headers: { "content-type": "image/jpeg" },
      }),
    });

    const fileName = await importer.import("https://thirdwx.qlogo.cn/avatar.jpg");

    expect(fileName).toMatch(/^[a-f0-9]{32}\.jpg$/);
    expect(readFileSync(join(avatarsDir, fileName!))).toEqual(Buffer.from(jpeg));
    expect(readdirSync(avatarsDir)).toEqual([fileName!]);
  });

  it("rejects non-HTTPS and mismatched image content without writing files", async () => {
    const avatarsDir = tempAvatarsDir();
    let fetchCalls = 0;
    const importer = new WechatAvatarImporter({
      avatarsDir,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
          headers: { "content-type": "image/jpeg" },
        });
      },
    });

    expect(await importer.import("http://thirdwx.qlogo.cn/avatar.jpg")).toBeNull();
    expect(fetchCalls).toBe(0);
    expect(await importer.import("https://thirdwx.qlogo.cn/avatar.jpg")).toBeNull();
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it("uses the verified PNG and WebP signatures for file extensions", async () => {
    const avatarsDir = tempAvatarsDir();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const webp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    let calls = 0;
    const importer = new WechatAvatarImporter({
      avatarsDir,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response(png, { headers: { "content-type": "image/png" } })
          : new Response(webp, { headers: { "content-type": "image/webp" } });
      },
    });

    expect(await importer.import("https://thirdwx.qlogo.cn/avatar.png")).toMatch(/\.png$/);
    expect(await importer.import("https://thirdwx.qlogo.cn/avatar.webp")).toMatch(/\.webp$/);
    expect(readdirSync(avatarsDir)).toHaveLength(2);
  });

  it("rejects unsupported MIME types and failed HTTP responses", async () => {
    const avatarsDir = tempAvatarsDir();
    let calls = 0;
    const importer = new WechatAvatarImporter({
      avatarsDir,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
              headers: { "content-type": "text/plain" },
            })
          : new Response("upstream unavailable", {
              status: 503,
              headers: { "content-type": "image/jpeg" },
            });
      },
    });

    expect(await importer.import("https://thirdwx.qlogo.cn/plain.jpg")).toBeNull();
    expect(await importer.import("https://thirdwx.qlogo.cn/unavailable.jpg")).toBeNull();
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it("rejects oversized declared and actual bodies without partial files", async () => {
    const avatarsDir = tempAvatarsDir();
    const maximumBytes = 128;
    let calls = 0;
    const importer = new WechatAvatarImporter({
      avatarsDir,
      maximumBytes,
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
            headers: {
              "content-type": "image/jpeg",
              "content-length": String(maximumBytes + 1),
            },
          });
        }
        const body = new Uint8Array(maximumBytes + 1);
        body.set([0xff, 0xd8, 0xff]);
        return new Response(body, { headers: { "content-type": "image/jpeg" } });
      },
    });

    expect(await importer.import("https://thirdwx.qlogo.cn/declared.jpg")).toBeNull();
    expect(await importer.import("https://thirdwx.qlogo.cn/actual.jpg")).toBeNull();
    expect(readdirSync(avatarsDir)).toEqual([]);
  });

  it("degrades fetch failures to no avatar without partial files", async () => {
    const avatarsDir = tempAvatarsDir();
    const importer = new WechatAvatarImporter({
      avatarsDir,
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(await importer.import("https://thirdwx.qlogo.cn/avatar.jpg")).toBeNull();
    expect(readdirSync(avatarsDir)).toEqual([]);
  });
});
