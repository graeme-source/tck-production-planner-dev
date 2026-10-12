import { describe, it, expect, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {} }));
import { isCurrent } from "./barcode-store";

// Regression (12 Oct 2026): the first-order Order Insert is a DRAFT Shopify
// product linked to no recipe. It was judged retired, lost its barcode, and
// packing couldn't scan it. A barcode set on purpose by a person always counts.
describe("which variants keep their barcode", () => {
  const active = new Map<number, boolean>([[1, true], [2, false]]);
  it("a draft, unlinked product keeps a barcode a person set", () => {
    expect(isCurrent(undefined, active, "draft", true)).toBe(true);
  });
  it("a draft, unlinked product with only Shopify's barcode is retired", () => {
    expect(isCurrent(undefined, active, "draft", false)).toBe(false);
  });
  it("linked to an active recipe, or an active Shopify product, is current", () => {
    expect(isCurrent({ variantId: "1", recipeId: 1, kind: "pack" } as never, active, "draft")).toBe(true);
    expect(isCurrent(undefined, active, "active")).toBe(true);
  });
});
