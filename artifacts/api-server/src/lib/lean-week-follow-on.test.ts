import { describe, expect, it } from "vitest";
import { followOnWeek, plannedWeek, type PlanWeek } from "./lean-week-follow-on";

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

describe("plannedWeek", () => {
  // Live on 9 Nov 2026: 3S overview pinned, its other weeks and Leave it better
  // not written yet. The meeting wraps round to Seeing Waste, but the plan's
  // next week is still Sweep, and that's what the founder must write.
  const live = [week(5162), week(5170), week(5171, "draft"), week(5172, "draft", 0), week(5173, "draft", 0), week(5175, "draft", 0)];

  it("names the next week in the plan even when it isn't written", () => {
    expect(followOnWeek(live, 5171, 1)?.id).toBe(5162);
    expect(plannedWeek(live, 5171, 1)?.id).toBe(5172);
    expect(plannedWeek(live, 5171, 2)?.id).toBe(5173);
  });

  it("agrees with the meeting once the week is written", () => {
    const written = [week(1), week(10, "draft"), week(11, "draft")];
    expect(plannedWeek(written, 10, 1)?.id).toBe(followOnWeek(written, 10, 1)?.id);
  });

  it("wraps round the plan", () => {
    expect(plannedWeek(live, 5175, 1)?.id).toBe(5162);
  });

  it("leaves it to the calendar when the pinned week isn't in the plan", () => {
    expect(plannedWeek(live, 99, 1)).toBeNull();
  });
});
