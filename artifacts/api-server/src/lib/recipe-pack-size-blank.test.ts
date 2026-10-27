/**
 * A blank recipe pack size (migration 0286 — fried chicken, sold by weight)
 * must leave every kitchen and costing number exactly as pack size 1, which
 * is what those recipes held before. The database hands the maths the pack
 * size through recipePackSizeOrOne (COALESCE(pack_size, 1)) and TypeScript
 * through effectivePackSize, so the maths below sees the same input either
 * way. Objective B.
 */
import { describe, it, expect } from "vitest";
import { effectivePackSize } from "@workspace/units";
import { packsPerBatch, packsFromBatches, batchesForPacks } from "@workspace/production-schedule";
import { plannedProductionPacks } from "@workspace/stock-prediction";
import { batchesFor } from "./test-box-production";
import { builtBatchFraction } from "./stock-usage-rules";
import { bagPacks } from "./team-efficiency-day";
import { productPacks } from "./waste-cost";

// Fried chicken as it is in the live data: 1 portion per batch, recipe size 1.
const before = "1.0000"; // what pack_size held until migration 0286
const now = effectivePackSize(null); // blank, as the maths now reads it
const portionsPerBatch = 1;

describe("blank pack size behaves exactly as 1 (fried chicken)", () => {
  it("planning: packs per batch, packs from batches, batches for packs", () => {
    expect(packsPerBatch(portionsPerBatch, now)).toBe(packsPerBatch(portionsPerBatch, before));
    expect(packsFromBatches(12, portionsPerBatch, now)).toBe(packsFromBatches(12, portionsPerBatch, before));
    expect(batchesForPacks(30, portionsPerBatch, now)).toBe(batchesForPacks(30, portionsPerBatch, before));
    expect(plannedProductionPacks({ batchesTarget: 12, portionsPerBatch, packSize: now }))
      .toBe(plannedProductionPacks({ batchesTarget: 12, portionsPerBatch, packSize: before }));
  });

  it("test-box batches and built-batch stock usage", () => {
    const input = { packs: 40, portionsPerBatch, safetyBatch: true };
    expect(batchesFor({ ...input, packSize: now })).toEqual(batchesFor({ ...input, packSize: Number(before) }));
    expect(builtBatchFraction(null, portionsPerBatch, now)).toBe(builtBatchFraction(null, portionsPerBatch, Number(before)));
  });

  it("team efficiency and waste: bag and pack conversions", () => {
    expect(bagPacks(now)).toBe(bagPacks(Number(before)));
    expect(productPacks(3, "eight_pack_bag", now)).toBe(productPacks(3, "eight_pack_bag", Number(before)));
  });

  it("costing per pack: ingredient cost per portion × pack size", () => {
    // packIngredientCostOf (routes/recipes.ts) = raw cost ÷ servings × pack size.
    const costPerPortion = 4.2 / 1;
    expect(costPerPortion * now).toBe(costPerPortion * Number(before));
  });

  it("why the maths must never see a raw null: some fallbacks assume 2", () => {
    // The production-schedule fallback for a missing pack size is the calzone
    // 2-pack, so a raw null would halve fried chicken's packs. That's what
    // recipePackSizeOrOne / effectivePackSize prevent.
    expect(packsPerBatch(10, null)).not.toBe(packsPerBatch(10, before));
    expect(packsPerBatch(10, now)).toBe(packsPerBatch(10, before));
  });
});
