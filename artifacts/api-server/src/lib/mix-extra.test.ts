import { describe, it, expect } from "vitest";
import {
  computeMixExtras, mixExtraFor, mixExtraPerBatch, mixExtraPrepQty, mixLineKey, MixExtraNotes, subRecipeComponentExtras, type MixLine,
} from "./mix-extra";

// Ids are illustrative. Quantities are per portion, in the line's unit, the
// way recipe_ingredients / recipe_sub_recipes store them.
const line = (over: Partial<MixLine> & Pick<MixLine, "lineId" | "itemId">): MixLine => ({
  kind: "ingredient",
  quantityPerPortion: 0.02,
  unit: "kg",
  mixingOverage: 0,
  includeInFillingMix: true,
  marinadeForIngredientId: null,
  ...over,
});

describe("computeMixExtras", () => {
  it("returns a line's Mix +g as-is, in the line's unit (kg line stores kg)", () => {
    const extras = computeMixExtras([line({ lineId: 1, itemId: 10, mixingOverage: 0.075 })]);
    expect(mixExtraFor(extras, "ingredient", 1)).toBeCloseTo(0.075, 10);
  });

  it("keeps a g line in grams", () => {
    const extras = computeMixExtras([line({ lineId: 1, itemId: 10, unit: "g", quantityPerPortion: 12, mixingOverage: 75 })]);
    expect(mixExtraFor(extras, "ingredient", 1)).toBe(75);
  });

  it("zero or absent overage changes nothing", () => {
    const extras = computeMixExtras([
      line({ lineId: 1, itemId: 10, mixingOverage: 0 }),
      line({ lineId: 2, itemId: 11, mixingOverage: Number.NaN }),
    ]);
    expect(extras.size).toBe(0);
    expect(mixExtraFor(extras, "ingredient", 1)).toBe(0);
    expect(mixExtraFor(null, "ingredient", 1)).toBe(0);
  });

  it("ignores lines outside the filling mix (the mixing station never reads them)", () => {
    const extras = computeMixExtras([line({ lineId: 1, itemId: 10, mixingOverage: 0.1, includeInFillingMix: false })]);
    expect(extras.size).toBe(0);
  });

  it("keeps sub-recipe and ingredient line ids apart", () => {
    const extras = computeMixExtras([
      line({ lineId: 5, itemId: 10, mixingOverage: 0.075 }),
      line({ kind: "subRecipe", lineId: 5, itemId: 2, quantityPerPortion: 0.036, mixingOverage: 0.2 }),
    ]);
    expect(mixExtraFor(extras, "ingredient", 5)).toBeCloseTo(0.075, 10);
    expect(mixExtraFor(extras, "subRecipe", 5)).toBeCloseTo(0.2, 10);
    expect(extras.get(mixLineKey("subRecipe", 5))).toBeCloseTo(0.2, 10);
  });

  it("splits a meat's extra between the meat and its marinades by per-portion weight", () => {
    // 90 g chicken + 10 g marinade (g line) per portion; Mix +g 0.2 kg on the
    // chicken. Mixing asks for (chicken + marinade) + 200 g, so prep makes
    // 180 g more chicken (cooked) and 20 g more marinade.
    const extras = computeMixExtras([
      line({ lineId: 1, itemId: 10, quantityPerPortion: 0.09, mixingOverage: 0.2 }),
      line({ lineId: 2, itemId: 20, unit: "g", quantityPerPortion: 10, marinadeForIngredientId: 10 }),
    ]);
    expect(mixExtraFor(extras, "ingredient", 1)).toBeCloseTo(0.18, 10); // kg
    expect(mixExtraFor(extras, "ingredient", 2)).toBeCloseTo(20, 10);   // g
  });

  it("splits into a sub-recipe marinade (rub) line in its yield unit", () => {
    const extras = computeMixExtras([
      line({ lineId: 1, itemId: 10, quantityPerPortion: 0.08, mixingOverage: 0.1 }),
      line({ kind: "subRecipe", lineId: 7, itemId: 30, quantityPerPortion: 0.02, marinadeForIngredientId: 10 }),
    ]);
    expect(mixExtraFor(extras, "ingredient", 1)).toBeCloseTo(0.08, 10);
    expect(mixExtraFor(extras, "subRecipe", 7)).toBeCloseTo(0.02, 10);
  });

  it("only splits into marinades the mixing station merges (filling-mix ones)", () => {
    const extras = computeMixExtras([
      line({ lineId: 1, itemId: 10, quantityPerPortion: 0.09, mixingOverage: 0.2 }),
      line({ lineId: 2, itemId: 20, unit: "g", quantityPerPortion: 10, marinadeForIngredientId: 10, includeInFillingMix: false }),
    ]);
    expect(mixExtraFor(extras, "ingredient", 1)).toBeCloseTo(0.2, 10);
    expect(mixExtraFor(extras, "ingredient", 2)).toBe(0);
  });

  it("never uses a marinade line's own Mix +g (it is merged into the meat at mixing)", () => {
    const extras = computeMixExtras([
      line({ lineId: 1, itemId: 10, quantityPerPortion: 0.09 }),
      line({ lineId: 2, itemId: 20, unit: "g", quantityPerPortion: 10, marinadeForIngredientId: 10, mixingOverage: 50 }),
    ]);
    expect(extras.size).toBe(0);
  });

  it("keeps the whole extra on the meat when a marinade can't be weighed", () => {
    const extras = computeMixExtras([
      line({ lineId: 1, itemId: 10, quantityPerPortion: 0.09, mixingOverage: 0.2 }),
      line({ lineId: 2, itemId: 20, unit: "each", quantityPerPortion: 1, marinadeForIngredientId: 10 }),
    ]);
    expect(mixExtraFor(extras, "ingredient", 1)).toBeCloseTo(0.2, 10);
    expect(mixExtraFor(extras, "ingredient", 2)).toBe(0);
  });
});

describe("mixExtraPerBatch — once per production day, not per batch", () => {
  it("spreads the day's extra so quantityPerBatch × batches adds it exactly once", () => {
    const perPortionKg = 0.015, portionsPerBatch = 10, overage = 0.075;
    for (const batches of [1, 4, 17]) {
      const perBatch = perPortionKg * portionsPerBatch + mixExtraPerBatch(overage, batches);
      expect(perBatch * batches).toBeCloseTo(perPortionKg * portionsPerBatch * batches + overage, 10);
    }
  });

  it("adds nothing when the recipe isn't being made (batchesTarget 0)", () => {
    expect(mixExtraPerBatch(0.075, 0)).toBe(0);
    expect(mixExtraPerBatch(0.075, Number.NaN)).toBe(0);
    expect(mixExtraPerBatch(0, 5)).toBe(0);
  });
});

describe("mixExtraPrepQty — raw = cooked ÷ processing ratio", () => {
  it("divides by the ratio for raw-weight prep", () => {
    expect(mixExtraPrepQty(0.2, 0.8, "raw")).toBeCloseTo(0.25, 10);
  });
  it("keeps the cooked figure for processed-weight prep, or with no ratio", () => {
    expect(mixExtraPrepQty(0.2, 0.8, "processed")).toBeCloseTo(0.2, 10);
    expect(mixExtraPrepQty(0.2, null, "raw")).toBeCloseTo(0.2, 10);
  });
  it("is 0 with no extra", () => {
    expect(mixExtraPrepQty(0, 0.8, "raw")).toBe(0);
  });
});

describe("MixExtraNotes", () => {
  it("sums contributions per item and keeps kinds apart", () => {
    const n = new MixExtraNotes();
    n.add("ingredient", 10, 0.05);
    n.add("ingredient", 10, 0.025);
    n.add("subRecipe", 10, 0.2);
    n.add("ingredient", 11, 0);
    expect(n.get("ingredient", 10)).toBeCloseTo(0.075, 10);
    expect(n.get("subRecipe", 10)).toBeCloseTo(0.2, 10);
    expect(n.get("ingredient", 11)).toBe(0);
  });
});

describe("subRecipeComponentExtras — a sub-recipe line's Mix +g expands into its ingredients", () => {
  it("gives each component its share of the extra", () => {
    // A sauce sub-recipe of 6 parts tomatoes to 4 parts onions. The line uses
    // 0.036 kg/portion × 10 portions × 5 batches = 1.8 kg, plus a 0.2 kg
    // Mix +g → resolved at 2.0 kg: 1.2 kg tomatoes, 0.8 kg onions.
    const extras = subRecipeComponentExtras([1.2, 0.8], 2.0, 0.2);
    expect(extras[0]).toBeCloseTo(0.12, 10);
    expect(extras[1]).toBeCloseTo(0.08, 10);
  });
  it("is all zeros with no extra", () => {
    expect(subRecipeComponentExtras([1.2, 0.8], 1.8, 0)).toEqual([0, 0]);
  });
});
