import { describe, it, expect } from "vitest";
import { trackedVariantMap, bagRecipeByTitle, EIGHT_PACK_TITLE_MARKER } from "./shopify-stock-check";
import type { ShopifyProduct } from "../services/shopify";

const product = (over: Partial<ShopifyProduct>): ShopifyProduct => ({
  id: 1, title: "P", status: "active", variants: [], images: [], image: null, ...over,
});
const variant = (id: number, management: string | null, qty: number) => ({
  id, title: "", sku: "", price: "0", inventory_quantity: qty, inventory_management: management,
  barcode: null, image_id: null,
});

describe("trackedVariantMap", () => {
  it("keeps only variants Shopify is tracking", () => {
    const map = trackedVariantMap([
      product({ variants: [variant(101, "shopify", 29), variant(102, null, 973924)] }),
    ]);
    expect(map).toEqual({ "101": 29 });
  });

  it("skips archived and draft products — they can't be ordered", () => {
    const map = trackedVariantMap([
      product({ status: "archived", variants: [variant(201, "shopify", 5)] }),
      product({ status: "draft", variants: [variant(202, "shopify", 5)] }),
    ]);
    expect(map).toEqual({});
  });

  it("keeps a tracked variant even at zero or negative quantity — tracked is the signal, not the level", () => {
    const map = trackedVariantMap([product({ variants: [variant(301, "shopify", -3)] })]);
    expect(map).toEqual({ "301": -3 });
  });
});

describe("bagRecipeByTitle", () => {
  it("maps in-scope product titles to their recipe, case-insensitively", () => {
    const map = bagRecipeByTitle([
      { recipe_id: 4, shopify_product_title: "The Godfather - Cheeseburger Calzone", in_scope: true },
      { recipe_id: 7, shopify_product_title: "Chilli Con Carnage (hot)", in_scope: false },
      { recipe_id: 9, shopify_product_title: null, in_scope: true },
    ]);
    expect(map).toEqual({ "the godfather - cheeseburger calzone": 4 });
  });
});

describe("EIGHT_PACK_TITLE_MARKER", () => {
  it("matches the live variant-title convention", () => {
    expect("8 Pack Bag".toLowerCase()).toContain(EIGHT_PACK_TITLE_MARKER);
  });
});
