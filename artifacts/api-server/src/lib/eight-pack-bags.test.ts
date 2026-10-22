import { describe, it, expect } from "vitest";
import { bagPoolFromEntries, isBagLine, isEightPackLine, lineBagQuantity, planBagDecrement, resolveBagLines, type BagLineContext } from "./eight-pack-bags";

const ctx: BagLineContext = {
  eightPackVariantToRecipe: new Map([["900", 11]]),
  productTitleToRecipe: new Map([["margherita calzone", 7], ["philly cheesesteak", 9]]),
};

describe("isEightPackLine / isBagLine", () => {
  it("detects the bag variant by title, case-insensitively", () => {
    expect(isEightPackLine({ variant_title: "8 Pack Bag" })).toBe(true);
    expect(isEightPackLine({ variant_title: "2 Pack" })).toBe(false);
    expect(isEightPackLine({ variant_title: null })).toBe(false);
  });
  it("detects a mapped eight_pack_variant_id even without a variant title", () => {
    expect(isBagLine({ variant_id: 900, title: "x", variant_title: null, quantity: 1 }, ctx)).toBe(true);
    expect(isBagLine({ variant_id: 901, title: "x", variant_title: null, quantity: 1 }, ctx)).toBe(false);
  });
});

describe("resolveBagLines", () => {
  it("sums bags per recipe and ignores 2-pack lines", () => {
    const r = resolveBagLines([
      { variant_id: 1, title: "Margherita Calzone", variant_title: "8 Pack Bag", quantity: 3 },
      { variant_id: 2, title: "Margherita Calzone", variant_title: "2 Pack", quantity: 5 },
      { variant_id: 3, title: " margherita calzone ", variant_title: "8 pack bag", quantity: 2 },
      { variant_id: 900, title: "Something", variant_title: null, quantity: 4 },
    ], ctx);
    expect([...r.bagsByRecipe.entries()]).toEqual([[7, 5], [11, 4]]);
    expect(r.unmapped).toEqual([]);
  });
  it("prefers the mapped variant over the product title", () => {
    const r = resolveBagLines([{ variant_id: 900, title: "Philly Cheesesteak", variant_title: "8 Pack Bag", quantity: 1 }], ctx);
    expect([...r.bagsByRecipe.entries()]).toEqual([[11, 1]]);
  });
  it("reports unresolvable bag lines instead of guessing", () => {
    const r = resolveBagLines([{ variant_id: 5, title: "Mystery", variant_title: "8 Pack Bag", quantity: 2 }], ctx);
    expect(r.bagsByRecipe.size).toBe(0);
    expect(r.unmapped).toEqual(["Mystery"]);
  });
  it("uses the post-refund quantity — a removed line takes nothing", () => {
    const r = resolveBagLines([
      { variant_id: 1, title: "Margherita Calzone", variant_title: "8 Pack Bag", quantity: 3, current_quantity: 0 },
      { variant_id: 1, title: "Philly Cheesesteak", variant_title: "8 Pack Bag", quantity: 3, current_quantity: 1 },
    ], ctx);
    expect([...r.bagsByRecipe.entries()]).toEqual([[9, 1]]);
  });
  it("lineBagQuantity falls back to quantity and floors junk at 0", () => {
    expect(lineBagQuantity({ variant_id: null, title: null, quantity: 4 })).toBe(4);
    expect(lineBagQuantity({ variant_id: null, title: null, quantity: -2 })).toBe(0);
  });
});

describe("planBagDecrement — never below zero", () => {
  it("takes the full despatch when the count covers it", () => {
    expect(planBagDecrement(10, 4)).toEqual({ delta: -4, resultingQty: 6, shortfall: 0 });
  });
  it("stops at zero and reports the shortfall", () => {
    expect(planBagDecrement(3, 5)).toEqual({ delta: -3, resultingQty: 0, shortfall: 2 });
    expect(planBagDecrement(0, 2)).toEqual({ delta: 0, resultingQty: 0, shortfall: 2 });
  });
  it("treats a negative on-hand record as zero", () => {
    expect(planBagDecrement(-4, 1)).toEqual({ delta: 0, resultingQty: 0, shortfall: 1 });
  });
});

// Issues #306 / #314: the packing fridge gate reads the 8-pack level like
// 2-packs — bags wrapped on an earlier day still count, and a despatch
// takes the bag off again so the level never only goes up.
describe("bagPoolFromEntries — the fridge gate's bag pool (#306)", () => {
  it("a bag wrapped 3 days ago still counts (no today-only rule)", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    expect(bagPoolFromEntries([{ recipe_id: 2, quantity: "1.0000", checked_at: threeDaysAgo }]))
      .toEqual([{ recipeId: 2, bags: 1 }]);
  });
  it("reads each recipe's LATEST level, never sums history", () => {
    expect(bagPoolFromEntries([
      { recipe_id: 2, quantity: "64", checked_at: "2026-10-07T12:00:00" },
      { recipe_id: 2, quantity: "1", checked_at: "2026-10-20T09:00:00" },
      { recipe_id: 5, quantity: "3", checked_at: "2026-10-21T09:00:00" },
    ])).toEqual([{ recipeId: 2, bags: 1 }, { recipeId: 5, bags: 3 }]);
  });
  it("no bags in the fridge → 0, and junk/negative levels floor at 0", () => {
    expect(bagPoolFromEntries([
      { recipe_id: 1, quantity: "0.0000", checked_at: "2026-10-21T09:00:00" },
      { recipe_id: 3, quantity: "-2", checked_at: "2026-10-21T09:00:00" },
      { recipe_id: 4, quantity: null, checked_at: null },
    ])).toEqual([{ recipeId: 1, bags: 0 }, { recipeId: 3, bags: 0 }, { recipeId: 4, bags: 0 }]);
  });
  it("an order going out takes its bag off the level the gate reads", () => {
    const lines = [
      { variant_id: 1, title: "Margherita Calzone", variant_title: "8 Pack Bag", quantity: 1 },
      { variant_id: 2, title: "Margherita Calzone", variant_title: "2 Pack", quantity: 3 },
    ];
    const bags = resolveBagLines(lines, ctx).bagsByRecipe.get(7) ?? 0;
    const plan = planBagDecrement(1, bags);
    expect(plan).toEqual({ delta: -1, resultingQty: 0, shortfall: 0 });
    expect(bagPoolFromEntries([{ recipe_id: 7, quantity: plan.resultingQty, checked_at: new Date() }]))
      .toEqual([{ recipeId: 7, bags: 0 }]);
  });
});
