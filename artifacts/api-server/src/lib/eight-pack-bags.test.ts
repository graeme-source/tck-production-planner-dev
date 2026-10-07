import { describe, it, expect } from "vitest";
import { isBagLine, isEightPackLine, lineBagQuantity, planBagDecrement, resolveBagLines, type BagLineContext } from "./eight-pack-bags";

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
