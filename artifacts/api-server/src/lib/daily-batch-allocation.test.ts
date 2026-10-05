import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY } from "@workspace/production-schedule";
import { allocateDailyBatches, largestRemainderRound, type AllocationRecipe } from "./daily-batch-allocation";

const calzone = (p: Partial<AllocationRecipe>): AllocationRecipe => ({
  category: "Calzones", weight: 50, ppb: 5, proj: 0, deficitBatches: 0, ...p,
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("largestRemainderRound", () => {
  it("rounds to integers that keep the total", () => {
    expect(largestRemainderRound([1.6, 1.3, 1.1], 4)).toEqual([2, 1, 1]);
  });
});

describe("allocateDailyBatches", () => {
  it("spends the whole day on the DPT split when nothing is short", () => {
    const a = allocateDailyBatches([calzone({ weight: 60 }), calzone({ weight: 40 })], 100);
    expect(a.suggestedBatches).toEqual([60, 40]);
    expect(sum(a.suggestedBatches)).toBe(100);
    expect(a.remainingCapacity).toBe(100);
  });

  it("scales the shortfalls pro-rata when capacity can't cover them", () => {
    const a = allocateDailyBatches([calzone({ proj: -500, deficitBatches: 100 }), calzone({ proj: -250, deficitBatches: 50 })], 90);
    expect(a.suggestedBatches).toEqual([60, 30]);
    expect(a.targetStockPacks).toEqual([null, null]);
    expect(a.totalDeficitBatches).toBe(150);
    expect(a.remainingCapacity).toBe(0);
  });

  // Regression (2026-10-05): fried chicken rides along in /calculate for its
  // stock; with no DPT weight its open orders still made a "gap", so it was
  // handed 42 of a 100-batch day on 7 Oct 2026.
  it("never gives fried chicken a share of the day or counts its deficit", () => {
    const fc = (proj: number): AllocationRecipe => ({ category: FRIED_CHICKEN_CATEGORY, weight: 0, ppb: 1, proj, deficitBatches: -proj });
    const recipes = [calzone({ weight: 60 }), fc(-21), calzone({ weight: 40 }), fc(-13)];
    const a = allocateDailyBatches(recipes, 100);
    expect(a.suggestedBatches).toEqual([60, 0, 40, 0]);
    expect(a.targetStockPacks[1]).toBeNull();
    expect(a.totalDeficitBatches).toBe(0);
    expect(a.remainingCapacity).toBe(100);

    const short = allocateDailyBatches([calzone({ proj: -1000, deficitBatches: 200 }), fc(-50)], 100);
    expect(short.suggestedBatches).toEqual([100, 0]);
  });

  it("gives a separate-facility row nothing even when every weight is zero", () => {
    const a = allocateDailyBatches([
      { category: FRIED_CHICKEN_CATEGORY, weight: 0, ppb: 1, proj: 0, deficitBatches: 0 },
      calzone({ weight: 0 }),
    ], 3);
    expect(a.suggestedBatches[0]).toBe(0);
  });
});
