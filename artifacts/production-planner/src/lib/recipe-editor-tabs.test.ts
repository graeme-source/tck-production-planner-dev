import { describe, expect, it } from "vitest";
import {
  EDITOR_TABS,
  RECIPE_FIELD_TABS,
  SUB_RECIPE_FIELD_TABS,
  errorCountsByTab,
  firstErrorTab,
  orderLines,
  tabOfField,
  visibleTabs,
} from "./recipe-editor-tabs";

describe("tab bar", () => {
  it("is the same five tabs, Ingredients first", () => {
    expect(EDITOR_TABS.map(t => t.id)).toEqual(["ingredients", "details", "production", "label", "more"]);
  });

  it("always shows Ingredients and only the other tabs an editor filled", () => {
    expect(visibleTabs({})).toEqual(["ingredients"]);
    expect(visibleTabs({ label: true, details: true })).toEqual(["ingredients", "details", "label"]);
    expect(visibleTabs({ details: true, production: true, label: true, more: false })).toEqual(["ingredients", "details", "production", "label"]);
  });
});

describe("tabOfField", () => {
  it("maps line rows to the Ingredients tab in both editors", () => {
    expect(tabOfField("ingredients.3.quantity", RECIPE_FIELD_TABS)).toBe("ingredients");
    expect(tabOfField("subRecipes.0.subRecipeId", RECIPE_FIELD_TABS)).toBe("ingredients");
    expect(tabOfField("subRecipeComponents.1.quantity", SUB_RECIPE_FIELD_TABS)).toBe("ingredients");
  });

  it("puts each recipe field on its tab", () => {
    expect(tabOfField("name", RECIPE_FIELD_TABS)).toBe("details");
    expect(tabOfField("rrp", RECIPE_FIELD_TABS)).toBe("details");
    expect(tabOfField("ovenTempC", RECIPE_FIELD_TABS)).toBe("production");
    expect(tabOfField("portionsPerBatch", RECIPE_FIELD_TABS)).toBe("production");
    expect(tabOfField("labelDeclaration", SUB_RECIPE_FIELD_TABS)).toBe("label");
    expect(tabOfField("isBase", SUB_RECIPE_FIELD_TABS)).toBe("production");
  });

  it("falls back to Details for a field nobody mapped", () => {
    expect(tabOfField("somethingNew", RECIPE_FIELD_TABS)).toBe("details");
  });
});

describe("errors per tab", () => {
  it("counts a field error and each bad row", () => {
    const errors = {
      name: { type: "too_small", message: "Name is required" },
      ingredients: [undefined, { quantity: { message: "Must be > 0" } }, { ingredientId: { message: "Select ingredient" } }],
      ovenTempC: { message: "Max 450°C" },
    };
    expect(errorCountsByTab(errors, RECIPE_FIELD_TABS)).toEqual({ details: 1, ingredients: 2, production: 1 });
  });

  it("counts the sub-recipe 'add at least one line' rule on the Ingredients tab", () => {
    const errors = { ingredients: { type: "custom", message: "Add at least one ingredient or sub-recipe component" } };
    expect(errorCountsByTab(errors, SUB_RECIPE_FIELD_TABS)).toEqual({ ingredients: 1 });
    expect(firstErrorTab(errors, SUB_RECIPE_FIELD_TABS)).toBe("ingredients");
  });

  it("counts an array's root message as well as its rows", () => {
    const rows: unknown[] & { root?: { message: string } } = [{ quantity: { message: "Must be > 0" } }];
    rows.root = { message: "Too many" };
    expect(errorCountsByTab({ subRecipes: rows }, RECIPE_FIELD_TABS)).toEqual({ ingredients: 2 });
  });

  it("jumps to the first tab in bar order, not the first field typed", () => {
    const errors = { ovenTimeMinutes: { message: "Min 0.5 min" }, name: { message: "Name is required" } };
    expect(firstErrorTab(errors, RECIPE_FIELD_TABS)).toBe("details");
    expect(firstErrorTab({ ovenTimeMinutes: { message: "x" } }, RECIPE_FIELD_TABS)).toBe("production");
    expect(firstErrorTab({}, RECIPE_FIELD_TABS)).toBeNull();
    expect(firstErrorTab(undefined, RECIPE_FIELD_TABS)).toBeNull();
  });
});

describe("orderLines (combined ingredients + sub-recipes table)", () => {
  it("shows ingredients then sub-recipes, as saved", () => {
    expect(orderLines(["a", "b"], ["x"], [])).toEqual([
      { kind: "ingredient", key: "a", index: 0 },
      { kind: "ingredient", key: "b", index: 1 },
      { kind: "subRecipe", key: "x", index: 0 },
    ]);
  });

  it("keeps rows added in this sitting at the bottom in the order added, whichever kind", () => {
    const out = orderLines(["a", "n1"], ["x", "n2"], ["n2", "n1"]);
    expect(out.map(l => l.key)).toEqual(["a", "x", "n2", "n1"]);
    expect(out.find(l => l.key === "n1")).toEqual({ kind: "ingredient", key: "n1", index: 1 });
    expect(out.find(l => l.key === "n2")).toEqual({ kind: "subRecipe", key: "n2", index: 1 });
  });

  it("drops added keys whose row has since been removed", () => {
    expect(orderLines(["a"], [], ["gone"]).map(l => l.key)).toEqual(["a"]);
  });

  it("re-indexes after a removal so each row still points at its own array slot", () => {
    // "b" removed from ["a","b","c"] → useFieldArray gives ["a","c"].
    expect(orderLines(["a", "c"], [], [])).toEqual([
      { kind: "ingredient", key: "a", index: 0 },
      { kind: "ingredient", key: "c", index: 1 },
    ]);
  });
});
