import { describe, expect, it } from "vitest";
import { chickenOnPlan, itemGrossPacks, itemNetPacks, itemProgressPct, itemTinCount, planItemsTotals } from "./plan-items-totals";

describe("plan items totals (the Production Items table's figures)", () => {
  const items = [
    { recipeId: 1, recipeCategory: "Calzones", batchesTarget: 10, batchesComplete: 4, portionsPerBatch: 10, packSize: 2 },
    { recipeId: 2, recipeCategory: null, batchesTarget: 5, batchesComplete: 5 },
    { recipeId: 3, recipeCategory: "Macaroni Cheese", batchesTarget: 6, batchesComplete: 2, portionsPerBatch: 2, packSize: 2 },
    { recipeId: 4, recipeCategory: "Fried Chicken", batchesTarget: 40, batchesComplete: 12, portionsPerBatch: 1, packSize: 1 },
  ];

  it("splits calzone batches, mac packs and chicken bags, and keeps chicken out of the main totals", () => {
    expect(planItemsTotals(items)).toEqual({
      totalBatchesTarget: 21,
      totalBatchesComplete: 11,
      calzoneBatchesTarget: 15,
      macPacksTarget: 6,
      chickenBagsTarget: 40,
      chickenBagsComplete: 12,
      // 10×10/2 + 5×10/2 (defaults) + 6×2/2 — no chicken bags.
      totalPacks: 50 + 25 + 6,
    });
  });

  it("is all zeros for an empty plan", () => {
    expect(planItemsTotals([])).toEqual({
      totalBatchesTarget: 0, totalBatchesComplete: 0, calzoneBatchesTarget: 0,
      macPacksTarget: 0, chickenBagsTarget: 0, chickenBagsComplete: 0, totalPacks: 0,
    });
  });

  it("lists the fried chicken already on the plan with what's been made", () => {
    expect(chickenOnPlan(items)).toEqual([{ recipeId: 4, packs: 40, made: 12 }]);
  });

  it("takes 4 two-packs off the Packs figure per 8-pack bag, never below zero", () => {
    const row = { recipeId: 1, batchesTarget: 2, portionsPerBatch: 10, packSize: 2, eightPackBagCount: 1 };
    expect(itemGrossPacks(row)).toBe(10);
    expect(itemNetPacks(row)).toBe(6);
    expect(itemNetPacks({ ...row, eightPackBagCount: 5 })).toBe(0);
  });

  it("counts tins: rounded up, at least two over five batches, none without a tin rule", () => {
    expect(itemTinCount({ recipeId: 1, batchesTarget: 3, maxBatchesPerTin: 4 })).toBe(1);
    expect(itemTinCount({ recipeId: 1, batchesTarget: 6, maxBatchesPerTin: 10 })).toBe(2);
    expect(itemTinCount({ recipeId: 1, batchesTarget: 9, maxBatchesPerTin: 4 })).toBe(3);
    expect(itemTinCount({ recipeId: 1, batchesTarget: 3, maxBatchesPerTin: null })).toBeNull();
    expect(itemTinCount({ recipeId: 1, batchesTarget: 0, maxBatchesPerTin: 4 })).toBeNull();
  });

  it("rounds row progress and reads 0% with nothing planned", () => {
    expect(itemProgressPct({ recipeId: 1, batchesTarget: 3, batchesComplete: 1 })).toBe(33);
    expect(itemProgressPct({ recipeId: 1, batchesTarget: 0, batchesComplete: 0 })).toBe(0);
  });
});
