import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  TripHistoryItemSchema,
  TripTaskEventSchema,
  UserInfoSchema,
} from "../src/domain/schemas.ts";

describe("HTTP TypeBox DTO schemas", () => {
  it("accepts current frontend auth/history/task event shapes", () => {
    expect(Value.Check(UserInfoSchema, {
      user_id: "u1",
      nickname: "微信用户",
      avatar_url: "/api/avatars/0123456789abcdef0123456789abcdef.png",
      profile_complete: true,
    })).toBe(true);
    expect(Value.Check(TripHistoryItemSchema, {
      plan_id: "p1",
      task_id: "t1",
      status: "processing",
      user_id: "u1",
      city: "北京",
      cities: [],
      start_date: "2026-08-01",
      end_date: "2026-08-03",
      travel_days: 3,
      updated_at: "2026-08-01T00:00:00Z",
      overall_suggestions: "",
    })).toBe(true);
    expect(Value.Check(TripTaskEventSchema, {
      task_id: "t1",
      plan_id: "p1",
      status: "completed",
      stage: "completed",
      progress: 100,
      message: "完成",
      result: { data: { city: "北京" } },
    })).toBe(true);
  });

  it("rejects camelCase drift and unknown task stages", () => {
    expect(Value.Check(UserInfoSchema, { userId: "u1", nickname: "Neo" })).toBe(false);
    expect(Value.Check(TripTaskEventSchema, {
      task_id: "t1",
      plan_id: "p1",
      status: "processing",
      stage: "unknown",
      progress: 1,
      message: "处理中",
    })).toBe(false);
  });
});
