import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_MARGIN, batchesToCover, buildMarginWarnings, checkPlanMargin, describeMarginCheck,
  marginPacksFor, marginWarningsSignature, minBatchesForOrders, parsePlanMarginSettings, solveTargetAllocation,
  type AllocationPoolRow,
} from "./index";

const PPB = 5; // 10 calzones a batch ÷ 2 per pack

describe("the margin rule — round up, then at least 2 (or 4) packs over", () => {
  it("Graeme's worked example: 78 sold → 85 packs (17 batches)", () => {
    const r = minBatchesForOrders({ demandPacks: 78, packsPerBatch: PPB });
    expect(r).toEqual({ batches: 17, ordersBatches: 16, marginPacks: 4, requiredPacks: 82 });
    expect(r.batches * PPB).toBe(85);
  });

  it("the 14 Oct Properoni orders", () => {
    expect(minBatchesForOrders({ demandPacks: 50, packsPerBatch: PPB }).batches).toBe(11); // Carnizone: 50 + 2 → 55
    expect(minBatchesForOrders({ demandPacks: 32, packsPerBatch: PPB }).batches).toBe(7);  // Chicken & Chorizo: 32 + 2 → 35
    expect(minBatchesForOrders({ demandPacks: 25, packsPerBatch: PPB }).batches).toBe(6);  // Chilli Chorizo: 25 + 2 → 30
  });

  it("exactly enough with the margin needs no extra batch", () => {
    expect(minBatchesForOrders({ demandPacks: 28, packsPerBatch: PPB }).batches).toBe(6); // 30 = 28 + 2
    expect(minBatchesForOrders({ demandPacks: 23, packsPerBatch: PPB }).batches).toBe(5); // 25 = 23 + 2
    expect(minBatchesForOrders({ demandPacks: 24, packsPerBatch: PPB }).batches).toBe(6); // 26 > 25
  });

  it("the > 12 batch boundary is decided on the orders alone", () => {
    // 60 packs = exactly 12 batches → not over 12 → margin 2 → 62 → 13 batches
    expect(minBatchesForOrders({ demandPacks: 60, packsPerBatch: PPB })).toMatchObject({ ordersBatches: 12, marginPacks: 2, batches: 13 });
    // 61 packs = 13 batches → margin 4 → 65 → 13 batches
    expect(minBatchesForOrders({ demandPacks: 61, packsPerBatch: PPB })).toMatchObject({ ordersBatches: 13, marginPacks: 4, batches: 13 });
    // 62 → 13 batches of orders → 66 → 14 batches
    expect(minBatchesForOrders({ demandPacks: 62, packsPerBatch: PPB })).toMatchObject({ marginPacks: 4, batches: 14 });
    expect(marginPacksFor(12)).toBe(2);
    expect(marginPacksFor(13)).toBe(4);
  });

  it("stock in the fridge counts towards orders + margin", () => {
    expect(minBatchesForOrders({ demandPacks: 32, stockPacks: 40, packsPerBatch: PPB }).batches).toBe(0);
    expect(minBatchesForOrders({ demandPacks: 32, stockPacks: 33, packsPerBatch: PPB }).batches).toBe(1); // 33 < 34
    expect(minBatchesForOrders({ demandPacks: 32, stockPacks: 34, packsPerBatch: PPB }).batches).toBe(0);
    expect(minBatchesForOrders({ demandPacks: 32, stockPacks: 10, packsPerBatch: PPB }).batches).toBe(5); // 24 → 25
  });

  it("no orders → no batches and no margin", () => {
    expect(minBatchesForOrders({ demandPacks: 0, packsPerBatch: PPB })).toEqual({ batches: 0, ordersBatches: 0, marginPacks: 0, requiredPacks: 0 });
  });

  it("the numbers are settings", () => {
    const s = { smallMarginPacks: 5, largeMarginPacks: 10, largeBatchThreshold: 4 };
    expect(minBatchesForOrders({ demandPacks: 20, packsPerBatch: PPB }, s)).toMatchObject({ marginPacks: 5, batches: 5 });
    expect(minBatchesForOrders({ demandPacks: 21, packsPerBatch: PPB }, s)).toMatchObject({ marginPacks: 10, batches: 7 });
  });

  it("float dust never adds a batch", () => {
    expect(batchesToCover(50, 10 / 2.0000)).toBe(10);
    expect(batchesToCover(30, 10 / 3 * 3 / 2)).toBe(6);
  });

  it("settings parse with defaults for blanks and nonsense", () => {
    expect(parsePlanMarginSettings({})).toEqual(DEFAULT_PLAN_MARGIN);
    expect(parsePlanMarginSettings({ smallMarginPacks: "3", largeMarginPacks: "", largeBatchThreshold: "-1" }))
      .toEqual({ smallMarginPacks: 3, largeMarginPacks: 4, largeBatchThreshold: 12 });
    expect(parsePlanMarginSettings({ smallMarginPacks: "0" }).smallMarginPacks).toBe(0);
  });
});

describe("checking a planned batch count", () => {
  it("Chicken & Chorizo as planned on 14 Oct: short", () => {
    const c = checkPlanMargin({ demandPacks: 32, packsPerBatch: PPB, plannedBatches: 6 });
    expect(c).toMatchObject({ status: "short", plannedPacks: 30, requiredPacks: 34, missingPacks: 4, batchesToAdd: 1 });
    expect(describeMarginCheck(c)).toBe("Short by 2: orders need 32 packs + 2 margin = 34 — you're making 30. Add 1 batch?");
  });

  it("Chilli Chorizo planned at exactly the orders: under the margin", () => {
    const c = checkPlanMargin({ demandPacks: 25, packsPerBatch: PPB, plannedBatches: 5 });
    expect(c).toMatchObject({ status: "under-margin", batchesToAdd: 1 });
    expect(describeMarginCheck(c)).toBe("Orders need 25 packs + 2 margin = 27 — you're making 25. Add 1 batch?");
  });

  it("stock is spelled out", () => {
    const c = checkPlanMargin({ demandPacks: 30, stockPacks: 10, packsPerBatch: PPB, plannedBatches: 4 });
    expect(describeMarginCheck(c)).toBe("Orders need 30 packs + 2 margin = 32 — 10 in stock + 20 made = 30. Add 1 batch?");
  });

  it("enough with margin, or no orders → ok / no-orders and no message", () => {
    expect(checkPlanMargin({ demandPacks: 32, packsPerBatch: PPB, plannedBatches: 7 }).status).toBe("ok");
    expect(checkPlanMargin({ demandPacks: 0, packsPerBatch: PPB, plannedBatches: 0 }).status).toBe("no-orders");
    expect(describeMarginCheck(checkPlanMargin({ demandPacks: 32, packsPerBatch: PPB, plannedBatches: 7 }))).toBe("");
  });
});

describe("the warning list", () => {
  const row = (key: string, recipeName: string, demandPacks: number, plannedBatches: number, over: Partial<{ included: boolean; stockPacks: number }> = {}) =>
    ({ key, recipeName, demandPacks, plannedBatches, packsPerBatch: PPB, included: true, stockPacks: 0, ...over });

  it("lists every included recipe that is short or under the margin, short first", () => {
    const ws = buildMarginWarnings([
      row("a", "Properoni Carnizone", 50, 10),            // under margin
      row("b", "Properoni Chicken & Chorizo", 32, 6),     // short
      row("c", "Properoni Chilli Chorizo", 25, 5),        // under margin
      row("d", "Margherita", 40, 12),                     // fine
      row("e", "Excluded", 40, 0, { included: false }),   // not on the plan
      row("f", "No orders", 0, 0),                        // nothing known
    ]);
    expect(ws.map(w => [w.key, w.check.status])).toEqual([
      ["b", "short"], ["a", "under-margin"], ["c", "under-margin"],
    ]);
    expect(ws[1].message).toBe("Orders need 50 packs + 2 margin = 52 — you're making 50. Add 1 batch?");
  });

  it("the signature changes when a batch count changes", () => {
    const a = marginWarningsSignature(buildMarginWarnings([row("b", "C&C", 32, 5)]));
    const b = marginWarningsSignature(buildMarginWarnings([row("b", "C&C", 32, 6)]));
    expect(a).not.toBe(b);
  });
});

describe("batch allocation never rounds orders away", () => {
  // A 100-batch day like 14 Oct: eight core recipes with DPT weights and
  // healthy stock, plus the three test products (no DPT weight, orders only).
  const core: AllocationPoolRow[] = [
    { weight: 18, ppb: PPB, proj: 20, floorBatches: 0 },
    { weight: 17, ppb: PPB, proj: 35, floorBatches: 0 },
    { weight: 13, ppb: PPB, proj: 12, floorBatches: 0 },
    { weight: 12, ppb: PPB, proj: 25, floorBatches: 0 },
    { weight: 11, ppb: PPB, proj: 8, floorBatches: 0 },
    { weight: 10, ppb: PPB, proj: 30, floorBatches: 0 },
    { weight: 6, ppb: PPB, proj: 3, floorBatches: 0 },
    { weight: 4, ppb: PPB, proj: 14, floorBatches: 0 },
  ];
  const tests = (withFloors: boolean): AllocationPoolRow[] => [50, 32, 25].map(orders => ({
    weight: 0, ppb: PPB, proj: -orders,
    floorBatches: withFloors ? minBatchesForOrders({ demandPacks: orders, packsPerBatch: PPB }).batches : 0,
  }));

  it("REGRESSION 14 Oct: without whole-batch floors 32 packs became 6 batches", () => {
    const { batches } = solveTargetAllocation([...core, ...tests(false)], 100);
    // The old maths: 32 ÷ 5 = 6.4 batches, and the .4 went to a core recipe.
    expect(batches.slice(8)).toEqual([10, 6, 5]);
  });

  it("with the floors every test product gets orders + margin", () => {
    const { batches } = solveTargetAllocation([...core, ...tests(true)], 100);
    expect(batches.slice(8)).toEqual([11, 7, 6]);
    expect(batches.reduce((s, b) => s + b, 0)).toBe(100);
  });

  it("a core recipe never drops below its floor either", () => {
    const rows: AllocationPoolRow[] = [
      { weight: 90, ppb: PPB, proj: 200, floorBatches: 0 },
      { weight: 10, ppb: PPB, proj: -32, floorBatches: 7 },
    ];
    const { batches } = solveTargetAllocation(rows, 20);
    expect(batches[1]).toBeGreaterThanOrEqual(7);
    expect(batches[0] + batches[1]).toBe(20);
  });

  it("no surplus weight anywhere → just the floors (no stray batches)", () => {
    const { batches } = solveTargetAllocation(tests(true), 100);
    expect(batches).toEqual([11, 7, 6]);
  });

  it("floors bigger than the day are scaled to fit and flagged", () => {
    const r = solveTargetAllocation(tests(true), 12);
    expect(r.floorsExceedCapacity).toBe(true);
    expect(r.batches.reduce((s, b) => s + b, 0)).toBe(12);
  });

  it("ineligible rows (another kitchen) never take a batch", () => {
    const r = solveTargetAllocation([
      { weight: 50, ppb: PPB, proj: 0, floorBatches: 0 },
      { weight: 50, ppb: PPB, proj: -100, floorBatches: 30, eligible: false },
    ], 10);
    expect(r.batches).toEqual([10, 0]);
  });

  it("zero capacity → nothing", () => {
    expect(solveTargetAllocation(tests(true), 0).batches).toEqual([0, 0, 0]);
  });
});
