import { describe, it, expect } from "vitest";
import { resolveRecipeBins, type RecipeBin, type RecipeVariantMapping } from "./recipe-bins";

const bin = (zone: string, door: number | null, shelf: string | null, label = `${door ?? ""}${shelf ?? ""}`): RecipeBin =>
  ({ zone, locationLabel: label, door, shelf });

const variantBins = (entries: Record<string, RecipeBin>) => new Map(Object.entries(entries));
const NO_SKU_BINS = new Map<string, RecipeBin>();

describe("resolveRecipeBins", () => {
  it("gives a recipe the bin of its single variant", () => {
    const mappings: RecipeVariantMapping[] = [{ recipeId: 7, variantIds: ["v1"] }];
    const bins = resolveRecipeBins(mappings, variantBins({ v1: bin("fridge", 3, "B") }), NO_SKU_BINS);
    expect(bins.get(7)).toEqual([bin("fridge", 3, "B")]);
  });

  it("collects every bin when a recipe's variants sit in different bins", () => {
    // 2-pack behind door 6, 8-pack bag behind door 1, wonky behind door 6 too.
    const mappings: RecipeVariantMapping[] = [
      { recipeId: 7, variantIds: ["main", "wonky", "eight"] },
    ];
    const bins = resolveRecipeBins(
      mappings,
      variantBins({
        main: bin("fridge", 6, "B"),
        wonky: bin("fridge", 6, "B"),
        eight: bin("fridge", 1, "A"),
      }),
      NO_SKU_BINS,
    );
    // The duplicate door-6 bin is collapsed — it is one stop on the walk.
    expect(bins.get(7)).toEqual([bin("fridge", 6, "B"), bin("fridge", 1, "A")]);
  });

  it("merges the bins of several mapping rows for one recipe", () => {
    const mappings: RecipeVariantMapping[] = [
      { recipeId: 7, variantIds: ["a"] },
      { recipeId: 7, variantIds: ["b"] },
    ];
    const bins = resolveRecipeBins(
      mappings,
      variantBins({ a: bin("fridge", 2, "A"), b: bin("freezer", 8, "C") }),
      NO_SKU_BINS,
    );
    expect(bins.get(7)).toEqual([bin("fridge", 2, "A"), bin("freezer", 8, "C")]);
  });

  it("collapses the same bin reached from two different mapping rows", () => {
    const mappings: RecipeVariantMapping[] = [
      { recipeId: 7, variantIds: ["a"] },
      { recipeId: 7, variantIds: ["b"] },
    ];
    const bins = resolveRecipeBins(
      mappings,
      variantBins({ a: bin("fridge", 2, "A"), b: bin("fridge", 2, "A") }),
      NO_SKU_BINS,
    );
    expect(bins.get(7)).toEqual([bin("fridge", 2, "A")]);
  });

  it("returns an empty list — not a missing entry — for a recipe with no binned variant", () => {
    const mappings: RecipeVariantMapping[] = [{ recipeId: 9, variantIds: ["unplaced"] }];
    const bins = resolveRecipeBins(mappings, new Map(), NO_SKU_BINS);
    expect(bins.get(9)).toEqual([]);
    expect(bins.has(9)).toBe(true);
  });

  it("ignores null and empty variant ids", () => {
    const mappings: RecipeVariantMapping[] = [
      { recipeId: 7, variantIds: [null, undefined, "", "real"] },
    ];
    const bins = resolveRecipeBins(mappings, variantBins({ real: bin("fridge", 4, "A") }), NO_SKU_BINS);
    expect(bins.get(7)).toEqual([bin("fridge", 4, "A")]);
  });

  it("falls back to the SKU's legacy location for a variant with no bin", () => {
    const mappings: RecipeVariantMapping[] = [{ recipeId: 7, variantIds: ["unplaced"], sku: "3c" }];
    const bins = resolveRecipeBins(
      mappings,
      new Map(),
      new Map([["3c", bin("ambient", null, null, "Dry store")]]),
    );
    expect(bins.get(7)).toEqual([bin("ambient", null, null, "Dry store")]);
  });

  it("prefers the variant's own bin over the shared SKU label's", () => {
    const mappings: RecipeVariantMapping[] = [{ recipeId: 7, variantIds: ["v1"], sku: "1" }];
    const bins = resolveRecipeBins(
      mappings,
      variantBins({ v1: bin("fridge", 5, "D") }),
      new Map([["1", bin("ambient", null, null, "Dry store")]]),
    );
    expect(bins.get(7)).toEqual([bin("fridge", 5, "D")]);
  });

  it("keeps recipes apart", () => {
    const mappings: RecipeVariantMapping[] = [
      { recipeId: 1, variantIds: ["a"] },
      { recipeId: 2, variantIds: ["b"] },
    ];
    const bins = resolveRecipeBins(
      mappings,
      variantBins({ a: bin("fridge", 1, "A"), b: bin("fridge", 2, "A") }),
      NO_SKU_BINS,
    );
    expect(bins.get(1)).toEqual([bin("fridge", 1, "A")]);
    expect(bins.get(2)).toEqual([bin("fridge", 2, "A")]);
  });
});
