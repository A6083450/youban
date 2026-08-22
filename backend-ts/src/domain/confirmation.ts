import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DRAFT_FIELDS = [
  "city",
  "cities",
  "start_date",
  "end_date",
  "travel_days",
  "transportation",
  "accommodation",
  "preferences",
  "free_text_input",
  "origin_text",
  "language",
  "traveler_count",
  "room_count",
  "budget_amount",
  "budget_basis",
] as const;

export type ConfirmationReason =
  | "ok"
  | "invalid_token"
  | "invalid_signature"
  | "unknown_decision"
  | "already_consumed"
  | "expired"
  | "draft_mismatch";

interface LedgerEntry {
  decisionId: string;
  expiresAt: number;
  draftHash: string;
  consumed: boolean;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function canonicalDraft(raw: unknown): Record<string, unknown> {
  const draft = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const canonical: Record<string, unknown> = {};
  for (const field of DRAFT_FIELDS) {
    let value = draft[field];
    if (field === "cities" || field === "preferences") value = value || [];
    else if (value === undefined || value === null || value === "") value = null;
    canonical[field] = sortJson(value);
  }
  const language = String(draft.language ?? "").trim().replaceAll("_", "-").toLowerCase();
  canonical.language = language || null;
  return canonical;
}

function draftHash(draft: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalDraft(draft))).digest("hex");
}

export class ConfirmationLedger {
  private readonly secret: Buffer;
  private readonly now: () => number;
  private readonly entries = new Map<string, LedgerEntry>();

  constructor(options: { secret?: Buffer; now?: () => number } = {}) {
    this.secret = options.secret ?? randomBytes(32);
    this.now = options.now ?? Date.now;
  }

  register(draft: unknown, confidence: number, ttlSeconds = 600): { decisionId: string; token: string } {
    if (!Number.isFinite(confidence) || confidence < 0.85 || confidence > 1) {
      return { decisionId: "", token: "" };
    }
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (now >= entry.expiresAt && !entry.consumed) this.entries.delete(id);
    }
    const decisionId = crypto.randomUUID().replaceAll("-", "");
    const payload = {
      decision_id: decisionId,
      nonce: randomBytes(16).toString("base64url"),
      expires_at: now + ttlSeconds * 1_000,
      draft_hash: draftHash(draft),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.secret).update(encoded).digest("hex");
    this.entries.set(decisionId, {
      decisionId,
      expiresAt: payload.expires_at,
      draftHash: payload.draft_hash,
      consumed: false,
    });
    return { decisionId, token: `${encoded}.${signature}` };
  }

  validate(token: unknown, draft: unknown): { valid: boolean; reason: ConfirmationReason } {
    const decoded = this.decode(token);
    if (!decoded.payload) return { valid: false, reason: decoded.reason };
    const entry = this.entries.get(String(decoded.payload.decision_id ?? ""));
    if (!entry) return { valid: false, reason: "unknown_decision" };
    if (entry.consumed) return { valid: false, reason: "already_consumed" };
    if (this.now() >= entry.expiresAt) return { valid: false, reason: "expired" };
    if (entry.draftHash !== draftHash(draft)) return { valid: false, reason: "draft_mismatch" };
    return { valid: true, reason: "ok" };
  }

  consume(token: unknown, draft: unknown): { valid: boolean; reason: ConfirmationReason } {
    const result = this.validate(token, draft);
    if (!result.valid) return result;
    const decoded = this.decode(token).payload!;
    this.entries.get(String(decoded.decision_id))!.consumed = true;
    return result;
  }

  clear(): void {
    this.entries.clear();
  }

  private decode(token: unknown): {
    payload?: Record<string, unknown>;
    reason: ConfirmationReason;
  } {
    try {
      const [encoded, supplied, extra] = String(token ?? "").split(".");
      if (!encoded || !supplied || extra !== undefined) return { reason: "invalid_token" };
      const expected = createHmac("sha256", this.secret).update(encoded).digest();
      const actual = Buffer.from(supplied, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return { reason: "invalid_signature" };
      }
      const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { reason: "invalid_token" };
      return { payload: parsed as Record<string, unknown>, reason: "ok" };
    } catch {
      return { reason: "invalid_token" };
    }
  }
}
