// #320 + #325 (22 Oct 2026): the Orders page's "still to prep" counts the
// SAME tins/trays the prep stations show, through one shared rule.
import { describe, expect, it } from "vitest";
import { outstandingLineQty, prepUnitCount, rawMeatTrayCount, stationRawMeatTrays } from "./stock-usage-rules";

const tinBase = { batchesTarget: 11, maxBatchesPerTin: 8, includeInFillingMix: false, mixingTinOverride: null, tinOverride: null };

describe("prepUnitCount — the tins/trays the station makes", () => {
  it("one-tin-per-recipe ingredients are one tin however many batches", () => {
    expect(prepUnitCount(tinBase)).toBe(2);
    expect(prepUnitCount({ ...tinBase, oneTinPerRecipe: true })).toBe(1);
    // The setting wins over a tin override, as Main Prep always applied it.
    expect(prepUnitCount({ ...tinBase, oneTinPerRecipe: true, tinOverride: 3 })).toBe(1);
  });

  it("raw meat with a tray capacity counts the station's trays, not batch tins", () => {
    expect(prepUnitCount({ ...tinBase, batchesTarget: 15, maxBatchesPerTin: 6, rawMeatTrays: 2 })).toBe(2);
    // No tray capacity → not tray-counted: falls back to tins (unchanged).
    expect(prepUnitCount({ ...tinBase, batchesTarget: 15, maxBatchesPerTin: 6, rawMeatTrays: null })).toBe(3);
  });

  it("trays = (meat + marinade kg) ÷ kg per tray, rounded up", () => {
    expect(rawMeatTrayCount({ meatKg: 6.55, marinadeKg: 0.6, capacityKg: 4 })).toBe(2);
    expect(rawMeatTrayCount({ meatKg: 8, marinadeKg: 0, capacityKg: 4 })).toBe(2);
    expect(rawMeatTrayCount({ meatKg: 0.1 + 0.2 + 7.7, marinadeKg: 0, capacityKg: 4 })).toBe(2); // float noise
    expect(rawMeatTrayCount({ meatKg: 8.01, marinadeKg: 0, capacityKg: 4 })).toBe(3);
    expect(rawMeatTrayCount({ meatKg: 5, marinadeKg: 0, capacityKg: null })).toBeNull();
    expect(rawMeatTrayCount({ meatKg: 0, marinadeKg: 0, capacityKg: 4 })).toBe(0);
  });

  it("stationRawMeatTrays: grams converted, marinades added to their own meat only", () => {
    const trays = stationRawMeatTrays(
      [
        { ingredientId: 191, isRawMeat: true, unit: "g", rawQty: 6552, rawMeatTrayCapacityKg: 4 },
        { ingredientId: 306, isRawMeat: true, unit: "kg", rawQty: 3.9, rawMeatTrayCapacityKg: 4 },
        { ingredientId: 70, isRawMeat: true, unit: "kg", rawQty: 3, rawMeatTrayCapacityKg: null },
        { ingredientId: 5, isRawMeat: false, unit: "kg", rawQty: 3, rawMeatTrayCapacityKg: 4 },
      ],
      [{ rawMeatIngredientId: 306, totalGrams: 200 }],
    );
    expect(trays.get(191)).toBe(2);
    expect(trays.get(306)).toBe(2); // 3.9 kg + 0.2 kg marinade > 4 kg
    expect(trays.get(70)).toBeNull();
    expect(trays.has(5)).toBe(false);
  });
});

describe("outstandingLineQty — Orders 'still to prep' for one line", () => {
  const COUNT = 1_000;
  const TICKED = 500; // ticked before the stock count: already off the shelf

  it("#320 regression: Carnizone 15 batches, chicken on 2 trays, both ticked → nothing outstanding", () => {
    // 15 batches × 10 portions × 0.038 kg ÷ 0.87 ≈ 6.55 kg raw chicken; 4 kg trays → 2 trays.
    const rawQty = (15 * 10 * 0.038) / 0.87;
    const trays = stationRawMeatTrays(
      [{ ingredientId: 191, isRawMeat: true, unit: "kg", rawQty: Math.round(rawQty * 100) / 100, rawMeatTrayCapacityKg: 4 }],
      [],
    ).get(191);
    const units = prepUnitCount({ batchesTarget: 15, maxBatchesPerTin: 6, includeInFillingMix: false, mixingTinOverride: null, tinOverride: null, rawMeatTrays: trays });
    expect(units).toBe(2);
    const ticks = new Map([[1, TICKED], [2, TICKED]]);
    expect(outstandingLineQty({ unitCount: units, rawQty, tickedAtMs: ticks, checkedAtMs: COUNT })).toBe(0);
    // The old batch-tin count (3) left a third of the chicken outstanding forever.
    expect(outstandingLineQty({ unitCount: 3, rawQty, tickedAtMs: ticks, checkedAtMs: COUNT })).toBeCloseTo(rawQty / 3);
  });

  it("#325 regression: Margherita 11 batches, basil tin 1 ticked → nothing outstanding", () => {
    const rawQty = 11 * 10 * 0.9024; // grams
    const units = prepUnitCount({ ...tinBase, oneTinPerRecipe: true });
    expect(units).toBe(1);
    expect(outstandingLineQty({ unitCount: units, rawQty, tickedAtMs: new Map([[1, TICKED]]), checkedAtMs: COUNT })).toBe(0);
    // The old count (2 tins) left half the basil outstanding forever.
    expect(outstandingLineQty({ unitCount: 2, rawQty, tickedAtMs: new Map([[1, TICKED]]), checkedAtMs: COUNT })).toBeCloseTo(rawQty / 2);
  });

  it("unticked and after-count tins are outstanding; before-count ticks are inside the count", () => {
    expect(outstandingLineQty({ unitCount: 2, rawQty: 10, tickedAtMs: new Map(), checkedAtMs: COUNT })).toBe(10);
    expect(outstandingLineQty({ unitCount: 2, rawQty: 10, tickedAtMs: new Map([[1, 500]]), checkedAtMs: COUNT })).toBe(5);
    expect(outstandingLineQty({ unitCount: 2, rawQty: 10, tickedAtMs: new Map([[1, 500], [2, 600]]), checkedAtMs: COUNT })).toBe(0);
    expect(outstandingLineQty({ unitCount: 2, rawQty: 10, tickedAtMs: new Map(), checkedAtMs: COUNT, only: new Set([2]) })).toBe(5);
    expect(outstandingLineQty({ unitCount: 0, rawQty: 10, tickedAtMs: new Map(), checkedAtMs: null })).toBe(0);
  });
});
