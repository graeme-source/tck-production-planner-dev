import { describe, expect, it } from "vitest";
import { shopifyUnitsFor, shopifyUploadsOf, unitsPerPackMismatch, type ShopifyUploadLine } from "./shopify-upload";

const line = (over: Partial<ShopifyUploadLine> = {}): ShopifyUploadLine => ({
  lineId: 1, name: "Brownie (Rolo)", variantId: "56599907565942", productTitle: "Rolo Chocolate Brownie",
  variantTitle: "5 Pack", unitsPerPack: null, previousReceived: 0, newReceived: 12, ...over,
});

describe("goods-in uploads to Shopify", () => {
  it("a linked line received for the first time adds its quantity × units per pack", () => {
    expect(shopifyUploadsOf([line()])).toEqual([{ lineId: 1, name: "Brownie (Rolo)", product: "Rolo Chocolate Brownie — 5 Pack", units: 12, packs: 12, perPack: 1 }]);
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

  // Regression, Graeme 12 Nov 2026 (PO #786): 2 packs of 12 caramel
  // shortbread offered "Adds 288 to Shopify". The line was ordered as 24
  // pieces and was multiplied by 12 per pack as if it were 24 packs.
  it("a line ordered in pieces is turned into packs first: 24 pieces of 12-per-pack = 24 units, not 288", () => {
    const shortbread = line({ name: "Caramel Shortbread", unitsPerPack: "12.00", unit: "pieces", packWeight: "12.0000", newReceived: 24 });
    expect(shopifyUploadsOf([shortbread])[0].units).toBe(24);
    expect(shopifyUnitsFor(24, "12", { unit: "pieces", packWeight: 12 })).toBe(24);
  });

  it("a line ordered in packs is unchanged: 4 packs of 12 brownies = 48", () => {
    const brownie = line({ unitsPerPack: "12.00", unit: "packs", packWeight: "12.0000", newReceived: 4 });
    expect(shopifyUploadsOf([brownie])[0].units).toBe(48);
  });

  it("without a pack size the quantity is taken as packs, as before", () => {
    expect(shopifyUnitsFor(3, "4", { unit: "pieces", packWeight: null })).toBe(12);
  });

  it("matches the server's rounding", () => {
    expect(shopifyUnitsFor(2.5, "3")).toBe(8);
    expect(shopifyUnitsFor(5, "")).toBe(5);
  });

  it("shows its working: packs × units per pack", () => {
    const sauce = line({ name: "Original Hot Sauce (160ml)", unitsPerPack: "6.00", unit: "packs", packWeight: "6", newReceived: 3 });
    expect(shopifyUploadsOf([sauce])[0]).toMatchObject({ packs: 3, perPack: 6, units: 18 });
  });

  // Regression, Graeme 18 Nov 2026 (PO #785): Honey Sriracha, 6 bottles a
  // pack, had its store units per pack set to 1, so 8 packs offered "Adds 8"
  // beside Original Hot Sauce's 3 packs → 18.
  it("flags an item counted in pieces whose store units per pack isn't its pack size", () => {
    expect(unitsPerPackMismatch({ ingredientUnit: "pieces", packWeight: "6.0000", unitsPerPack: "1.00" })).toEqual({ packHolds: 6, storeGets: 1 });
    expect(unitsPerPackMismatch({ ingredientUnit: "pieces", packWeight: "6.0000", unitsPerPack: null })).toEqual({ packHolds: 6, storeGets: 1 });
    expect(unitsPerPackMismatch({ ingredientUnit: "pieces", packWeight: "6.0000", unitsPerPack: "6" })).toBeNull();
    expect(unitsPerPackMismatch({ ingredientUnit: "g", packWeight: "500", unitsPerPack: "1" })).toBeNull();
    expect(unitsPerPackMismatch({ ingredientUnit: "pieces", packWeight: "1", unitsPerPack: null })).toBeNull();
  });
});
