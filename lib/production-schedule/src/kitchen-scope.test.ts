import { describe, expect, it } from "vitest";
import {
  FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY, calzoneLineBatches, isMainKitchen, kitchenLine, mainKitchenItems, mainKitchenLines,
} from "./kitchen-scope";

describe("kitchenLine", () => {
  it("splits calzone line, mac cheese and the separate fried chicken facility", () => {
    expect(kitchenLine(MAC_CHEESE_CATEGORY)).toBe("mac");
    expect(kitchenLine(FRIED_CHICKEN_CATEGORY)).toBe("separate");
    expect(kitchenLine("Calzones")).toBe("calzone");
  });

  it("treats any other or missing category as the calzone line", () => {
    expect(kitchenLine("Desserts")).toBe("calzone");
    expect(kitchenLine(null)).toBe("calzone");
    expect(kitchenLine(undefined)).toBe("calzone");
  });
});

describe("isMainKitchen", () => {
  it("is false only for fried chicken", () => {
    expect(isMainKitchen("Calzones")).toBe(true);
    expect(isMainKitchen(MAC_CHEESE_CATEGORY)).toBe(true);
    expect(isMainKitchen(FRIED_CHICKEN_CATEGORY)).toBe(false);
  });
});

describe("mainKitchenItems", () => {
  // Regression (2026-10-05): plan 187 carried 105 calzone batches, 15 mac
  // packs and 154 fried chicken bags; totals read 259 calzone batches.
  it("drops fried chicken items and keeps their order", () => {
    const items = [
      { id: 1, recipeCategory: "Calzones", batchesTarget: 105 },
      { id: 2, recipeCategory: FRIED_CHICKEN_CATEGORY, batchesTarget: 154 },
      { id: 3, recipeCategory: MAC_CHEESE_CATEGORY, batchesTarget: 15 },
    ];
    expect(mainKitchenItems(items).map(i => i.id)).toEqual([1, 3]);
  });
});

describe("calzoneLineBatches", () => {
  // Regression (2026-10-05): the station KPI's "all done" target summed every
  // non-mac item, so on a fried chicken day (105 + 154) a mixer who finished
  // never froze their clock and their batches/hour decayed all evening.
  it("counts calzone-line batches only", () => {
    expect(calzoneLineBatches([
      { category: "Calzones", batchesTarget: 105 },
      { category: FRIED_CHICKEN_CATEGORY, batchesTarget: 154 },
      { category: MAC_CHEESE_CATEGORY, batchesTarget: 15 },
      { category: null, batchesTarget: "3" },
    ])).toBe(108);
  });
});

describe("mainKitchenLines", () => {
  it("drops the fried chicken line from a per-category record", () => {
    expect(mainKitchenLines({ Calzones: 1, [MAC_CHEESE_CATEGORY]: 2, [FRIED_CHICKEN_CATEGORY]: 3 }))
      .toEqual({ Calzones: 1, [MAC_CHEESE_CATEGORY]: 2 });
  });
});
