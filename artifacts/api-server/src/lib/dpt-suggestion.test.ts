import { describe, expect, it } from "vitest";
import { computeSalesPacksByRecipe, weeklyAverage, type SuggestionOrder, type VariantMapRow } from "./dpt-suggestion";

const MAPPINGS: VariantMapRow[] = [
  { recipeId: 1, shopifyVariantId: "101", wonkyVariantId: "102", eightPackVariantId: "103", isCurrentSpecial: false },
  { recipeId: 2, shopifyVariantId: "201", wonkyVariantId: null, eightPackVariantId: null, isCurrentSpecial: false },
  { recipeId: 9, shopifyVariantId: "901", wonkyVariantId: null, eightPackVariantId: null, isCurrentSpecial: true },
];

describe("computeSalesPacksByRecipe", () => {
  it("sums main and wonky variants, counts 8-pack bags as 4 packs", () => {
    const orders: SuggestionOrder[] = [
      { line_items: [{ variant_id: 101, quantity: 2, title: "Godfather" }] },
      { line_items: [{ variant_id: "102", quantity: 1, title: "Godfather (Wonky)" }] },
      { line_items: [{ variant_id: 103, quantity: 1, title: "Godfather" }] },
      { line_items: [{ variant_id: 201, quantity: 3, title: "Garlic Cheese" }] },
    ];
    const totals = computeSalesPacksByRecipe(orders, MAPPINGS);
    expect(totals.get(1)).toBe(2 + 1 + 4);
    expect(totals.get(2)).toBe(3);
  });

  it("excludes the rotating special by title and by flag", () => {
    const orders: SuggestionOrder[] = [
      // Title-routed special line (mapped variant belongs to recipe 1, but the
      // title marks it as the special product) — must not count anywhere.
      { line_items: [{ variant_id: 101, quantity: 5, title: "Calzone Club Special" }] },
      // The is_current_special recipe's own variant — must not count either.
      { line_items: [{ variant_id: 901, quantity: 5, title: "BBQ Pulled Pork" }] },
      { line_items: [{ variant_id: 201, quantity: 1, title: "Garlic Cheese" }] },
    ];
    const totals = computeSalesPacksByRecipe(orders, MAPPINGS);
    expect(totals.get(1)).toBeUndefined();
    expect(totals.get(9)).toBeUndefined();
    expect(totals.get(2)).toBe(1);
  });

  it("skips cancelled orders and unmapped lines", () => {
    const orders: SuggestionOrder[] = [
      { cancelled_at: "2026-08-01T00:00:00Z", line_items: [{ variant_id: 201, quantity: 9, title: "Garlic Cheese" }] },
      { line_items: [{ variant_id: 999, quantity: 4, title: "Gift Card" }] },
    ];
    const totals = computeSalesPacksByRecipe(orders, MAPPINGS);
    expect(totals.size).toBe(0);
  });
});

describe("weeklyAverage", () => {
  it("scales a 30-day total to a rounded weekly figure", () => {
    expect(weeklyAverage(300, 30)).toBe(70);
    expect(weeklyAverage(0, 30)).toBe(0);
    expect(weeklyAverage(100, 0)).toBe(0);
  });
});
