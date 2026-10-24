import { describe, it, expect } from "vitest";
import { reviewDue } from "./todo-review";

// 24 Oct 2026 is BST (UTC+1): 07:00Z = 08:00 London.
const AT_0759 = new Date("2026-10-24T06:59:00Z");
const AT_0800 = new Date("2026-10-24T07:00:00Z");

describe("8am to-do review", () => {
  const on = { enabled: true, lastReviewedOn: null, snoozedUntil: null };
  it("not before 8am London, due from 8am", () => {
    expect(reviewDue(on, AT_0759)).toBe(false);
    expect(reviewDue(on, AT_0800)).toBe(true);
  });
  it("once a day: finished today means not due", () => {
    expect(reviewDue({ ...on, lastReviewedOn: "2026-10-24" }, AT_0800)).toBe(false);
    expect(reviewDue({ ...on, lastReviewedOn: "2026-10-23" }, AT_0800)).toBe(true);
  });
  it("snooze holds it back until it runs out", () => {
    expect(reviewDue({ ...on, snoozedUntil: new Date("2026-10-24T07:30:00Z") }, AT_0800)).toBe(false);
    expect(reviewDue({ ...on, snoozedUntil: new Date("2026-10-24T06:30:00Z") }, AT_0800)).toBe(true);
  });
  it("switched off is never due", () => {
    expect(reviewDue({ ...on, enabled: false }, AT_0800)).toBe(false);
  });
  it("winter time (GMT): 08:00Z is 8am", () => {
    expect(reviewDue(on, new Date("2026-12-01T07:59:00Z"))).toBe(false);
    expect(reviewDue(on, new Date("2026-12-01T08:00:00Z"))).toBe(true);
  });
});
