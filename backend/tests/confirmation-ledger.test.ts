import { describe, expect, it } from "bun:test";
import { ConfirmationLedger } from "../src/domain/confirmation.ts";

const DRAFT = {
  city: "大理",
  cities: [{ city: "大理", days: 7 }],
  start_date: "2026-10-01",
  end_date: "2026-10-07",
  travel_days: 7,
  transportation: "公共交通",
  accommodation: "经济型酒店",
  preferences: ["自然风光", "休闲"],
  traveler_count: 2,
  room_count: 1,
  budget_amount: 3000,
  budget_basis: "group_total",
  free_text_input: "安排大理七天",
  origin_text: "国庆去大理",
  language: "zh-CN",
};

describe("ConfirmationLedger", () => {
  it("issues high-confidence tokens and consumes each exactly once", () => {
    const ledger = new ConfirmationLedger({ secret: Buffer.alloc(32, 7) });
    const decision = ledger.register(DRAFT, 0.92);
    expect(decision.decisionId).not.toBe("");
    expect(ledger.validate(decision.token, DRAFT)).toEqual({ valid: true, reason: "ok" });
    expect(ledger.consume(decision.token, DRAFT)).toEqual({ valid: true, reason: "ok" });
    expect(ledger.consume(decision.token, DRAFT)).toEqual({ valid: false, reason: "already_consumed" });
  });

  it("does not issue a token outside the confidence boundary", () => {
    const ledger = new ConfirmationLedger();
    for (const confidence of [Number.NaN, Infinity, -Infinity, 0.84, 1.01]) {
      expect(ledger.register(DRAFT, confidence)).toEqual({ decisionId: "", token: "" });
    }
  });

  it("binds every execution semantic while normalizing locale and numeric representation", () => {
    const ledger = new ConfirmationLedger({ secret: Buffer.alloc(32, 8) });
    const { token } = ledger.register(DRAFT, 0.95);
    expect(ledger.validate(token, {
      ...DRAFT,
      language: "zh_CN",
      traveler_count: 2.0,
      budget_amount: 3000.0,
      cities: [{ city: "大理", days: 7.0 }],
    })).toEqual({ valid: true, reason: "ok" });

    for (const [field, value] of [
      ["travel_days", 5],
      ["origin_text", "改去丽江"],
      ["traveler_count", 3],
      ["budget_amount", 5000],
      ["budget_basis", "per_person"],
    ] as const) {
      expect(ledger.validate(token, { ...DRAFT, [field]: value })).toEqual({
        valid: false,
        reason: "draft_mismatch",
      });
    }
  });

  it("expires at the exact deadline", () => {
    let now = 1_000_250;
    const ledger = new ConfirmationLedger({ now: () => now, secret: Buffer.alloc(32, 9) });
    const { token } = ledger.register(DRAFT, 0.95, 10);
    now = 1_010_250;
    expect(ledger.validate(token, DRAFT)).toEqual({ valid: false, reason: "expired" });
  });

  it("attests ready drafts without granting execution and binds the attestation to the draft", () => {
    const ledger = new ConfirmationLedger({ secret: Buffer.alloc(32, 10) });
    const token = ledger.attestReady(DRAFT);

    expect(token).not.toBe("");
    expect(ledger.validateReady(token, DRAFT)).toEqual({ valid: true, reason: "ok" });
    expect(ledger.validate(token, DRAFT).valid).toBeFalse();
    expect(ledger.validateReady(token, { ...DRAFT, travel_days: 5 })).toEqual({
      valid: false,
      reason: "draft_mismatch",
    });
  });

  it("expires ready-draft attestations at the exact deadline", () => {
    let now = 2_000_000;
    const ledger = new ConfirmationLedger({ now: () => now, secret: Buffer.alloc(32, 12) });
    const token = ledger.attestReady(DRAFT, 10);
    now = 2_010_000;

    expect(ledger.validateReady(token, DRAFT)).toEqual({ valid: false, reason: "expired" });
  });
});
