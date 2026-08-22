import { createHash } from "node:crypto";
import { isAlias, isMap, isNode, isScalar, isSeq, parseAllDocuments } from "yaml";

const MAX_SKILL_DOCUMENT_BYTES = 256 * 1024;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SkillValidationErrorCode =
  | "invalid_skill_encoding"
  | "invalid_skill_frontmatter"
  | "invalid_skill_name"
  | "skill_name_mismatch"
  | "invalid_skill_description"
  | "skill_document_too_large";

export class SkillValidationError extends Error {
  constructor(public readonly code: SkillValidationErrorCode, message: string) {
    super(message);
    this.name = "SkillValidationError";
  }
}

export interface ValidatedSkillDocument {
  name: string;
  description: string;
  content: string;
  sha256: string;
}

function validationError(code: SkillValidationErrorCode, message: string): never {
  throw new SkillValidationError(code, message);
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function containsUnsafeYamlNode(node: unknown): boolean {
  if (!isNode(node)) return false;
  if (isAlias(node) || node.anchor || (node.tag !== undefined && !node.tag.startsWith("tag:yaml.org,2002:"))) {
    return true;
  }
  if (isMap(node)) {
    return node.items.some((item) =>
      containsUnsafeYamlNode(item.key) || containsUnsafeYamlNode(item.value)
    );
  }
  if (isSeq(node)) return node.items.some((item) => containsUnsafeYamlNode(item));
  return false;
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) validationError("invalid_skill_frontmatter", "skill document must begin with YAML frontmatter");
  if (/^---\n(?:[A-Za-z0-9_-]+:)/.test(content.slice(match[0].length))) {
    validationError("invalid_skill_frontmatter", "skill document frontmatter must not contain extra YAML documents");
  }

  const documents = parseAllDocuments(match[1], {
    customTags: [],
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (
    documents.length !== 1 ||
    documents[0].errors.length > 0 ||
    documents[0].warnings.length > 0 ||
    !isMap(documents[0].contents) ||
    containsUnsafeYamlNode(documents[0].contents)
  ) {
    validationError("invalid_skill_frontmatter", "skill document frontmatter must be one safe YAML mapping");
  }

  const nameNode = documents[0].get("name", true);
  const descriptionNode = documents[0].get("description", true);
  if (!isScalar(nameNode) || typeof nameNode.value !== "string") {
    validationError("invalid_skill_name", "skill frontmatter name must be a string");
  }
  if (!isScalar(descriptionNode) || typeof descriptionNode.value !== "string") {
    validationError("invalid_skill_description", "skill frontmatter description must be a string");
  }

  const name = nameNode.value;
  const description = descriptionNode.value.trim();
  if (!SKILL_NAME_PATTERN.test(name)) {
    validationError("invalid_skill_name", "skill frontmatter name must be a lowercase slug");
  }
  if (Array.from(description).length < 1 || Array.from(description).length > 500) {
    validationError("invalid_skill_description", "skill frontmatter description must contain 1 to 500 characters");
  }
  return { name, description };
}

export function validateSkillDocument(
  content: string,
  expectedName?: string,
): ValidatedSkillDocument {
  if (Buffer.from(content, "utf8").toString("utf8") !== content) {
    validationError("invalid_skill_encoding", "skill document must be valid UTF-8 text");
  }
  const normalizedContent = normalizeLineEndings(content);
  if (Buffer.byteLength(normalizedContent, "utf8") > MAX_SKILL_DOCUMENT_BYTES) {
    validationError("skill_document_too_large", "skill document must not exceed 256 KiB");
  }
  const { name, description } = parseFrontmatter(normalizedContent);
  if (expectedName !== undefined && name !== expectedName) {
    validationError("skill_name_mismatch", "skill frontmatter name does not match the installed name");
  }
  return {
    name,
    description,
    content: normalizedContent,
    sha256: createHash("sha256").update(normalizedContent, "utf8").digest("hex"),
  };
}
