import { describe, it, expect } from "vitest";
import { subMarinadeQtyPerPortion, subMarinadeTotalGrams, isMeatCookSubRecipe } from "./sub-recipe-marinades";

// The Philly slow-cook beef restructure: sub-recipe yields 0.97kg (yield %
// 62.1 over 1.561kg of components), the recipe uses 0.097kg per portion —
// so every component must contribute exactly its old recipe-level quantity.
const PHILLY = { subUsagePerPortion: 0.097, subYield: 0.97 };

describe("subMarinadeQtyPerPortion", () => {
  it("reproduces the Philly's recipe-level marinade quantities exactly", () => {
    expect(subMarinadeQtyPerPortion({ ...PHILLY, componentQty: 0.36 })).toBeCloseTo(0.036, 10); // onions
    expect(subMarinadeQtyPerPortion({ ...PHILLY, componentQty: 0.15 })).toBeCloseTo(0.015, 10); // stock
    expect(subMarinadeQtyPerPortion({ ...PHILLY, componentQty: 0.041 })).toBeCloseTo(0.0041, 10); // rub
  });

  it("scales with partial usage of the sub", () => {
    expect(subMarinadeQtyPerPortion({ componentQty: 1, subUsagePerPortion: 0.5, subYield: 2 })).toBe(0.25);
  });

  it("is zero when the sub has no yield (never divides by zero)", () => {
    expect(subMarinadeQtyPerPortion({ componentQty: 1, subUsagePerPortion: 1, subYield: 0 })).toBe(0);
  });
});

describe("isMeatCookSubRecipe", () => {
  it("classifies the Philly slow-cook beef as a cook, not a prep make-task", () => {
    expect(isMeatCookSubRecipe({ hasRawMeatComponent: true, hasMarinadeLinkedComponent: true })).toBe(true);
  });

  it("leaves a plain meat prep (no marinade links) on the make list", () => {
    expect(isMeatCookSubRecipe({ hasRawMeatComponent: true, hasMarinadeLinkedComponent: false })).toBe(false);
  });

  it("leaves meat-free sub-recipes (sauces, rubs, doughs) on the make list", () => {
    expect(isMeatCookSubRecipe({ hasRawMeatComponent: false, hasMarinadeLinkedComponent: true })).toBe(false);
    expect(isMeatCookSubRecipe({ hasRawMeatComponent: false, hasMarinadeLinkedComponent: false })).toBe(false);
  });
});

describe("subMarinadeTotalGrams", () => {
  it("gives the onions their 360g per batch across a 1-batch run", () => {
    expect(subMarinadeTotalGrams({
      ...PHILLY, componentQty: 0.36, unit: "kg", portionsPerBatch: 10, batchesTarget: 1,
    })).toBe(360);
  });

  it("multiplies across the plan's batches", () => {
    expect(subMarinadeTotalGrams({
      ...PHILLY, componentQty: 0.15, unit: "kg", portionsPerBatch: 10, batchesTarget: 25,
    })).toBe(3750); // 15g/portion × 250 portions
  });

  it("treats gram-unit components as grams", () => {
    expect(subMarinadeTotalGrams({
      componentQty: 4, unit: "g", subUsagePerPortion: 1, subYield: 1, portionsPerBatch: 10, batchesTarget: 2,
    })).toBe(80);
  });
});
