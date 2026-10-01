import { describe, it, expect } from "vitest";
import { computeTargetFinish, applySavedBreakAnchors, BUILDING_TARGET_BATCHES_PER_HOUR } from "./target-finish";
import { formatClock } from "./index";

const START = 7 * 60 + 30; // 07:30
// Standard deductions: snack 15 + 7 allowance, lunch 35 + 7 allowance.
const BREAKS = [
  { id: "morning", anchorMinutes: 9 * 60 + 15, minutes: 22 },
  { id: "lunch", anchorMinutes: 12 * 60 + 15, minutes: 42 },
];

const finishAt = (batches: number, breaks = BREAKS) => {
  const r = computeTargetFinish({ batches, startMinutes: START, breaks });
  return r ? formatClock(r.finishMinutes) : null;
};

describe("computeTargetFinish — builders' target finish at 20 batches/hour", () => {
  it("defaults to 20 batches an hour", () => {
    expect(BUILDING_TARGET_BATCHES_PER_HOUR).toBe(20);
  });

  it("125 batches from 07:30: 375 min building + 22 snack + 42 lunch = 14:49", () => {
    const r = computeTargetFinish({ batches: 125, startMinutes: START, breaks: BREAKS })!;
    expect(r.buildMinutes).toBe(375);
    expect(r.breaksAdded).toEqual(["morning", "lunch"]);
    expect(formatClock(r.finishMinutes)).toBe("14:49");
  });

  it("128 batches → 14:58", () => {
    expect(finishAt(128)).toBe("14:58");
  });

  it("a plan that finishes before lunch doesn't get lunch added", () => {
    // 60 batches = 180 min → 10:30, + 22 snack = 10:52. Lunch (12:15) is after.
    const r = computeTargetFinish({ batches: 60, startMinutes: START, breaks: BREAKS })!;
    expect(r.breaksAdded).toEqual(["morning"]);
    expect(formatClock(r.finishMinutes)).toBe("10:52");
  });

  it("a tiny plan done before the snack gets no breaks", () => {
    expect(finishAt(20)).toBe("08:30");
  });

  it("the snack can push the finish past lunch, which then counts", () => {
    // 95 batches = 285 min → 12:15 exactly: lunch not yet started. The snack
    // pushes it to 12:37, so lunch falls inside the day after all.
    expect(finishAt(95)).toBe("13:19");
  });

  it("uses the plan's moved break anchors", () => {
    // Lunch dragged to 11:00: 70 batches = 210 min → 11:00 + 22 = 11:22, so
    // lunch (11:00) now falls before the finish.
    const moved = [BREAKS[0], { ...BREAKS[1], anchorMinutes: 11 * 60 }];
    expect(finishAt(70, moved)).toBe("12:04");
    expect(finishAt(70)).toBe("11:22");
  });

  it("rounds part-minutes and honours a different rate", () => {
    const r = computeTargetFinish({ batches: 7, startMinutes: START, breaks: [], ratePerHour: 20 })!;
    expect(r.buildMinutes).toBe(21);
    const fast = computeTargetFinish({ batches: 30, startMinutes: START, breaks: [], ratePerHour: 30 })!;
    expect(formatClock(fast.finishMinutes)).toBe("08:30");
  });

  it("returns null with nothing to build", () => {
    expect(computeTargetFinish({ batches: 0, startMinutes: START, breaks: BREAKS })).toBeNull();
    expect(computeTargetFinish({ batches: 10, startMinutes: START, breaks: BREAKS, ratePerHour: 0 })).toBeNull();
  });
});

describe("applySavedBreakAnchors", () => {
  it("overrides only the anchors that were saved", () => {
    const out = applySavedBreakAnchors(BREAKS, '{"morning":523}');
    expect(out[0].anchorMinutes).toBe(523);
    expect(out[1].anchorMinutes).toBe(12 * 60 + 15);
  });

  it("keeps the defaults on missing or malformed JSON", () => {
    expect(applySavedBreakAnchors(BREAKS, null)).toEqual(BREAKS);
    expect(applySavedBreakAnchors(BREAKS, "{nope")).toEqual(BREAKS);
    expect(applySavedBreakAnchors(BREAKS, '{"lunch":"noon"}')).toEqual(BREAKS);
  });
});
