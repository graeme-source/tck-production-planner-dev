import { describe, it, expect } from "vitest";
import { countRemainingPacks, type VariantRecipe } from "./remaining-fulfilment-rules";

const MAC = 15;
const PIGS = 16;
const CALZONE = 3;

const variants = new Map<string, VariantRecipe>([
  ["111", { recipeId: MAC, isCoreMenu: true }],
  ["112", { recipeId: MAC, isCoreMenu: true }], // wonky variant, same stock
  ["211", { recipeId: PIGS, isCoreMenu: true }],
  ["311", { recipeId: CALZONE, isCoreMenu: false }],
]);

const orders = [
  { id: 1, line_items: [{ variant_id: 111, quantity: 2 }, { variant_id: 311, quantity: 1 }] },
  { id: 2, line_items: [{ variant_id: 211, quantity: 3 }] },
  { id: 3, line_items: [{ variant_id: 112, quantity: 1 }, { variant_id: 999, quantity: 1 }] },
];

describe("packs still to leave the fridge today", () => {
  it("counts every unfulfilled line against its recipe (wonky variants included)", () => {
    const c = countRemainingPacks(orders, variants);
    expect(c.byRecipe).toEqual({ [MAC]: 3, [PIGS]: 3, [CALZONE]: 1 });
    expect(c.unmappedVariantIds).toEqual(["999"]);
    expect(c.alreadyOffStockOrderCount).toBe(0);
  });

  it("(a) during the pack: an order already scanned off the fridge is not subtracted again", () => {
    // Order 1 has been scanned: the fridge count already dropped by its 2 mac
    // packs, but Shopify's order search still lists it as unfulfilled for a
    // moment (or the Shopify fulfil call failed after the decrement).
    const c = countRemainingPacks(orders, variants, {}, new Set([1]));
    expect(c.byRecipe[MAC]).toBe(1);
    expect(c.byRecipe[CALZONE]).toBeUndefined();
    expect(c.alreadyOffStockOrderCount).toBe(1);
  });

  it("(b) after the pack: every order scanned, nothing left to subtract", () => {
    const c = countRemainingPacks(orders, variants, {}, new Set([1, 2, 3]));
    expect(c.byRecipe).toEqual({});
    expect(c.alreadyOffStockOrderCount).toBe(3);
  });

  it("keeps the mac path to its own recipes and the calzone path's core-menu filter", () => {
    expect(countRemainingPacks(orders, variants, { limitToRecipeIds: [MAC, PIGS] }).byRecipe)
      .toEqual({ [MAC]: 3, [PIGS]: 3 });
    const core = countRemainingPacks(orders, variants, { coreMenuOnly: true });
    expect(core.byRecipe[CALZONE]).toBeUndefined();
    expect(core.skippedNonCoreLineItems).toBe(1);
  });
});
