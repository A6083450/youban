import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { SkillPackageStore } from "../src/agents/skill-package-store.ts";
import { ZipSkillImporter } from "../src/agents/skill-zip-importer.ts";
import { createZipFixture, type ZipFixtureEntry } from "./helpers/zip-fixture.ts";

const validSkill = "---\nname: museum-guide\ndescription: A practical museum visit guide.\n---\n\n# Museum guide\n";
const temporaryRoots: string[] = [];

function createImporter(): { importer: ZipSkillImporter; root: string; escapePath: string } {
  const root = mkdtempSync(join(tmpdir(), "youban-skill-package-"));
  temporaryRoots.push(root);
  return {
    importer: new ZipSkillImporter(new SkillPackageStore(root)),
    root,
    escapePath: join(root, "staging", "escape"),
  };
}

async function expectZipCode(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ZipSkillImporter", () => {
  it.each([
    ["parent traversal", [{ name: "../escape/SKILL.md", content: validSkill }]],
    ["absolute path", [{ name: "/tmp/SKILL.md", content: validSkill }]],
    ["symlink", [{ name: "skill/SKILL.md", content: "target", mode: 0o120777 }]],
  ] satisfies readonly [string, readonly ZipFixtureEntry[]][])("rejects %s without escaping its generated staging directory", async (_label, entries) => {
    const { importer, escapePath } = createImporter();
    await expectZipCode(importer.stage(createZipFixture(entries)), "invalid_zip_entry");
    expect(existsSync(escapePath)).toBe(false);
  });

  it("accepts one root folder and returns an inert staged package", async () => {
    const { importer } = createImporter();
    const staged = await importer.stage(createZipFixture([
      { name: "museum-guide/SKILL.md", content: validSkill },
      { name: "museum-guide/scripts/run.sh", content: "exit 99", mode: 0o100755 },
    ]));

    expect(staged.document.name).toBe("museum-guide");
    expect(staged.files).toEqual(["SKILL.md", "scripts/run.sh"]);
    expect(statSync(join(staged.stagingDir, "scripts/run.sh")).mode & 0o111).toBe(0);
    expect(staged.source).toBe("upload");
    staged.cleanup();
    expect(existsSync(staged.stagingDir)).toBe(false);
  });

  it("rejects archives with more than 100 regular files before staging content", async () => {
    const { importer, root } = createImporter();
    const entries = Array.from({ length: 101 }, (_, index) => ({
      name: index === 0 ? "SKILL.md" : `files/${index}.txt`,
      content: index === 0 ? validSkill : "x",
    }));

    await expectZipCode(importer.stage(createZipFixture(entries)), "skill_package_too_large");
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("rejects declared uncompressed data over 10 MiB", async () => {
    const { importer, root } = createImporter();
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "data.bin", content: "x", compressionMethod: 8, declaredUncompressedSize: 10 * 1024 * 1024 + 1 },
    ])), "skill_package_too_large");
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("rejects a SKILL.md larger than 256 KiB before document validation", async () => {
    const { importer } = createImporter();
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill + "x".repeat(256 * 1024) },
    ])), "skill_package_too_large");
  });

  it("rejects encrypted entries and non-regular Unix file types", async () => {
    const { importer } = createImporter();
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill, encrypted: true },
    ])), "invalid_zip_entry");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "device", content: "", mode: 0o060600 },
    ])), "invalid_zip_entry");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "link", content: "target", mode: 0o120777, creator: 19 },
    ])), "invalid_zip_entry");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "hard-link", content: "target", extraFields: [{ id: 0x000d, data: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) }] },
    ])), "invalid_zip_entry");
  });

  it("accepts fixed-only UNIX timestamp and uid/gid metadata", async () => {
    const { importer } = createImporter();
    const staged = await importer.stage(createZipFixture([
      {
        name: "SKILL.md",
        content: validSkill,
        extraFields: [{ id: 0x000d, data: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }],
      },
    ]));
    expect(staged.document.name).toBe("museum-guide");
    staged.cleanup();
  });

  it("rejects directories carrying declared data", async () => {
    const { importer } = createImporter();
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      {
        name: "payload/",
        content: "x",
        mode: 0o040700,
        compressionMethod: 8,
        declaredUncompressedSize: 10 * 1024 * 1024 + 1,
      },
    ])), "invalid_zip_entry");
  });

  it.each([
    "C:skill/SKILL.md",
    "SKILL.md:payload",
    "CON/SKILL.md",
    "COM¹/SKILL.md",
    "COM²/SKILL.md",
    "COM³/SKILL.md",
    "LPT¹/SKILL.md",
    "LPT²/SKILL.md",
    "LPT³/SKILL.md",
    "docs/name. /SKILL.md",
    "docs/name /SKILL.md",
  ])(
    "rejects non-portable Windows path %s",
    async (name) => {
      const { importer } = createImporter();
      await expectZipCode(importer.stage(createZipFixture([{ name, content: validSkill }])), "invalid_zip_entry");
    },
  );

  it("rejects symlinked store roots before changing their target permissions", () => {
    const parent = mkdtempSync(join(tmpdir(), "youban-skill-store-parent-"));
    temporaryRoots.push(parent);
    const target = join(parent, "target");
    mkdirSync(target, { mode: 0o755 });
    chmodSync(target, 0o755);
    const linkedRoot = join(parent, "linked-root");
    symlinkSync(target, linkedRoot, "dir");

    expect(() => new SkillPackageStore(linkedRoot)).toThrow("package root is not a directory");
    expect(statSync(target).mode & 0o777).toBe(0o755);
  });

  it("creates a nested absent package root with contained store directories", () => {
    const parent = mkdtempSync(join(tmpdir(), "youban-skill-store-nested-"));
    temporaryRoots.push(parent);
    const store = new SkillPackageStore(join(parent, "missing", "ancestors", "packages"));

    expect(statSync(store.stagingRoot).isDirectory()).toBe(true);
    expect(statSync(store.packagesRoot).isDirectory()).toBe(true);
    expect(statSync(store.archiveRoot).isDirectory()).toBe(true);
  });

  it("rejects symlinked staging components before writing through them", () => {
    const root = mkdtempSync(join(tmpdir(), "youban-skill-store-component-"));
    const outside = mkdtempSync(join(tmpdir(), "youban-skill-store-outside-"));
    temporaryRoots.push(root, outside);
    const store = new SkillPackageStore(root);
    const stagingDir = store.createStagingDirectory();
    symlinkSync(outside, join(stagingDir, "scripts"), "dir");

    expect(() => store.writeFile(stagingDir, "scripts/run.sh", Buffer.from("exit 99"))).toThrow();
    expect(readdirSync(outside)).toEqual([]);
  });

  it("rejects duplicate normalized paths and invalid UTF-8 skill content", async () => {
    const { importer } = createImporter();
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "docs//readme.txt", content: "one" },
      { name: "docs/readme.txt", content: "two" },
    ])), "invalid_zip_entry");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: Buffer.from([0xff]) },
    ])), "invalid_skill_encoding");
  });

  it("requires exactly one root SKILL.md after optional common-directory stripping", async () => {
    const { importer } = createImporter();
    await expectZipCode(importer.stage(createZipFixture([{ name: "README.md", content: "none" }])), "invalid_skill_package");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "other/SKILL.md", content: validSkill },
    ])), "invalid_skill_package");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "one/SKILL.md", content: validSkill },
      { name: "two/README.md", content: "ambiguous" },
    ])), "invalid_skill_package");
  });

  it("removes only the failed operation staging directory after a stream error", async () => {
    const { importer, root } = createImporter();
    const existingPackage = join(root, "packages", "preserved");
    mkdirSync(existingPackage, { recursive: true });

    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      { name: "broken.bin", compressionMethod: 8, compressedContent: Buffer.from("not deflate"), declaredUncompressedSize: 4 },
    ])), "invalid_zip_archive");
    expect(existsSync(existingPackage)).toBe(true);
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("rejects decompressed data whose actual size exceeds the ZIP metadata", async () => {
    const { importer, root } = createImporter();
    const actualContent = Buffer.from("this entry is longer than its metadata");
    await expectZipCode(importer.stage(createZipFixture([
      { name: "SKILL.md", content: validSkill },
      {
        name: "mismatched.bin",
        content: actualContent,
        compressionMethod: 8,
        compressedContent: deflateRawSync(actualContent),
        declaredUncompressedSize: 2,
      },
    ])), "invalid_zip_archive");
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });
});
