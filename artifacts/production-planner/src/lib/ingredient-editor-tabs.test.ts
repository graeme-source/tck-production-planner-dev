import { describe, it, expect } from "vitest";
import { firstIngredientErrorTab, ingredientErrorCounts, INGREDIENT_FIELD_TABS, tabsFor } from "./ingredient-editor-tabs";
import { emptyIngredientFormDefaults } from "./ingredient-form";

describe("ingredient editor tabs", () => {
  it("a supply skips the food-only tabs", () => {
    expect(tabsFor(true)).toEqual(["basics", "buying", "stock", "shelf", "prep", "label", "shop"]);
    expect(tabsFor(false)).toEqual(["basics", "buying", "stock", "shop"]);
  });

  it("every field on the form has a tab", () => {
    const missing = Object.keys(emptyIngredientFormDefaults("ingredient")).filter(k => !(k in INGREDIENT_FIELD_TABS));
    expect(missing).toEqual([]);
  });

  it("a refused save opens the first tab with a problem and counts each tab", () => {
    const errors = { costPerPack: { message: "Required" }, name: { message: "Required" }, processingRatioPct: { message: "Too big" } };
    expect(firstIngredientErrorTab(errors)).toBe("basics");
    expect(ingredientErrorCounts(errors)).toEqual({ basics: 1, buying: 1, prep: 1 });
    expect(firstIngredientErrorTab({ packWeight: { message: "x" } })).toBe("buying");
    expect(firstIngredientErrorTab({})).toBeNull();
  });
});
