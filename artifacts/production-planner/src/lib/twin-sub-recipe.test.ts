import { describe, it, expect } from "vitest";
import { findTwinSubRecipe, swapRowToSubRecipe, sameUnit } from "./twin-sub-recipe";

const subs = [{ id: 44, name: "Garlic Confit" }, { id: 74, name: "Red Wine Gravy" }];

describe("findTwinSubRecipe", () => {
  it("finds the Garlic Confit sub-recipe for the Garlic Confit ingredient", () => {
    expect(findTwinSubRecipe("Garlic Confit", subs)?.id).toBe(44);
    expect(findTwinSubRecipe("garlic  confit (kg)", subs)?.id).toBe(44);
  });

  it("leaves a different ingredient alone", () => {
    expect(findTwinSubRecipe("Garlic Cloves fresh peeled", subs)).toBeNull();
    expect(findTwinSubRecipe("", subs)).toBeNull();
  });
});

describe("swapRowToSubRecipe", () => {
  it("keeps the quantity and the marinade link", () => {
    const row = swapRowToSubRecipe(
      { ingredientId: 166, quantity: 0.015, hideFromPrep: false, marinadeForIngredientId: 154, marinadeAddAtCooking: false },
      { componentSubRecipeId: 0, quantity: 0, marinadeForIngredientId: null, marinadeAddAtCooking: false },
      "componentSubRecipeId", 44, "ingredientId",
    );
    expect(row).toEqual({ componentSubRecipeId: 44, quantity: 0.015, marinadeForIngredientId: 154, marinadeAddAtCooking: false });
  });
});

describe("sameUnit", () => {
  it("only matches the same unit", () => {
    expect(sameUnit("kg", "KG")).toBe(true);
    expect(sameUnit("kg", "L")).toBe(false);
    expect(sameUnit(null, "kg")).toBe(false);
  });
});
