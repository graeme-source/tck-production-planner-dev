import { describe, expect, it } from "vitest";
import { fridgeCell, shopifyCell, type ListingStock } from "./recipe-stock-cells";

// Shaped like the live listings read on 25 Nov 2026.
const L = (o: Partial<ListingStock>): ListingStock => ({
  variantId: "1", productTitle: "Chicken & Chorizo", variantTitle: "2 Pack",
  status: "ACTIVE", online: true, tracked: true, policy: "DENY", available: 10, ...o,
});

describe("In fridge cell (25 Nov 2026)", () => {
  it("shows the latest 2-pack count; none is a dash, not 0", () => {
    expect(fridgeCell(14)).toMatchObject({ text: "14", sortValue: 14, tone: "normal" });
    expect(fridgeCell(0)).toMatchObject({ text: "0", tone: "low" });
    expect(fridgeCell(null)).toMatchObject({ text: "—", sortValue: null });
  });
});

describe("On Shopify cell (25 Nov 2026)", () => {
  it("a counted listing on the website shows Shopify's available number (Birchstead: 46)", () => {
    expect(shopifyCell([L({ available: 46 })], true)).toMatchObject({ text: "46", sortValue: 46, tone: "normal" });
  });

  it("an untracked live listing never sells out on stock — 'No limit', not its leftover figure", () => {
    const c = shopifyCell([L({ tracked: false, available: -15175 })], true);
    expect(c.text).toBe("No limit");
    expect(c.title).toContain("not counted");
  });

  it("keeps-selling-at-0 is also no limit", () => {
    expect(shopifyCell([L({ policy: "CONTINUE", available: -3 })], true).text).toBe("No limit");
  });

  it("one unlimited listing on the website beats a counted one beside it (Chicken & Chorizo)", () => {
    const c = shopifyCell([L({ variantId: "a", tracked: false, policy: "CONTINUE", available: 88658 }), L({ variantId: "b", available: -1318 })], true);
    expect(c.text).toBe("No limit");
    expect(c.title).toContain("-1318 available");
  });

  it("ignores draft listings and active ones that aren't on the website", () => {
    expect(shopifyCell([L({ variantId: "a", status: "DRAFT", available: 99 }), L({ variantId: "b", available: 3 })], true).text).toBe("3");
    expect(shopifyCell([L({ online: false, available: 99 })], true).text).toBe("Not on sale");
    expect(shopifyCell([L({ status: "ARCHIVED" })], true).text).toBe("Not on sale");
  });

  it("two counted live listings are shown side by side, never added up", () => {
    expect(shopifyCell([L({ variantId: "a", available: 12 }), L({ variantId: "b", available: 4 })], true).text).toBe("12 · 4");
  });

  it("no listing, or Shopify unreachable", () => {
    expect(shopifyCell([], true).text).toBe("—");
    expect(shopifyCell([L({ status: null, available: null, tracked: null, online: null })], false).text).toBe("?");
  });

  it("flags oversold (negative) and sold out", () => {
    expect(shopifyCell([L({ available: -2 })], true).tone).toBe("warn");
    expect(shopifyCell([L({ available: 0 })], true).tone).toBe("low");
  });
});
