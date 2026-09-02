import { describe, expect, it } from "bun:test";
import {
  SkillValidationError,
  validateSkillDocument,
} from "../src/agents/skill-document.ts";

function skill(name = "museum-guide", description = "A practical museum visit guide.", body = "# Museum guide\n"): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

function expectValidationCode(content: string, code: string, expectedName?: string): void {
  expect(() => validateSkillDocument(content, expectedName)).toThrowError(
    expect.objectContaining({ code }),
  );
}

describe("validateSkillDocument", () => {
  it("normalizes valid UTF-8 line endings before persisting and hashing", () => {
    const document = validateSkillDocument(
      "---\r\nname: museum-guide\r\ndescription: A practical museum visit guide.\r\n---\r\n\r\n# Museum guide\r\n",
      "museum-guide",
    );

    expect(document).toEqual({
      name: "museum-guide",
      description: "A practical museum visit guide.",
      content: skill(),
      sha256: "76b9c6b40a8eb31e9fc99bb70e60ad12d1f9b62b2b23e467b1660062cff3acdc",
    });
  });

  it("rejects missing frontmatter", () => {
    expectValidationCode("# Museum guide\n", "invalid_skill_frontmatter");
  });

  it("rejects malformed YAML frontmatter", () => {
    expectValidationCode("---\nname: [museum-guide\n---\n", "invalid_skill_frontmatter");
  });

  it("rejects aliases, custom tags, and multiple YAML documents", () => {
    expectValidationCode("---\nname: &name museum-guide\ndescription: A guide.\n---\n", "invalid_skill_frontmatter");
    expectValidationCode("---\nname: !custom museum-guide\ndescription: A guide.\n---\n", "invalid_skill_frontmatter");
    expectValidationCode("---\nname: museum-guide\ndescription: A guide.\n---\n---\nname: other\n", "invalid_skill_frontmatter");
    expectValidationCode("---\nname: museum-guide\ndescription: A guide.\n---\n---\n# extra YAML document\nname: other\n", "invalid_skill_frontmatter");
  });

  it("rejects names outside the stable slug format", () => {
    expectValidationCode(skill("Museum Guide"), "invalid_skill_name");
    expectValidationCode(skill("museum--guide"), "invalid_skill_name");
  });

  it("rejects a frontmatter name that differs from the installed name", () => {
    expect(() => validateSkillDocument(skill("other-name"), "museum-guide"))
      .toThrowError(expect.objectContaining({ code: "skill_name_mismatch" }));
  });

  it("rejects blank, non-string, and oversized descriptions", () => {
    expectValidationCode(skill("museum-guide", "   "), "invalid_skill_description");
    expectValidationCode("---\nname: museum-guide\ndescription: 1\n---\n", "invalid_skill_description");
    expectValidationCode(skill("museum-guide", "x".repeat(501)), "invalid_skill_description");
  });

  it("rejects documents larger than 256 KiB by UTF-8 byte length", () => {
    expectValidationCode(skill("museum-guide", "A guide.", "x".repeat(262_145)), "skill_document_too_large");
  });

  it("rejects a CRLF source over 256 KiB before line-ending normalization", () => {
    expectValidationCode(
      "---\r\nname: museum-guide\r\ndescription: A guide.\r\n---\r\n\r\n" + "x\r\n".repeat(100_000),
      "skill_document_too_large",
    );
  });

  it("exposes typed validation failures", () => {
    expect(() => validateSkillDocument("not a skill")).toThrow(SkillValidationError);
  });
});
