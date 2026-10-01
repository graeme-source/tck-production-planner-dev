import { describe, it, expect } from "vitest";
import {
  priceAtSupplier,
  orderValueAtSupplier,
  shortfall,
  suggestTopUps,
  type IngredientPricing,
  type CardForTopUp,
} from "./minimum-order";

// Supplier ids — made up; nothing in the logic knows names.
const FRUIT = 1; // has a £75 minimum
const WHOLESALE = 2;
const DAIRY = 3;

const pricing = (rows: IngredientPricing[]) => new Map(rows.map(r => [r.ingredientId, r]));

const line = (ingredientId: number, ingredientName: string, costPerPack: number, editedPacks: number, extra: Partial<{ isMisc: boolean }> = {}) =>
  ({ ingredientId, ingredientName, costPerPack, editedPacks, ...extra });

describe("priceAtSupplier", () => {
  const p: IngredientPricing = { ingredientId: 10, supplierId: WHOLESALE, secondarySupplierId: FRUIT, costPerPack: 5, secondaryCostPerPack: 6.5 };

  it("uses the line's own price at the primary supplier", () => {
    expect(priceAtSupplier({ ingredientId: 10, costPerPack: 5.2 }, WHOLESALE, p)).toEqual({ price: 5.2, confirmed: true });
  });
  it("uses the saved secondary price at the secondary supplier", () => {
    expect(priceAtSupplier({ ingredientId: 10, costPerPack: 5 }, FRUIT, p)).toEqual({ price: 6.5, confirmed: true });
  });
  it("falls back to the primary price, unconfirmed, when no secondary price is saved", () => {
    expect(priceAtSupplier({ ingredientId: 10, costPerPack: 5 }, FRUIT, { ...p, secondaryCostPerPack: null }))
      .toEqual({ price: 5, confirmed: false });
  });
  it("flags any other supplier as unconfirmed", () => {
    expect(priceAtSupplier({ ingredientId: 10, costPerPack: 5 }, DAIRY, p)).toEqual({ price: 5, confirmed: false });
  });
  it("leaves misc lines alone", () => {
    expect(priceAtSupplier({ ingredientId: -1, costPerPack: 0, isMisc: true }, FRUIT, undefined)).toEqual({ price: 0, confirmed: true });
  });
});

describe("orderValueAtSupplier / shortfall", () => {
  it("sums packs × price at that supplier and lists unconfirmed prices", () => {
    const map = pricing([
      { ingredientId: 1, supplierId: FRUIT, secondarySupplierId: null, costPerPack: 10, secondaryCostPerPack: null },
      { ingredientId: 2, supplierId: WHOLESALE, secondarySupplierId: FRUIT, costPerPack: 4, secondaryCostPerPack: null },
    ]);
    const v = orderValueAtSupplier([line(1, "Onions", 10, 3), line(2, "Cream", 4, 2)], FRUIT, map);
    expect(v.value).toBe(38);
    expect(v.unconfirmedIngredientIds).toEqual([2]);
  });
  it("no minimum → never short", () => {
    expect(shortfall(10, null)).toBe(0);
    expect(shortfall(10, 0)).toBe(0);
  });
  it("reports the gap in pounds", () => {
    expect(shortfall(58.4, 75)).toBe(16.6);
    expect(shortfall(75, 75)).toBe(0);
  });
});

describe("suggestTopUps", () => {
  const base = pricing([
    { ingredientId: 1, supplierId: FRUIT, secondarySupplierId: null, costPerPack: 10, secondaryCostPerPack: null },
    // Double cream: wholesale £3/pack, fruit £4.55/pack
    { ingredientId: 20, supplierId: WHOLESALE, secondarySupplierId: FRUIT, costPerPack: 3, secondaryCostPerPack: 4.55 },
    // Cheddar: wholesale £9/pack, fruit £9.40/pack
    { ingredientId: 21, supplierId: WHOLESALE, secondarySupplierId: FRUIT, costPerPack: 9, secondaryCostPerPack: 9.4 },
    // Salt: wholesale only (secondary is someone else)
    { ingredientId: 22, supplierId: WHOLESALE, secondarySupplierId: DAIRY, costPerPack: 1, secondaryCostPerPack: 1.2 },
  ]);
  const fruitCard = (packs: number): CardForTopUp => ({
    supplierId: FRUIT, supplierName: "Fruit Co", minimumOrderValue: 75, lines: [line(1, "Onions", 10, packs)],
  });

  it("an order that exactly meets the minimum gets no suggestions", () => {
    const wholesale: CardForTopUp = { supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null, lines: [line(20, "Double Cream", 3, 4)] };
    const plan = suggestTopUps(FRUIT, [fruitCard(7.5), wholesale], base);
    expect(plan.gap).toBe(0);
    expect(plan.suggestions).toEqual([]);
  });

  it("no candidates → just the gap, nothing to suggest", () => {
    const wholesale: CardForTopUp = { supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null, lines: [line(22, "Salt", 1, 5)] };
    const plan = suggestTopUps(FRUIT, [fruitCard(5), wholesale], base);
    expect(plan.gap).toBe(25);
    expect(plan.suggestions).toEqual([]);
    expect(plan.closesGap).toBe(false);
  });

  it("suppliers with no minimum get nothing", () => {
    const card: CardForTopUp = { ...fruitCard(1), minimumOrderValue: null };
    expect(suggestTopUps(FRUIT, [card], base).suggestions).toEqual([]);
  });

  it("prefers the set with the cheapest extra cost that closes the gap", () => {
    // Gap = £75 − £50 = £25.
    // Cream ×6 adds £27.30 for £9.30 extra; cheddar ×3 adds £28.20 for £1.20 extra.
    const wholesale: CardForTopUp = {
      supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null,
      lines: [line(20, "Double Cream", 3, 6), line(21, "Mature Grated Cheddar", 9, 3), line(22, "Salt", 1, 4)],
    };
    const plan = suggestTopUps(FRUIT, [fruitCard(5), wholesale], base);
    expect(plan.gap).toBe(25);
    expect(plan.closesGap).toBe(true);
    expect(plan.suggestions.map(s => s.ingredientName)).toEqual(["Mature Grated Cheddar"]);
    expect(plan.suggestions[0]).toMatchObject({ addedValue: 28.2, costThere: 27, extraCost: 1.2, priceConfirmed: true, packs: 3, fromSupplierName: "Wholesale" });
    expect(plan.totalExtraCost).toBe(1.2);
  });

  it("combines items when one isn't enough", () => {
    // Gap £40: cream £27.30 + cheddar £28.20 together.
    const wholesale: CardForTopUp = {
      supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null,
      lines: [line(20, "Double Cream", 3, 6), line(21, "Mature Grated Cheddar", 9, 3)],
    };
    const plan = suggestTopUps(FRUIT, [fruitCard(3.5), wholesale], base);
    expect(plan.gap).toBe(40);
    expect(plan.closesGap).toBe(true);
    expect(plan.suggestions.map(s => s.ingredientId).sort()).toEqual([20, 21]);
  });

  it("flags an unconfirmed price and treats it as the same price", () => {
    const noSecondaryPrice = new Map(base);
    noSecondaryPrice.set(20, { ingredientId: 20, supplierId: WHOLESALE, secondarySupplierId: FRUIT, costPerPack: 3, secondaryCostPerPack: null });
    const wholesale: CardForTopUp = { supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null, lines: [line(20, "Double Cream", 3, 10)] };
    const plan = suggestTopUps(FRUIT, [fruitCard(5), wholesale], noSecondaryPrice);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({ priceConfirmed: false, addedValue: 30, extraCost: 0 });
  });

  it("never drops the other supplier below ITS minimum when a safe set exists", () => {
    // Wholesale has a £50 minimum and £57 on order: moving cheddar (£27) would
    // leave £30 — under. Cream (£9 there) leaves £48 — also under. Dairy has
    // cream too with no minimum, so moving Dairy's cream is the safe choice.
    const p = new Map(base);
    p.set(30, { ingredientId: 30, supplierId: DAIRY, secondarySupplierId: FRUIT, costPerPack: 3, secondaryCostPerPack: 4 });
    const wholesale: CardForTopUp = {
      supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: 50,
      lines: [line(21, "Mature Grated Cheddar", 9, 3), line(20, "Double Cream", 3, 3), line(22, "Salt", 1, 21)],
    };
    const dairy: CardForTopUp = { supplierId: DAIRY, supplierName: "Dairy", minimumOrderValue: null, lines: [line(30, "Single Cream", 3, 8)] };
    const plan = suggestTopUps(FRUIT, [fruitCard(5), wholesale, dairy], p);
    expect(plan.closesGap).toBe(true);
    expect(plan.suggestions.map(s => s.ingredientName)).toEqual(["Single Cream"]);
    expect(plan.suggestions.every(s => !s.leavesSourceUnderMinimum)).toBe(true);
  });

  it("says so when the only way to close the gap drops the other supplier under its minimum", () => {
    const wholesale: CardForTopUp = {
      supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: 50,
      lines: [line(21, "Mature Grated Cheddar", 9, 3), line(22, "Salt", 1, 30)],
    };
    const plan = suggestTopUps(FRUIT, [fruitCard(5), wholesale], base);
    expect(plan.closesGap).toBe(true);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({ ingredientName: "Mature Grated Cheddar", leavesSourceUnderMinimum: true, sourceMinimum: 50 });
  });

  it("returns every candidate, not closing, when even all of them fall short", () => {
    const wholesale: CardForTopUp = { supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null, lines: [line(20, "Double Cream", 3, 2)] };
    const plan = suggestTopUps(FRUIT, [fruitCard(1), wholesale], base);
    expect(plan.gap).toBe(65);
    expect(plan.closesGap).toBe(false);
    expect(plan.suggestions.map(s => s.ingredientName)).toEqual(["Double Cream"]);
  });

  it("skips lines on cards that can't give lines, zero-pack lines and misc lines", () => {
    const reopened: CardForTopUp = {
      supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null, canGiveLines: false,
      lines: [line(20, "Double Cream", 3, 10)],
    };
    const dairy: CardForTopUp = {
      supplierId: DAIRY, supplierName: "Dairy", minimumOrderValue: null,
      lines: [line(21, "Mature Grated Cheddar", 9, 0), line(-1, "Sample", 0, 1, { isMisc: true })],
    };
    expect(suggestTopUps(FRUIT, [fruitCard(5), reopened, dairy], base).suggestions).toEqual([]);
  });

  it("offers an item whose PRIMARY supplier is this one but sits on another card", () => {
    const wholesale: CardForTopUp = { supplierId: WHOLESALE, supplierName: "Wholesale", minimumOrderValue: null, lines: [line(1, "Onions", 10, 3)] };
    const fruit: CardForTopUp = { supplierId: FRUIT, supplierName: "Fruit Co", minimumOrderValue: 75, lines: [] };
    const plan = suggestTopUps(FRUIT, [fruit, wholesale], base);
    expect(plan.gap).toBe(75);
    expect(plan.suggestions.map(s => s.ingredientName)).toEqual(["Onions"]);
  });
});
