import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_MARGIN } from "@workspace/plan-margin";
import { addMarginBatches, marginCheckForRow, marginWarningsForRows, type MarginPlanRow } from "./plan-margin-rows";

const row = (over: Partial<MarginPlanRow>): MarginPlanRow => ({
  id: "chilled-33", recipeName: "Test product", included: true, batchesTarget: 0,
  packsPerBatch: 5, packSize: 2, eightPackBagCount: 0, estimatedFactoryNumber: 0,
  dispatch2Qty: 0, dispatch3Qty: 0, ...over,
});

describe("plan rows → margin warnings (14 Oct 2026 plan 196)", () => {
  // All three Properoni orders were for Friday delivery = the plan's D3.
  const plan = [
    row({ id: "chilled-34", recipeName: "Properoni Carnizone", batchesTarget: 10, dispatch3Qty: 50 }),
    row({ id: "chilled-33", recipeName: "Properoni Chicken & Chorizo", batchesTarget: 6, dispatch3Qty: 32 }),
    row({ id: "chilled-35", recipeName: "Properoni Chilli Chorizo & Fior Di Latte", batchesTarget: 5, dispatch3Qty: 25 }),
    row({ id: "calc-1", recipeName: "Core recipe", batchesTarget: 11, estimatedFactoryNumber: 40, dispatch2Qty: 30, dispatch3Qty: 20 }),
  ];

  it("flags all three test products and none of the healthy rows", () => {
    const ws = marginWarningsForRows(plan, DEFAULT_PLAN_MARGIN);
    expect(ws.map(w => [w.key, w.check.status, w.check.batchesToAdd])).toEqual([
      ["chilled-33", "short", 1],
      ["chilled-34", "under-margin", 1],
      ["chilled-35", "under-margin", 1],
    ]);
    expect(ws[0].message).toBe("Short by 2: orders need 32 packs + 2 margin = 34 — you're making 30. Add 1 batch?");
  });

  it("demand is D2 + D3 and stock is net of 8-pack bags", () => {
    // 40 stock − 2 bags (8 packs) = 32; orders 30 + 2 margin = 32 → ok with 0 batches.
    expect(marginCheckForRow(row({ estimatedFactoryNumber: 40, eightPackBagCount: 2, dispatch2Qty: 10, dispatch3Qty: 20 }), DEFAULT_PLAN_MARGIN).status).toBe("ok");
    expect(marginCheckForRow(row({ estimatedFactoryNumber: 40, eightPackBagCount: 3, dispatch2Qty: 10, dispatch3Qty: 20 }), DEFAULT_PLAN_MARGIN).status).toBe("short");
  });

  it("Add all missing batches clears every warning", () => {
    const fixed = addMarginBatches(plan, marginWarningsForRows(plan, DEFAULT_PLAN_MARGIN));
    expect(fixed.map(r => r.batchesTarget)).toEqual([11, 7, 6, 11]);
    expect(marginWarningsForRows(fixed, DEFAULT_PLAN_MARGIN)).toEqual([]);
  });

  it("rows with no known orders and excluded rows are never listed", () => {
    expect(marginWarningsForRows([row({ batchesTarget: 0 }), row({ included: false, dispatch3Qty: 40 })], DEFAULT_PLAN_MARGIN)).toEqual([]);
  });
});
