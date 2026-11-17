import { describe, it, expect } from "vitest";
import { productOrderability, type GateVariantStock } from "./stock-gate-orderable";

const v = (inventoryQuantity: number | null, inventoryPolicy: string | null, tracked: boolean | null = true): GateVariantStock =>
  ({ inventoryQuantity, inventoryPolicy, tracked });

describe("productOrderability", () => {
  it("regression 17 Nov 2026: clearance product at 0 that doesn't sell when out of stock is skipped", () => {
    // The Benji / Open Fire BBQ / Chicken & Bacon Pie: quantity 0, policy deny.
    const r = productOrderability({ status: "ACTIVE", variants: [v(0, "DENY")] });
    expect(r.orderable).toBe(false);
    expect(r.orderable === false && r.reason).toBe("sold-out");
  });

  it("skips when every variant is sold out with deny (negative counts too)", () => {
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, "DENY"), v(-2, "deny")] }).orderable).toBe(false);
  });

  it("keeps a product whose stock is 0 but keeps selling when out of stock", () => {
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, "CONTINUE")] }).orderable).toBe(true);
  });

  it("keeps a product if any one variant can still sell", () => {
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, "DENY"), v(4, "DENY")] }).orderable).toBe(true);
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, "DENY"), v(0, "CONTINUE")] }).orderable).toBe(true);
  });

  it("keeps a product whose stock Shopify isn't tracking", () => {
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, "DENY", false)] }).orderable).toBe(true);
  });

  it("keeps a product when Shopify's answer is incomplete", () => {
    expect(productOrderability({ status: "ACTIVE", variants: [] }).orderable).toBe(true);
    expect(productOrderability({ status: "ACTIVE", variants: [v(null, "DENY")] }).orderable).toBe(true);
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, null)] }).orderable).toBe(true);
    expect(productOrderability({ status: "ACTIVE", variants: [v(0, "DENY", null)] }).orderable).toBe(true);
  });

  it("skips draft and archived products, whatever their stock", () => {
    const d = productOrderability({ status: "DRAFT", variants: [v(50, "DENY")] });
    expect(d.orderable === false && d.reason).toBe("inactive");
    expect(productOrderability({ status: "ARCHIVED", variants: [v(50, "CONTINUE")] }).orderable).toBe(false);
  });

  it("keeps an active product with stock", () => {
    expect(productOrderability({ status: "ACTIVE", variants: [v(12, "DENY")] }).orderable).toBe(true);
  });
});
