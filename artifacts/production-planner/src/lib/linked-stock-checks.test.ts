import { describe, it, expect } from "vitest";
import { linkedStockChecksForRecipe, type LinkedRow } from "./linked-stock-checks";

// Shapes taken from the live mirror (2026-09-24): a slow-cook sub-recipe
// links two stock-checked ingredients (50, 37) and one held-back component
// (301) to its raw meat 154. Another recipe links a seasoning (205) to its
// own meat 191.
const MEAT_A = 154;
const MEAT_B = 191;
const recipeA: LinkedRow[] = [
  { rawMeatIngredientId: MEAT_A, marinadeIngredientId: 50, addAtCooking: false },
  { rawMeatIngredientId: MEAT_A, marinadeIngredientId: 301, addAtCooking: true },
  { rawMeatIngredientId: MEAT_A, marinadeIngredientId: 37, addAtCooking: false },
];
const recipeB: LinkedRow[] = [
  { rawMeatIngredientId: MEAT_B, marinadeIngredientId: 205, addAtCooking: false },
];

describe("linkedStockChecksForRecipe", () => {
  it("places each linked ingredient under the meat it is linked to", () => {
    const r = linkedStockChecksForRecipe([MEAT_A], recipeA);
    expect(r.byMeat.get(MEAT_A)).toEqual({ afterPrep: [50, 37], heldBack: [301] });
    expect(r.unplaced).toEqual([]);
  });

  it("REGRESSION: another recipe's links never appear on this recipe", () => {
    // The page-level catch-all took every recipe's links minus the open
    // recipe's, so opening recipe B showed recipe A's two checks at the
    // bottom of the page, outside every panel (Graeme, 2026-09-24).
    const r = linkedStockChecksForRecipe([MEAT_B], recipeB);
    const everything = [
      ...[...r.byMeat.values()].flatMap(m => [...m.afterPrep, ...m.heldBack]),
      ...r.unplaced,
    ];
    expect(everything).toEqual([205]);
    expect(everything).not.toContain(50);
    expect(everything).not.toContain(37);
  });

  it("keeps a stale link (meat not in the recipe) on its own recipe, not lost", () => {
    const r = linkedStockChecksForRecipe([MEAT_B], [
      { rawMeatIngredientId: 999, marinadeIngredientId: 88, addAtCooking: false },
    ]);
    expect(r.byMeat.get(MEAT_B)).toEqual({ afterPrep: [], heldBack: [] });
    expect(r.unplaced).toEqual([88]);
  });

  it("offers one input per ingredient even when two meats link it", () => {
    const r = linkedStockChecksForRecipe([MEAT_A, MEAT_B], [
      { rawMeatIngredientId: MEAT_A, marinadeIngredientId: 50, addAtCooking: false },
      { rawMeatIngredientId: MEAT_B, marinadeIngredientId: 50, addAtCooking: false },
    ]);
    expect(r.byMeat.get(MEAT_A)?.afterPrep).toEqual([50]);
    expect(r.byMeat.get(MEAT_B)?.afterPrep).toEqual([]);
  });

  it("prefers the prep-day slot when an ingredient is linked both ways", () => {
    const r = linkedStockChecksForRecipe([MEAT_A], [
      { rawMeatIngredientId: MEAT_A, marinadeIngredientId: 50, addAtCooking: true },
      { rawMeatIngredientId: MEAT_A, marinadeIngredientId: 50, addAtCooking: false },
    ]);
    expect(r.byMeat.get(MEAT_A)).toEqual({ afterPrep: [50], heldBack: [] });
  });

  it("ignores sub-recipe links (no ingredient id to count)", () => {
    const r = linkedStockChecksForRecipe([MEAT_A], [
      { rawMeatIngredientId: MEAT_A, marinadeIngredientId: null, addAtCooking: false },
    ]);
    expect(r.byMeat.get(MEAT_A)).toEqual({ afterPrep: [], heldBack: [] });
    expect(r.unplaced).toEqual([]);
  });
});
