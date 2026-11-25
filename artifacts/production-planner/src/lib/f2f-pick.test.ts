import { describe, expect, it } from "vitest";
import { f2fChoices, filterF2fChoices, isF2fTitle, f2fLabel } from "./f2f-pick";

const shop = [
  { id: 1, title: "F2F - The New Yorker", variants: [{ id: 11, title: "2 Pack" }] },
  { id: 2, title: "The New Yorker", variants: [{ id: 21, title: "2 Pack" }] },
  { id: 3, title: "F2F - Buttermilk Fried Chicken Strips", variants: [{ id: 31, title: "6 Strip" }, { id: 32, title: "12 Strip" }] },
  { id: 4, title: "Sweet Chick O' Mine (F2F)", variants: [{ id: 41, title: "Default Title" }] },
];

describe("F2F link picker (25 Nov 2026)", () => {
  it("only F2F titles, wherever F2F sits in the name", () => {
    expect(isF2fTitle("F2F - The Donald")).toBe(true);
    expect(isF2fTitle("Chicken no Chorizo (F2F)")).toBe(true);
    expect(isF2fTitle("The Donald 3.0")).toBe(false);
    expect(isF2fTitle("Super Saver Great Eight F2F")).toBe(true);
  });

  it("every variant of an F2F product, never-sold ones included; variant name only when there are several", () => {
    const c = f2fChoices(shop, [], new Set());
    expect(c.map(x => x.variantId)).toEqual(["31", "32", "11", "41"]); // by title
    expect(c.find(x => x.variantId === "11")!.variantTitle).toBeNull();
    expect(c.find(x => x.variantId === "32")!.variantTitle).toBe("12 Strip");
    expect(c.find(x => x.variantId === "41")!.variantTitle).toBeNull();
  });

  it("adds F2F products seen on orders that Shopify's list didn't return, once", () => {
    const c = f2fChoices(shop, [{ variantId: "11", title: "F2F - The New Yorker", variantTitle: null }, { variantId: "99", title: "F2F - Old Thing", variantTitle: null }], new Set());
    expect(c.filter(x => x.variantId === "11")).toHaveLength(1);
    expect(c.some(x => x.variantId === "99")).toBe(true);
  });

  it("leaves out variants already linked to another recipe", () => {
    expect(f2fChoices(shop, [], new Set(["11", "31"])).map(x => x.variantId)).toEqual(["32", "41"]);
  });

  it("search matches every word, any order, any case", () => {
    const c = f2fChoices(shop, [], new Set());
    expect(filterF2fChoices(c, "strip 12").map(x => x.variantId)).toEqual(["32"]);
    expect(filterF2fChoices(c, "YORKER").map(x => x.variantId)).toEqual(["11"]);
    expect(filterF2fChoices(c, "  ")).toHaveLength(4);
  });

  it("labels with the variant when there is one", () => {
    expect(f2fLabel({ title: "F2F - X", variantTitle: "6 Strip" })).toBe("F2F - X · 6 Strip");
    expect(f2fLabel({ title: "F2F - X", variantTitle: null })).toBe("F2F - X");
  });
});
