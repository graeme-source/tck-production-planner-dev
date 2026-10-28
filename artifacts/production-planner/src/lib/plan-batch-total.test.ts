import { describe, it, expect } from "vitest";
import { DEFAULT_PLAN_MARGIN } from "@workspace/plan-margin";
import { suggestedBatchTotal } from "@workspace/stock-prediction";
import {
  allocateBatchesToTargets, allocRecipesFor, distributePlanTotal, rotaLine, rowsBatchTotal, type AllocResult, type TotalPlanRow,
} from "./plan-batch-total";
import { applySlowMeatCap, slowMeatCountForRows, type SlowMeatProfileData } from "./slow-meat-plan";

interface Row extends TotalPlanRow {
  recipeName: string;
  suggestedBatches: number;
  slowMeatCappedFrom?: number;
}

// The ten core calzones with their DPT packs (live split, Oct 2026).
const DPT: Array<[number, string, number]> = [
  [1, "Margherita", 268], [2, "Chicken and Chorizo", 263], [3, "BBQ Pulled Pork", 347],
  [4, "The Godfather", 250], [5, "Carnizone", 291], [6, "Balsamic Roasted Vegetables", 101],
  [8, "The Donald", 194], [9, "Chorizo Chilli", 130], [10, "Garlic Cheese", 193], [26, "Philly Cheesesteak", 288],
];
const row = (recipeId: number, recipeName: string, dpt: number, extra: Partial<Row> = {}): Row => ({
  id: `calc-${recipeId}`, recipeId, recipeName, included: true, isFromDpt: true,
  batchesTarget: 0, suggestedBatches: 0, dptPercent: dpt, salesPercent: dpt,
  deficitBatches: 0, packsPerBatch: 5, packSize: 2, eightPackBagCount: 0,
  estimatedFactoryNumber: 40, dispatch2Qty: 20, dispatch3Qty: 10, ...extra,
});
const core = (): Row[] => DPT.map(([id, name, dpt]) => row(id, name, dpt));
const apply = (r: Row, a: AllocResult): Row =>
  ({ ...r, batchesTarget: a.suggestedBatches, suggestedBatches: a.suggestedBatches, slowMeatCappedFrom: undefined });
const sum = (rows: Row[]) => rowsBatchTotal(rows);

describe("Create Plan: the typed total is the total the rows get (28 Oct 2026)", () => {
  it("110 typed over a suggestion of 98 (rota cap 100) is allocated in full", () => {
    // The suggestion the panel showed: 98, inside fewest 80 / cap 100.
    expect(suggestedBatchTotal({ currentTotal: 98, cap: 100, minBatchesPerDay: 80, change: 0 })).toBe(98);
    const rows = distributePlanTotal(core(), 110, DEFAULT_PLAN_MARGIN, { apply });
    expect(sum(rows)).toBe(110);
    // Neither the suggestion nor the rota cap holds it back.
    expect(sum(rows)).toBeGreaterThan(100);
  });

  it("goes up and down one batch at a time", () => {
    for (const total of [97, 98, 99, 100, 101, 110, 111]) {
      expect(sum(distributePlanTotal(core(), total, DEFAULT_PLAN_MARGIN, { apply }))).toBe(total);
    }
  });

  it("REGRESSION: an unticked recipe no longer swallows its share of the total", () => {
    const rows = core().map(r => r.recipeId === 4 ? { ...r, included: false } : r);
    // The old screen shared the total over every DPT row, ticked or not, so
    // The Godfather's share disappeared: 110 typed, 98 planned.
    const old = allocateBatchesToTargets(allocRecipesFor(rows), 110, DEFAULT_PLAN_MARGIN);
    const oldPlanned = old.reduce((s, a, i) => s + (rows[i].included ? a.suggestedBatches : 0), 0);
    expect(oldPlanned).toBe(98);
    // Now the ticked rows add up to the box.
    const next = distributePlanTotal(rows, 110, DEFAULT_PLAN_MARGIN, { apply });
    expect(sum(next)).toBe(110);
    expect(next.find(r => r.recipeId === 4)).toBe(rows.find(r => r.recipeId === 4)); // unticked: untouched
  });

  it("REGRESSION: batches the slow-meat limit cuts go to the other recipes", () => {
    const slowMeat: SlowMeatProfileData = {
      settings: { minCookMinutes: 120, trayLimit: 11 },
      profiles: [
        { recipeId: 3, recipeName: "BBQ Pulled Pork", meats: [{ ingredientId: 22, ingredientName: "Pork", cookTimeMin: 180, trayCapacityKg: 6, kgPerBatch: 1.224 }] },
        { recipeId: 26, recipeName: "Philly", meats: [{ ingredientId: 154, ingredientName: "Diced Beef", cookTimeMin: 210, trayCapacityKg: 4.5, kgPerBatch: 1.61 }] },
      ],
    };
    // Low pork and beef stock so both want more than 11 trays allow.
    const rows = core().map(r => r.recipeId === 3 || r.recipeId === 26 ? { ...r, estimatedFactoryNumber: -150 } : r);
    const cap = (rs: Row[]) => applySlowMeatCap(rs, slowMeat, (r, n) => ({ ...r, batchesTarget: n, suggestedBatches: n }));
    const uncapped = cap(distributePlanTotal(rows, 110, DEFAULT_PLAN_MARGIN, { apply }));
    expect(sum(uncapped)).toBeLessThan(110); // the old way: the cut batches were lost
    const next = distributePlanTotal(rows, 110, DEFAULT_PLAN_MARGIN, { apply, cap });
    expect(sum(next)).toBe(110);
    expect(slowMeatCountForRows(next, slowMeat).totalTrays).toBeLessThanOrEqual(11);
    expect(next.find(r => r.recipeId === 3)!.slowMeatCappedFrom).toBeGreaterThan(next.find(r => r.recipeId === 3)!.batchesTarget);
  });

  it("queued test production and hand-added recipes come off the top", () => {
    const rows: Row[] = [
      ...core(),
      row(90, "Test pie", 0, { id: "queued-90", isFromDpt: false, batchesTarget: 6 }),
      row(91, "Added by hand", 0, { id: "manual-91", isFromDpt: false, batchesTarget: 4 }),
    ];
    const next = distributePlanTotal(rows, 110, DEFAULT_PLAN_MARGIN, { apply });
    expect(next.find(r => r.id === "queued-90")!.batchesTarget).toBe(6);
    expect(next.find(r => r.id === "manual-91")!.batchesTarget).toBe(4);
    expect(sum(next)).toBe(110);
  });

  it("rows off the main kitchen line (fried chicken) are outside the total", () => {
    const rows: Row[] = [...core(), row(70, "Fried chicken", 0, { id: "manual-70", isFromDpt: false, batchesTarget: 8 })];
    const inTotal = (r: Row) => r.recipeId !== 70;
    const next = distributePlanTotal(rows, 110, DEFAULT_PLAN_MARGIN, { apply, inTotal });
    expect(rowsBatchTotal(next, { inTotal })).toBe(110);
    expect(next.find(r => r.recipeId === 70)!.batchesTarget).toBe(8);
  });

  it("a scheduled 'orders + 2 batches' rule still holds when the total is typed", () => {
    const rows = core().map(r => r.recipeId === 9 ? { ...r, extraBatchesCap: 2 } : r);
    const next = distributePlanTotal(rows, 110, DEFAULT_PLAN_MARGIN, { apply });
    expect(sum(next)).toBe(110);
    // Orders 30 packs − 40 in stock → floor 0; + 2 extra at most.
    expect(next.find(r => r.recipeId === 9)!.batchesTarget).toBeLessThanOrEqual(2);
  });
});

describe("rotaLine", () => {
  const people = [
    { name: "Sam Baker", position: "Dough Prep" },
    { name: "Alex", position: "Building" },
    { name: "Jo", position: "Wrapping" },
  ];
  it("names the dough prep person", () => {
    expect(rotaLine({ teamSize: 3, hasDoughPrep: true, people }, "today"))
      .toEqual({ onShift: "3 on shift today", doughPrep: "Dough prep: Sam Baker" });
  });
  it("says when nobody is on dough prep", () => {
    expect(rotaLine({ teamSize: 2, hasDoughPrep: false, people: people.slice(1) }, "on Thu 30 Oct"))
      .toEqual({ onShift: "2 on shift on Thu 30 Oct", doughPrep: null });
  });
});
