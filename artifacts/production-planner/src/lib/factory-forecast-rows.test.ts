import { describe, it, expect } from "vitest";
import { DEFAULT_PLAN_MARGIN } from "@workspace/plan-margin";
import { DEFAULT_FACTORY_THRESHOLDS } from "@workspace/stock-prediction";
import { toForecastRows, planFactoryForecast, applyBatchChanges, type ForecastPlanRow } from "./factory-forecast-rows";

const row = (o: Partial<ForecastPlanRow> & { id: string; recipeId: number }): ForecastPlanRow => ({
  recipeName: o.id, included: true, batchesTarget: 10, packsPerBatch: 5, packSize: 2, eightPackBagCount: 0,
  estimatedFactoryNumber: 0, dispatch2Qty: 0, dispatch3Qty: 0, ...o,
});
const categories: Record<number, string> = { 1: "Calzones", 2: "Calzones", 3: "Macaroni Cheese", 4: "Fried Chicken" };
const ctx = { categoryOf: (id: number) => categories[id], shares: { 1: 0.25, 2: 0.75 }, margin: DEFAULT_PLAN_MARGIN };

describe("toForecastRows", () => {
  it("keeps the calzone line only, and takes the margin floor from the D2 + D3 orders", () => {
    const rows = toForecastRows([
      row({ id: "a", recipeId: 1, estimatedFactoryNumber: 10, dispatch2Qty: 20, dispatch3Qty: 12, eightPackBagCount: 2 }),
      row({ id: "m", recipeId: 3 }),
      row({ id: "f", recipeId: 4 }),
    ], ctx);
    expect(rows.map(r => r.key)).toEqual(["a"]);
    // 2 bags = 8 packs; stock for the margin 10 − 8 = 2; 32 orders − 2 = 30 → 6 batches,
    // margin 2 → 34 − 2 = 32 → 7 batches.
    expect(rows[0]).toMatchObject({ bagPacks: 8, despatchPacks: 20, salesShare: 0.25, floorBatches: 7 });
  });
});

describe("planFactoryForecast", () => {
  it("recommends fewer batches from the recipe with most cover, and applies them", () => {
    const items = [
      row({ id: "a", recipeId: 1, estimatedFactoryNumber: 700, batchesTarget: 20 }), // 800 left, 25% of sales
      row({ id: "b", recipeId: 2, estimatedFactoryNumber: 200, batchesTarget: 20 }), // 300 left, 75%
    ];
    const r = planFactoryForecast(items, ctx, { latePacks: 0, low: 0, high: 0 }, DEFAULT_FACTORY_THRESHOLDS);
    expect(r.forecast.predictedEnd).toBe(1100);
    expect(r.forecast.band).toBe("above");
    expect(r.needsConfirm).toBe(false);
    expect(r.recommendation!.changes).toEqual([{ key: "a", recipeName: "a", from: 20, to: 0 }]);
    const applied = applyBatchChanges(items, r.recommendation!);
    expect(applied.map(i => i.batchesTarget)).toEqual([0, 20]);
  });

  it("asks for a second tap when the forecast is at the freezing line", () => {
    const r = planFactoryForecast([row({ id: "a", recipeId: 1, estimatedFactoryNumber: 1500, batchesTarget: 0 })], ctx,
      { latePacks: 0, low: 0, high: 0 }, DEFAULT_FACTORY_THRESHOLDS);
    expect(r.needsConfirm).toBe(true);
  });
});
