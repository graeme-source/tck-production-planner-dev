import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY, mainKitchenStationItems } from "./constants";

describe("mainKitchenStationItems", () => {
  // Regression (2026-10-05): the building, ovens, wrapping, mixing, sheeting
  // and dough stations listed plan 187's 154 fried chicken bags as calzone
  // batches, so their totals and progress bars counted work done elsewhere.
  it("leaves fried chicken off the main-kitchen stations", () => {
    const items = [
      { id: 1, recipeCategory: "Calzones" },
      { id: 2, recipeCategory: FRIED_CHICKEN_CATEGORY },
      { id: 3, recipeCategory: MAC_CHEESE_CATEGORY },
    ];
    expect(mainKitchenStationItems(items).map(i => i.id)).toEqual([1, 3]);
  });

  it("copes with a plan that has no items yet", () => {
    expect(mainKitchenStationItems(undefined)).toEqual([]);
  });
});
