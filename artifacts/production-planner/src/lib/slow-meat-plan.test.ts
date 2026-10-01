import { describe, it, expect } from "vitest";
import { applySlowMeatCap, slowMeatCountForRows, slowMeatNotice, slowMeatReductionsForRows, type CappablePlanRow, type SlowMeatProfileData } from "./slow-meat-plan";

const data: SlowMeatProfileData = {
  settings: { minCookMinutes: 120, trayLimit: 11 },
  profiles: [
    { recipeId: 3, recipeName: "BBQ Pulled Pork", meats: [{ ingredientId: 22, ingredientName: "Pork", cookTimeMin: 180, trayCapacityKg: 6, kgPerBatch: 1.224 }] },
    { recipeId: 26, recipeName: "Philly", meats: [{ ingredientId: 154, ingredientName: "Diced Beef", cookTimeMin: 210, trayCapacityKg: 4.5, kgPerBatch: 1.61 }] },
  ],
};

const row = (id: string, recipeId: number, n: number, extra: Partial<CappablePlanRow> = {}): CappablePlanRow =>
  ({ id, recipeId, recipeName: `R${recipeId} `, included: true, batchesTarget: n, suggestedBatches: n, ...extra });
const setBatches = (r: CappablePlanRow, n: number): CappablePlanRow => ({ ...r, batchesTarget: n, suggestedBatches: n });

describe("applySlowMeatCap", () => {
  it("returns the same array when within the limit", () => {
    const rows = [row("calc-3", 3, 10), row("calc-26", 26, 10), row("calc-4", 4, 40)];
    expect(applySlowMeatCap(rows, data, setBatches)).toBe(rows);
  });

  it("caps suggested rows, remembers the original, and is stable on re-run", () => {
    const rows = [row("calc-3", 3, 30), row("calc-26", 26, 20), row("calc-4", 4, 40)];
    const capped = applySlowMeatCap(rows, data, setBatches);
    expect(capped[0].batchesTarget).toBeLessThan(30);
    expect(capped[0].slowMeatCappedFrom).toBe(30);
    expect(capped[1].slowMeatCappedFrom).toBe(20);
    expect(capped[2]).toBe(rows[2]);
    expect(slowMeatCountForRows(capped, data).totalTrays).toBeLessThanOrEqual(11);
    expect(applySlowMeatCap(capped, data, setBatches)).toBe(capped);
    expect(slowMeatNotice(capped, slowMeatCountForRows(capped, data)))
      .toMatch(/^R3 reduced 30 → \d+ batches, R26 20 → \d+, to stay within 11 trays/);
  });

  it("restores the original suggestion when the limit is raised", () => {
    const capped = applySlowMeatCap([row("calc-3", 3, 30), row("calc-26", 26, 20)], data, setBatches);
    const restored = applySlowMeatCap(capped, { ...data, settings: { ...data.settings, trayLimit: 20 } }, setBatches);
    expect(restored.map(r => [r.batchesTarget, r.slowMeatCappedFrom])).toEqual([[30, undefined], [20, undefined]]);
  });

  it("never cuts a row the operator typed into — it stays over and counts", () => {
    const rows = [row("calc-3", 3, 30, { suggestedBatches: 12 }), row("calc-26", 26, 20, { suggestedBatches: 20 })];
    const capped = applySlowMeatCap(rows, data, setBatches);
    expect(capped[0].batchesTarget).toBe(30);           // manual: untouched
    expect(capped[1].batchesTarget).toBeLessThan(20);   // suggestion: cut to make room
    expect(slowMeatCountForRows(capped, data).totalTrays).toBeLessThanOrEqual(11);
  });

  it("ignores excluded rows and leaves queued test production alone", () => {
    const rows = [row("queued-1", 3, 30), row("calc-26", 26, 20, { included: false })];
    const capped = applySlowMeatCap(rows, data, setBatches);
    expect(capped).toBe(rows);
    expect(slowMeatCountForRows(rows, data).totalTrays).toBe(7);
    expect(slowMeatReductionsForRows(rows)).toEqual([]);
  });
});
