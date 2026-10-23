import { describe, expect, it } from "vitest";
import { NUTRIENT_KEYS, ingredientGapChips, isNovaUnclassified, missingNutrients } from "./ingredient-gaps";

const full = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, 1])) as Record<(typeof NUTRIENT_KEYS)[number], number>;

describe("missingNutrients", () => {
  it("treats 0 as entered", () => {
    expect(missingNutrients(Object.fromEntries(NUTRIENT_KEYS.map(k => [k, 0])))).toEqual([]);
    expect(missingNutrients({ ...full, salt: "0" })).toEqual([]);
  });
  it("treats null, undefined and blank strings as missing", () => {
    expect(missingNutrients({ ...full, protein: null, salt: undefined, fat: " " })).toEqual(["fat", "protein", "salt"]);
  });
  it("lists every nutrient for an empty record", () => {
    expect(missingNutrients({})).toEqual([...NUTRIENT_KEYS]);
  });
});

describe("isNovaUnclassified", () => {
  it("is blank only for null/undefined", () => {
    expect(isNovaUnclassified(null)).toBe(true);
    expect(isNovaUnclassified(undefined)).toBe(true);
    expect(isNovaUnclassified(1)).toBe(false);
    expect(isNovaUnclassified(4)).toBe(false);
  });
});

describe("ingredientGapChips", () => {
  it("shows nothing for a complete ingredient", () => {
    expect(ingredientGapChips({ ...full, novaClass: 1 })).toEqual([]);
  });
  it("shows both chips, naming the missing nutrients", () => {
    const chips = ingredientGapChips({ ...full, energyKcal: null, protein: null, novaClass: null });
    expect(chips.map(c => c.label)).toEqual(["No nutrition", "No UPF class"]);
    expect(chips[0].title).toContain("energy (kcal)");
    expect(chips[0].title).toContain("protein");
  });
  it("one zero value doesn't raise a nutrition chip", () => {
    expect(ingredientGapChips({ ...full, sugars: 0, novaClass: 3 })).toEqual([]);
  });
});
