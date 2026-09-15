import { describe, it, expect } from "vitest";
import { computeFridgeAllocation, type FridgeAvailability, type GateOrder } from "./fridge-gate";

// Regression guard for the 2026-09-14 extraction: the allocation walk moved
// out of pages/fulfilment.tsx so the wrapping station's release banner can
// share it verbatim. These tests pin the walk's behaviour.

const availability = (over: Partial<FridgeAvailability> = {}): FridgeAvailability => ({
  stock: [
    { recipeId: 1, recipeName: "Margherita", packs: 10 },
    { recipeId: 2, recipeName: "Carnizone", packs: 2 },
  ],
  variants: {
    "101": { recipeId: 1, packsPerUnit: 1 },
    "102": { recipeId: 2, packsPerUnit: 1 },
  },
  recipeNames: { 1: "Margherita", 2: "Carnizone" },
  specialRecipeId: null,
  ...over,
});

const order = (id: number, lines: Array<[variantId: number | null, qty: number, title?: string, variantTitle?: string]>): GateOrder => ({
  id,
  line_items: lines.map(([variant_id, quantity, title, variant_title]) => ({
    variant_id,
    quantity,
    title: title ?? "Some product",
    variant_title: variant_title ?? "2 pack",
    price: "10.00",
    grams: 700,
  })),
});

describe("computeFridgeAllocation", () => {
  it("is inactive (everything pickable) without availability data", () => {
    const orders = [order(1, [[101, 5]])];
    const r = computeFridgeAllocation(orders, null);
    expect(r.active).toBe(false);
    expect(r.pickable).toEqual(orders);
    expect(r.deficits).toEqual([]);
  });

  it("holds an order the fridge can't cover and reports the deficit", () => {
    const r = computeFridgeAllocation([order(1, [[102, 5]])], availability());
    expect(r.held.map(o => o.id)).toEqual([1]);
    expect(r.deficits).toEqual([{ recipeName: "Carnizone", packs: 3 }]);
  });

  it("lets a smaller later order through past a held big one", () => {
    const r = computeFridgeAllocation(
      [order(1, [[102, 5]]), order(2, [[102, 2]])],
      availability(),
    );
    expect(r.held.map(o => o.id)).toEqual([1]);
    expect(r.pickable.map(o => o.id)).toEqual([2]);
    // Held demand minus what's left AFTER the small order took its packs.
    expect(r.deficits).toEqual([{ recipeName: "Carnizone", packs: 5 }]);
  });

  it("allocates sequentially — stock consumed by earlier orders", () => {
    const r = computeFridgeAllocation(
      [order(1, [[101, 8]]), order(2, [[101, 3]])],
      availability(),
    );
    expect(r.pickable.map(o => o.id)).toEqual([1]);
    expect(r.held.map(o => o.id)).toEqual([2]);
    expect(r.deficits).toEqual([{ recipeName: "Margherita", packs: 1 }]);
  });

  it("multiplies packsPerUnit (a 2×2-pack bundle draws 2 packs per unit)", () => {
    const av = availability({ variants: { "101": { recipeId: 1, packsPerUnit: 2 } } });
    const r = computeFridgeAllocation([order(1, [[101, 6]])], av);
    expect(r.held.map(o => o.id)).toEqual([1]);
    expect(r.deficits).toEqual([{ recipeName: "Margherita", packs: 2 }]);
  });

  it("gates 8-pack bag lines on TODAY's wrapped bags via title lookup", () => {
    const av = availability({
      bagStock: [{ recipeId: 1, bags: 0 }],
      bagRecipeByTitle: { "margherita": 1 },
    });
    const r = computeFridgeAllocation(
      [order(1, [[999, 1, "Margherita", "8 Pack Bag"]])],
      av,
    );
    expect(r.held.map(o => o.id)).toEqual([1]);
    expect(r.deficits).toEqual([{ recipeName: "Margherita (8-pack bags)", packs: 1 }]);
  });

  it("never gates on Shopify-tracked lines (fried chicken etc.)", () => {
    const av = availability({ shopifyTracked: { "555": 4 } });
    const r = computeFridgeAllocation([order(1, [[555, 2, "Korean Fried Chicken 500g", "500g"]])], av);
    expect(r.pickable.map(o => o.id)).toEqual([1]);
    expect(r.uncheckedTitles.size).toBe(0);
  });

  it("ignores £0 zero-gram paper inserts", () => {
    const o: GateOrder = {
      id: 1,
      line_items: [{ variant_id: 777, quantity: 1, title: "Order Insert (first time customers)", variant_title: null, price: "0.00", grams: 0 }],
    };
    const r = computeFridgeAllocation([o], availability());
    expect(r.pickable.map(x => x.id)).toEqual([1]);
    expect(r.uncheckedTitles.size).toBe(0);
  });

  it("surfaces truly unchecked lines without holding the order", () => {
    const r = computeFridgeAllocation([order(1, [[888, 1, "Mystery Product"]])], availability());
    expect(r.pickable.map(o => o.id)).toEqual([1]);
    expect([...r.uncheckedTitles][0]).toContain("Mystery Product");
    expect(r.uncheckedOrderIds.has(1)).toBe(true);
  });

  it("names the short pools on each held order", () => {
    const r = computeFridgeAllocation([order(7, [[102, 5]])], availability());
    expect(r.shortFor.get(7)?.[0]).toContain("Carnizone (need 5, fridge has 2)");
  });
});
