import { describe, expect, it } from "vitest";
import { f2fBase, suggestF2f, type F2fProduct } from "./recipe-f2f";

// Real titles from live (25 Nov 2026).
const products: F2fProduct[] = [
  { variantId: "56340047757686", title: "F2F - Garlic Cheese Calzones (v)", variantTitle: null },
  { variantId: "56340041859446", title: "F2F - TCK Signature Margherita (v)", variantTitle: null },
  { variantId: "57321719431542", title: "F2F - CarniZone Meat Feast", variantTitle: null },
  { variantId: "56340039238006", title: "F2F - The Donald 3.0", variantTitle: null },
];

describe("F2F links", () => {
  it("reads the base of an F2F title", () => {
    expect(f2fBase("F2F - The Donald 3.0")).toBe("thedonald30");
    expect(f2fBase("The Donald 3.0")).toBeNull();
  });
  it("matches the recipe's own Shopify product title", () => {
    expect(suggestF2f({ name: "Garlic Cheese Calzones (V)", productTitles: ["Garlic Cheese Calzones (v)", "FREE Garlic Cheese Calzones (v)"] }, products, new Set())?.variantId).toBe("56340047757686");
    expect(suggestF2f({ name: "The Donald", productTitles: ["The Donald 3.0"] }, products, new Set())?.variantId).toBe("56340039238006");
  });
  it("ignores spaces and emoji: CarniZone 🍗 🍖🥩 MeatFeast ↔ F2F - CarniZone Meat Feast", () => {
    expect(suggestF2f({ name: "Carnizone", productTitles: ["CarniZone 🍗 🍖🥩 MeatFeast"] }, products, new Set())?.variantId).toBe("57321719431542");
  });
  it("no match when the names really differ (a person picks it)", () => {
    expect(suggestF2f({ name: "Slow Birchstead Beef", productTitles: ["Slow Birchstead Beef"] }, products, new Set())).toBeNull();
  });
  it("never suggests an F2F product already linked elsewhere", () => {
    expect(suggestF2f({ name: "Margherita", productTitles: ["TCK Signature Margherita (v)"] }, products, new Set(["56340041859446"]))).toBeNull();
  });
});
