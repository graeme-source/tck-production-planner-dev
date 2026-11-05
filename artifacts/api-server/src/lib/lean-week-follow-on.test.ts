import { describe, expect, it } from "vitest";
import { followOnWeek, type PlanWeek } from "./lean-week-follow-on";

const week = (id: number, status = "locked", lessonCount = 5): PlanWeek => ({ id, status, lessonCount });

describe("followOnWeek", () => {
  const plan = [week(1), week(2), week(10, "draft"), week(11, "draft"), week(12, "draft")];

  it("carries on to the next week in the plan", () => {
    expect(followOnWeek(plan, 10, 1)?.id).toBe(11);
    expect(followOnWeek(plan, 10, 2)?.id).toBe(12);
  });

  it("wraps round to the start when the plan runs out", () => {
    expect(followOnWeek(plan, 10, 3)?.id).toBe(1);
  });

  it("steps over a week with no lessons written", () => {
    expect(followOnWeek([week(10, "draft"), week(11, "draft", 0), week(12, "draft")], 10, 1)?.id).toBe(12);
  });

  it("still starts from a pinned week that has no lessons", () => {
    expect(followOnWeek([week(1), week(10, "draft", 0), week(2)], 10, 1)?.id).toBe(2);
  });

  it("leaves it to the calendar when the pinned week isn't in the plan", () => {
    expect(followOnWeek(plan, 99, 1)).toBeNull();
  });
});
