import { describe, expect, it } from "vitest";
import { pickShareHolder, type BarcodeHolder } from "./index";

// Regression (Graeme, 28 Oct 2026): "Buttermilk Fried Chicken 400g + rice" is
// the plain 400g pack (a Shopify flow adds the rice), but the packing bench
// refused to give it the 400g's barcode. A manager can now share it.
const chicken: BarcodeHolder = {
  variantId: "57111784882550", name: "Buttermilk Fried Chicken Strips · 400g", identityKey: "r24:pack",
  identityName: "Buttermilk Fried Chicken Strips · 400g", current: true, ours: "5065018206955", shopify: "5065018206955",
};

describe("sharing a barcode with the same pack", () => {
  it("finds the current product that holds the scanned code", () => {
    expect(pickShareHolder("5065018206955", "v57014858514806", [chicken])?.variantId).toBe("57111784882550");
  });

  it("falls back to a product that only has it in Shopify", () => {
    expect(pickShareHolder("5065018206955", "vX", [{ ...chicken, ours: null }])?.variantId).toBe("57111784882550");
  });

  it("never a retired product, a held-for-recipe code, or itself", () => {
    expect(pickShareHolder("5065018206955", "vX", [{ ...chicken, current: false }])).toBeNull();
    expect(pickShareHolder("5065018206955", "vX", [{ ...chicken, variantId: "pending:24:pack" }])).toBeNull();
    expect(pickShareHolder("5065018206955", "r24:pack", [chicken])).toBeNull();
  });

  it("nobody holds it, or it isn't a barcode → nothing to share", () => {
    expect(pickShareHolder("5065018206948", "vX", [chicken])).toBeNull();
    expect(pickShareHolder("hello", "vX", [chicken])).toBeNull();
  });
});
