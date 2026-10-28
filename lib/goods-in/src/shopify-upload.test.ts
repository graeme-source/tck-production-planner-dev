import { describe, expect, it } from "vitest";
import { shopifyQuantityConfirmed, shopifyUnitsFor, shopifyUploadsOf, type ShopifyUploadLine } from "./shopify-upload";

const line = (over: Partial<ShopifyUploadLine> = {}): ShopifyUploadLine => ({
  lineId: 1, name: "Brownie (Rolo)", variantId: "56599907565942", productTitle: "Rolo Chocolate Brownie",
  variantTitle: "5 Pack", unitsPerPack: null, previousReceived: 0, newReceived: 12, ...over,
});

describe("goods-in uploads to Shopify", () => {
  it("a linked line received for the first time adds its quantity × units per pack", () => {
    expect(shopifyUploadsOf([line()])).toEqual([{ lineId: 1, name: "Brownie (Rolo)", product: "Rolo Chocolate Brownie — 5 Pack", units: 12 }]);
    expect(shopifyUploadsOf([line({ unitsPerPack: "4", newReceived: 3 })])[0].units).toBe(12);
  });

  it("unlinked lines and unchanged quantities need no confirmation", () => {
    expect(shopifyUploadsOf([line({ variantId: null }), line({ lineId: 2, previousReceived: 12, newReceived: 12 })])).toEqual([]);
  });

  it("an edit uploads only the difference, and a lower count takes stock off", () => {
    expect(shopifyUploadsOf([line({ previousReceived: 10, newReceived: 12 })])[0].units).toBe(2);
    expect(shopifyUploadsOf([line({ previousReceived: 12, newReceived: 9 })])[0].units).toBe(-3);
  });

  it("Shopify's 'Default Title' variant isn't shown", () => {
    expect(shopifyUploadsOf([line({ variantTitle: "Default Title" })])[0].product).toBe("Rolo Chocolate Brownie");
  });

  it("matches the server's rounding", () => {
    expect(shopifyUnitsFor(2.5, "3")).toBe(8);
    expect(shopifyUnitsFor(5, "")).toBe(5);
  });

  it("the typed-again number must match exactly", () => {
    expect(shopifyQuantityConfirmed(" 12 ", 12)).toBe(true);
    expect(shopifyQuantityConfirmed("3", -3)).toBe(true);
    expect(shopifyQuantityConfirmed("11", 12)).toBe(false);
    expect(shopifyQuantityConfirmed("12.0", 12)).toBe(false);
    expect(shopifyQuantityConfirmed("", 12)).toBe(false);
  });
});
