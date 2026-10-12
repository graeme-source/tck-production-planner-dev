import { describe, expect, it } from "vitest";
import { formIsDirty, normaliseForDirty } from "./editor-dirty";

const base = {
  name: "Classic",
  servings: 1,
  color: "",
  isCoreMenu: false,
  notes: "",
  shelfLifeDays: undefined,
  ingredients: [
    { ingredientId: 3, quantity: 0.25, marinadeForIngredientId: null, isTopping: false, mixingOverage: 0 },
  ],
};

describe("formIsDirty", () => {
  it("is clean when nothing changed", () => {
    expect(formIsDirty(base, structuredClone(base))).toBe(false);
  });

  it("treats input strings and empties as the loaded values", () => {
    const fromInputs = {
      ...base,
      servings: "1",
      color: undefined,
      notes: "  ",
      shelfLifeDays: "",
      isCoreMenu: undefined,
      ingredients: [{ ingredientId: "3", quantity: "0.250", marinadeForIngredientId: "", isTopping: false, mixingOverage: "0" }],
    };
    expect(formIsDirty(base, fromInputs)).toBe(false);
  });

  it("spots a real change", () => {
    expect(formIsDirty(base, { ...base, name: "Classic 2" })).toBe(true);
    expect(formIsDirty(base, { ...base, isCoreMenu: true })).toBe(true);
    expect(formIsDirty(base, { ...base, color: "#ff0000" })).toBe(true);
  });

  it("edit then revert goes back to clean", () => {
    const edited = { ...base, ingredients: [{ ...base.ingredients[0], quantity: 0.3 }] };
    expect(formIsDirty(base, edited)).toBe(true);
    const reverted = { ...base, ingredients: [{ ...base.ingredients[0], quantity: "0.25" }] };
    expect(formIsDirty(base, reverted)).toBe(false);
  });

  it("adding, removing or reordering rows is a change", () => {
    const row2 = { ingredientId: 4, quantity: 1 };
    expect(formIsDirty(base, { ...base, ingredients: [...base.ingredients, row2] })).toBe(true);
    expect(formIsDirty(base, { ...base, ingredients: [] })).toBe(true);
    const two = { ...base, ingredients: [base.ingredients[0], row2] };
    expect(formIsDirty(two, { ...base, ingredients: [row2, base.ingredients[0]] })).toBe(true);
  });

  it("ignores the listed derived keys", () => {
    expect(formIsDirty({ yield: 1, name: "x" }, { yield: 2.5, name: "x" }, ["yield"])).toBe(false);
    expect(formIsDirty({ yield: 1, name: "x" }, { yield: 2.5, name: "y" }, ["yield"])).toBe(true);
  });
});

describe("normaliseForDirty", () => {
  it("keeps non-numeric strings and real zeros", () => {
    expect(normaliseForDirty(" kg ")).toBe("kg");
    expect(normaliseForDirty(0)).toBe(0);
    expect(normaliseForDirty("0")).toBe(0);
    expect(normaliseForDirty(true)).toBe(true);
    expect(normaliseForDirty("#e11d48")).toBe("#e11d48");
  });
});
