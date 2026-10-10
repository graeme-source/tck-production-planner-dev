import { describe, it, expect } from "vitest";
import { collapseEqualRanges, cookingPlaceholderValues, formatRange, halveRange } from "./cooking";

describe("cooking halves: a fixed first half, the range on the second", () => {
  it("oven 18–22 → 10, then 8–12", () => {
    expect(halveRange(18, 22)).toEqual({ first: 10, second: [8, 12] });
  });
  it("air fryer 16–19 → 9 (half of 17.5 = 8.75, rounded), then 7–10", () => {
    expect(halveRange(16, 19)).toEqual({ first: 9, second: [7, 10] });
  });
  it("rounds half up: 15–15 (midpoint 15 → 7.5) → 8, then 7", () => {
    expect(halveRange(15, 15)).toEqual({ first: 8, second: [7, 7] });
  });
  it("the halves always add up to the stated range, the second never under 1", () => {
    for (let min = 2; min <= 45; min++) for (let max = min; max <= 60; max++) {
      const h = halveRange(min, max)!;
      expect(h.first + h.second[0]).toBe(min);
      expect(h.first + h.second[1]).toBe(max);
      expect(h.second[0]).toBeGreaterThanOrEqual(1);
      expect(h.first).toBeGreaterThanOrEqual(1);
    }
  });
  it("a short minimum caps the first half so the second is still a minute", () => {
    expect(halveRange(2, 30)).toEqual({ first: 1, second: [1, 29] });
  });
  it("no halves for blanks, totals under 2 minutes, or a backwards range", () => {
    expect(halveRange(null, 22)).toBeNull();
    expect(halveRange(1, 5)).toBeNull();
    expect(halveRange(22, 18)).toBeNull();
  });
});

describe("formatting", () => {
  it("a range with equal ends is one number", () => {
    expect(formatRange(8, 12)).toBe("8–12");
    expect(formatRange(7, 7)).toBe("7");
    expect(collapseEqualRanges("10–10 min ➜ TURN OVER ➜ 8–12 min")).toBe("10 min ➜ TURN OVER ➜ 8–12 min");
    expect(collapseEqualRanges("7–7 min, 210°C, 2.5–2.5")).toBe("7 min, 210°C, 2.5–2.5");
  });
  it("fill-ins: both first-half placeholders carry the fixed number; ready-made halves too", () => {
    const v = cookingPlaceholderValues({
      ovenTempC: 210, fanTempC: 190, ovenMinMinutes: 18, ovenMaxMinutes: 22,
      airFryerTempC: 180, airFryerMinMinutes: null, airFryerMaxMinutes: null,
    });
    expect(v).toMatchObject({ ovenHalfMin: 10, ovenHalfMax: 10, ovenHalf2Min: 8, ovenHalf2Max: 12, ovenFirst: "10", ovenSecond: "8–12", airHalfMin: null, airSecond: null });
  });
});
