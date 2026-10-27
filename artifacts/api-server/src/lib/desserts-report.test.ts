import { describe, expect, it } from "vitest";
import { buildDessertReport, isFivePack, type DessertOrder } from "./desserts-report";

const DESSERTS = new Set(["Rolo Chocolate Brownie", "Lemon & White Chocolate Blondie", "Cinnamon Buns"]);

describe("isFivePack", () => {
  it("matches on the variant title, which is where the pack format lives", () => {
    expect(isFivePack("Rolo Chocolate Brownie", "5 Pack")).toBe(true);
    expect(isFivePack("Rolo Chocolate Brownie", "5-pack")).toBe(true);
    expect(isFivePack("Rolo Chocolate Brownie", "Single")).toBe(false);
    expect(isFivePack("Rolo Chocolate Brownie", null)).toBe(false);
  });

  it("still matches a product-level 5-pack listing", () => {
    expect(isFivePack("Brownie 5 Pack", null)).toBe(true);
  });
});

describe("buildDessertReport", () => {
  const orders: DessertOrder[] = [
    { line_items: [
      { title: "Rolo Chocolate Brownie", variant_title: "5 Pack", quantity: 2 },
      { title: "Cinnamon Buns", variant_title: null, quantity: 3 },
    ] },
    { line_items: [
      { title: "Rolo Chocolate Brownie", variant_title: "5 Pack", quantity: 1 },
      { title: "Lemon & White Chocolate Blondie", variant_title: "5 Pack", quantity: 4 },
    ] },
    // Not a dessert — must be ignored entirely.
    { line_items: [{ title: "Godfather Calzone", variant_title: null, quantity: 9 }] },
  ];

  it("gives one headline number for 5-pack labels plus the per-variant pull list", () => {
    const r = buildDessertReport(orders, DESSERTS);
    expect(r.fivePackTotal).toBe(7);
    expect(r.fivePackProducts).toEqual([
      { title: "Lemon & White Chocolate Blondie — 5 Pack", quantity: 4 },
      { title: "Rolo Chocolate Brownie — 5 Pack", quantity: 3 },
    ]);
  });

  it("keeps non-5-pack desserts as their own lines", () => {
    const r = buildDessertReport(orders, DESSERTS);
    expect(r.products).toEqual([{ title: "Cinnamon Buns", quantity: 3 }]);
  });

  it("totals everything and reports no order counts", () => {
    const r = buildDessertReport(orders, DESSERTS);
    expect(r.totalQuantity).toBe(10);
    expect(JSON.stringify(r)).not.toContain("orderCount");
  });
});

describe("5-pack labels by variant (2026-10-27)", () => {
  it("groups by Shopify variant so each label carries that variant's barcode", () => {
    const r = buildDessertReport([
      { line_items: [{ title: "Rolo Chocolate Brownie", variant_title: "5 Pack", variant_id: 111, quantity: 2 }] },
      { line_items: [
        { title: "Rolo Chocolate Brownie", variant_title: "5 Pack", variant_id: 111, quantity: 1 },
        { title: "Lemon & White Chocolate Blondie", variant_title: "5 Pack", variant_id: "222", quantity: 4 },
        { title: "Cinnamon Buns", variant_title: null, variant_id: 333, quantity: 3 },
      ] },
    ], DESSERTS);
    expect(r.fivePackLabels).toEqual([
      { variantId: "222", productTitle: "Lemon & White Chocolate Blondie", quantity: 4 },
      { variantId: "111", productTitle: "Rolo Chocolate Brownie", quantity: 3 },
    ]);
    expect(r.fivePackLabels.reduce((t, l) => t + l.quantity, 0)).toBe(r.fivePackTotal);
  });
});
