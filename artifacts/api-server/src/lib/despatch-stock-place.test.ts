import { describe, it, expect } from "vitest";
import { despatchStockPlace, freezerSetFromShopify } from "./despatch-stock-place";

describe("despatchStockPlace — what an order takes off the planner's stock", () => {
  it("fried chicken comes off the freezer, even with core-menu-only on (19 Nov 2026)", () => {
    expect(despatchStockPlace({ isCoreMenu: false, category: "Fried Chicken" }, true)).toBe("freezer");
    expect(despatchStockPlace({ isCoreMenu: false, category: "Fried Chicken" }, false)).toBe("freezer");
  });
  it("core-menu calzones come off the fridge as before", () => {
    expect(despatchStockPlace({ isCoreMenu: true, category: "Calzone" }, true)).toBe("fridge");
  });
  it("non-core products are still skipped while core-menu-only is on", () => {
    expect(despatchStockPlace({ isCoreMenu: false, category: "Calzone" }, true)).toBe("skip");
    expect(despatchStockPlace({ isCoreMenu: false, category: null }, false)).toBe("fridge");
  });
});

describe("freezerSetFromShopify — starting fried chicken stock from Shopify", () => {
  it("makes each product match Shopify's on-hand, leaving one Shopify has no figure for", () => {
    expect(freezerSetFromShopify([
      { recipeId: 24, name: "Buttermilk 400g", planner: 0, shopify: 67 },
      { recipeId: 28, name: "Buttermilk 1kg", planner: 25, shopify: 20 },
      { recipeId: 29, name: "Korean 500g", planner: 3, shopify: null },
      { recipeId: 30, name: "Korean 1.2kg", planner: 0, shopify: -2 },
    ]).map(r => [r.recipeId, r.shopify, r.change])).toEqual([[24, 67, 67], [28, 20, -5], [29, null, 0], [30, 0, 0]]);
  });
});
