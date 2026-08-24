import { describe, expect, it } from "bun:test";
import {
  fastPlanTriggerMs,
  planningDeadlineMs,
} from "../src/domain/planning-deadline.ts";

describe("planning deadline policy", () => {
  it("uses inclusive deadline bands and declines unsupported trip lengths", () => {
    expect([1, 7, 8, 15, 16, 30, 31].map(planningDeadlineMs))
      .toEqual([6_000, 6_000, 10_000, 10_000, 15_000, 15_000, null]);
  });

  it("triggers the local fast plan 500ms before each supported deadline", () => {
    expect([1, 7, 8, 15, 16, 30, 31].map(fastPlanTriggerMs))
      .toEqual([5_500, 5_500, 9_500, 9_500, 14_500, 14_500, null]);
  });
});
