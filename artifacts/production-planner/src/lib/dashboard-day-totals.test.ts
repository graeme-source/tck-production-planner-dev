import { describe, expect, it } from "vitest";
import { addDayItems, dayKind, EMPTY_DAY_TOTALS } from "./dashboard-day-totals";

describe("dashboard day totals (regression: 259 'batches' on a 105-batch day, 2026-10-05)", () => {
  const items = [
    { recipeCategory: "Calzones", batchesTarget: 105, stationCompletions: { building_1: 50, building_2: 32 } },
    { recipeCategory: "Fried Chicken", batchesTarget: 154, portionsPerBatch: 1, stationCompletions: { building_1: 0 } },
    { recipeCategory: "Macaroni Cheese", batchesTarget: 15, portionsPerBatch: 2 },
  ];
  it("fried chicken is not counted as calzone batches", () => {
    const t = addDayItems(EMPTY_DAY_TOTALS, items);
    expect(t.calzoneBatches).toBe(105);
    expect(t.calzoneBuilt).toBe(82);
    expect(t.macPacks).toBe(15);
  });
  // Graeme, 16 Oct 2026: 6 batches of buns (48 in sixes = 8 packs a batch)
  // were "144 packs" (÷2) and counted as calzone batches through the ovens.
  it("buns: packs in their own size, out of the calzone counts, no ovens, wrapped into the freezer", () => {
    const t = addDayItems(EMPTY_DAY_TOTALS, [
      { recipeCategory: "Calzones", batchesTarget: 90, portionsPerBatch: 10, packSize: 2, fridgeQty: 100, stationCompletions: { building_1: 40, building_2: 40, ovens: 70 } },
      { recipeCategory: "Desserts", excludeFromKpis: true, skipOvens: true, batchesTarget: 6, portionsPerBatch: 48, packSize: "6.0000", freezerQty: 16, stationCompletions: { building_1: 6, ovens: 0 } },
    ]);
    expect(t.calzoneBatches).toBe(90);
    expect(t.calzoneBuilt).toBe(80);
    expect(t.ovensDone).toBe(70);
    expect(t.packsTotal).toBe(450 + 48);
    expect(t.packsWrapped).toBe(100 + 16);
  });
  it("calzones are unchanged: 10 portions in twos, bags take 4 two-packs each", () => {
    const t = addDayItems(EMPTY_DAY_TOTALS, [{ recipeCategory: "Calzones", batchesTarget: 10, portionsPerBatch: 10, eightPackBagCount: 5 }]);
    expect(t.packsTotal).toBe(50 - 20 + 5);
  });
  it("classifies categories, defaulting unknown ones to calzone", () => {
    expect(dayKind("Fried Chicken")).toBe("other");
    expect(dayKind("Macaroni Cheese")).toBe("mac");
    expect(dayKind("Calzones")).toBe("calzone");
    expect(dayKind(null)).toBe("calzone");
  });
});
