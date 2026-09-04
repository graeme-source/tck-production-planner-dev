import { describe, expect, it } from "vitest";
import { cookedToRaw, toGrams, gramsOrNull, kgOrNull, isWeighable } from "./index";

// Regression guard for the ordering-buffer bug: dpt-ingredient-requirements
// computed cooked = raw × ratio while orders.ts computed raw = cooked ÷ ratio,
// leaving the surplus buffer off by ratio² for processed ingredients.
describe("cookedToRaw", () => {
  it("divides cooked quantity by the processing ratio", () => {
    // 7 kg cooked at 0.7 yield needs 10 kg raw.
    expect(cookedToRaw(7, 0.7)).toBeCloseTo(10);
  });

  it("passes through when the ratio is missing, zero, or invalid", () => {
    expect(cookedToRaw(5, null)).toBe(5);
    expect(cookedToRaw(5, undefined)).toBe(5);
    expect(cookedToRaw(5, 0)).toBe(5);
    expect(cookedToRaw(5, Number.NaN)).toBe(5);
  });
});

// Regression guard for the nutritionals bug where every recipe quantity was
// treated as grams: a 1.2 kg ingredient contributed 1.2 g to the label maths,
// understating its nutrients ~1000x.
describe("toGrams", () => {
  it("converts kg to grams", () => {
    expect(toGrams(1.2, "kg")).toBe(1200);
  });

  it("converts litres to grams at density 1", () => {
    expect(toGrams(0.5, "l")).toBe(500);
    expect(toGrams(2, "Litres")).toBe(2000);
  });

  it("passes grams and millilitres through", () => {
    expect(toGrams(250, "g")).toBe(250);
    expect(toGrams(250, "ml")).toBe(250);
  });

  it("treats unknown or missing units as grams", () => {
    expect(toGrams(3, "each")).toBe(3);
    expect(toGrams(3, null)).toBe(3);
    expect(toGrams(3, undefined)).toBe(3);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toGrams(1, " KG ")).toBe(1000);
  });
});

// Regression guard for the sub-recipe yield bug: three hand-rolled copies of
// this conversion disagreed about litres — the sub-recipe form skipped "l"
// rows (10 L of mayonnaise contributed NOTHING to the derived batch yield),
// the recipe form counted 10 L as 10 g, the server as 10 kg.
describe("gramsOrNull / kgOrNull", () => {
  it("converts weights and volumes like toGrams", () => {
    expect(gramsOrNull(10, "l")).toBe(10000);
    expect(kgOrNull(10, "l")).toBe(10);
    expect(kgOrNull(536, "g")).toBeCloseTo(0.536);
    expect(gramsOrNull(2, "kg")).toBe(2000);
    expect(gramsOrNull(250, "ml")).toBe(250);
  });

  it("returns null for count units so totals can skip them, not miscount them", () => {
    expect(gramsOrNull(23, "each")).toBeNull();
    expect(gramsOrNull(6, "box")).toBeNull();
    expect(kgOrNull(4, "roll")).toBeNull();
    expect(kgOrNull(15, "pieces")).toBeNull();
  });

  it("treats a missing unit as grams, matching historical rows", () => {
    expect(gramsOrNull(3, null)).toBe(3);
  });
});

describe("isWeighable", () => {
  it("is true for weights and volumes, false for counts", () => {
    for (const u of ["g", "kg", "ml", "l", "Litres", "mg"]) expect(isWeighable(u)).toBe(true);
    for (const u of ["each", "pieces", "box", "roll", "pcs"]) expect(isWeighable(u)).toBe(false);
  });
});
