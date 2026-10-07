import { describe, it, expect } from "vitest";
import { latestRowPerKey, stockRowKey, isBagRow, bagRowName } from "./stock-control-rows";

const row = (over: Partial<{ id: number; location: string; itemType: string; recipeId: number | null; ingredientId: number | null; packSize: number | null; quantity: number }>) => ({
  id: 1,
  location: "production_fridge",
  itemType: "recipe",
  recipeId: 7,
  ingredientId: null,
  packSize: 2,
  quantity: 0,
  ...over,
});

describe("stock control row keying", () => {
  it("regression: the 2-pack row never shows the bag count, even when the bag row is newest", () => {
    // Newest first: wrapping just logged 73 bags; the last 2-pack reading was 120.
    const rows = [
      row({ id: 3, packSize: 8, quantity: 73 }),
      row({ id: 2, packSize: 2, quantity: 120 }),
      row({ id: 1, packSize: 2, quantity: 90 }),
    ];
    const latest = latestRowPerKey(rows);
    const packs = latest.find(r => !isBagRow(r));
    const bags = latest.find(r => isBagRow(r));
    expect(packs?.quantity).toBe(120);
    expect(bags?.quantity).toBe(73);
    expect(latest).toHaveLength(2);
  });

  it("keys bags and packs separately per recipe and location", () => {
    expect(stockRowKey(row({ packSize: 8 }))).not.toBe(stockRowKey(row({ packSize: 2 })));
    expect(stockRowKey(row({ packSize: 8, recipeId: 1 }))).not.toBe(stockRowKey(row({ packSize: 8, recipeId: 2 })));
    expect(stockRowKey(row({ location: "production_freezer" }))).not.toBe(stockRowKey(row({})));
  });

  it("treats any non-8 recipe pack size as the packs row (unchanged behaviour)", () => {
    expect(stockRowKey(row({ packSize: null }))).toBe(stockRowKey(row({ packSize: 2 })));
    expect(stockRowKey(row({ packSize: 4 }))).toBe(stockRowKey(row({ packSize: 2 })));
  });

  it("ingredient rows ignore pack size and are never bags", () => {
    const ing = row({ itemType: "ingredient", recipeId: null, ingredientId: 5, packSize: 8 });
    expect(isBagRow(ing)).toBe(false);
    expect(stockRowKey(ing)).toBe("production_fridge|i:5");
  });

  it("names a bag row after its recipe", () => {
    expect(bagRowName("Margherita")).toBe("Margherita — 8-pack bags");
  });
});
