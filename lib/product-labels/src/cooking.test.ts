import { describe, it, expect } from "vitest";
import { cookingPlaceholderValues, halveRange } from "./cooking";

describe("halving cooking times (turn over halfway)", () => {
  it("oven 18–22 → 9–11 then 9–11", () => {
    expect(halveRange(18, 22)).toEqual({ first: [9, 11], second: [9, 11] });
  });
  it("air fryer 16–19 → 8–9 then 8–10", () => {
    expect(halveRange(16, 19)).toEqual({ first: [8, 9], second: [8, 10] });
  });
  it("the halves always add up to the totals", () => {
    for (let min = 1; min <= 40; min++) for (let max = min; max <= 45; max++) {
      const h = halveRange(min, max)!;
      expect(h.first[0] + h.second[0]).toBe(min);
      expect(h.first[1] + h.second[1]).toBe(max);
      expect(h.first[0]).toBeLessThanOrEqual(h.first[1]);
      expect(h.second[0]).toBeLessThanOrEqual(h.second[1]);
    }
  });
  it("blank times give no halves", () => {
    expect(halveRange(null, 22)).toBeNull();
    expect(halveRange(18, null)).toBeNull();
  });
  it("fills every placeholder; a blank air fryer leaves its halves blank", () => {
    const v = cookingPlaceholderValues({
      ovenTempC: 210, fanTempC: 190, ovenMinMinutes: 18, ovenMaxMinutes: 22,
      airFryerTempC: 180, airFryerMinMinutes: null, airFryerMaxMinutes: null,
    });
    expect(v).toMatchObject({ ovenHalfMin: 9, ovenHalfMax: 11, ovenHalf2Min: 9, ovenHalf2Max: 11, airHalfMin: null, airHalf2Max: null });
  });
});
