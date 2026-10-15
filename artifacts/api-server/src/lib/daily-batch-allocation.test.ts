import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY } from "@workspace/production-schedule";
import { allocateDailyBatches, largestRemainderRound, orderFloorBatches, type AllocationRecipe } from "./daily-batch-allocation";

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

  // Regression (15 Oct 2026): a test product with no DPT weight got its
  // shortfall as a fraction (32 packs ÷ 5 = 6.4 batches) and the rounding
  // handed the .4 to a core recipe — Properoni Chicken & Chorizo was planned
  // at 6 batches (30 packs) for 32 packs of orders.
  it("covers a weight-0 recipe's orders + margin in whole batches", () => {
    const margin = { smallMarginPacks: 2, largeMarginPacks: 4, largeBatchThreshold: 12 };
    const test = { dispatch2Qty: 0, dispatch3Qty: 32, estimatedFactoryNumber: 0, packsPerBatch: 5 };
    const floor = orderFloorBatches(test, margin);
    expect(floor).toBe(7);
    const recipes = [
      calzone({ weight: 70, proj: 40 }), calzone({ weight: 30, proj: 12 }),
      calzone({ weight: 0, proj: -32, deficitBatches: 7, floorBatches: floor }),
    ];
    const a = allocateDailyBatches(recipes, 40);
    expect(a.suggestedBatches[2]).toBe(7);
    expect(sum(a.suggestedBatches)).toBe(40);
    // Even without a margin floor passed, the whole-batch deficit is the floor.
    const noMargin = allocateDailyBatches(recipes.map(r => ({ ...r, floorBatches: undefined })), 40);
    expect(noMargin.suggestedBatches[2]).toBeGreaterThanOrEqual(7);
  });

  it("the chilled / test-product suggestion is orders + margin, net of stock and bags", () => {
    const margin = { smallMarginPacks: 2, largeMarginPacks: 4, largeBatchThreshold: 12 };
    expect(orderFloorBatches({ dispatch2Qty: 0, dispatch3Qty: 25, estimatedFactoryNumber: 0, packsPerBatch: 5 }, margin)).toBe(6);
    expect(orderFloorBatches({ dispatch2Qty: 30, dispatch3Qty: 48, estimatedFactoryNumber: 0, packsPerBatch: 5 }, margin)).toBe(17);
    expect(orderFloorBatches({ dispatch2Qty: 10, dispatch3Qty: 22, estimatedFactoryNumber: 20, bagPackEquivalents: 8, packsPerBatch: 5 }, margin)).toBe(5);
    expect(orderFloorBatches({ dispatch2Qty: 0, dispatch3Qty: 0, estimatedFactoryNumber: 0, packsPerBatch: 5 }, margin)).toBe(0);
  });

  it("gives a separate-facility row nothing even when every weight is zero", () => {
    const a = allocateDailyBatches([
      { category: FRIED_CHICKEN_CATEGORY, weight: 0, ppb: 1, proj: 0, deficitBatches: 0 },
      calzone({ weight: 0 }),
    ], 3);
    expect(a.suggestedBatches[0]).toBe(0);
  });
});
