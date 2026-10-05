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
  it("classifies categories, defaulting unknown ones to calzone", () => {
    expect(dayKind("Fried Chicken")).toBe("other");
    expect(dayKind("Macaroni Cheese")).toBe("mac");
    expect(dayKind("Calzones")).toBe("calzone");
    expect(dayKind(null)).toBe("calzone");
  });
});
