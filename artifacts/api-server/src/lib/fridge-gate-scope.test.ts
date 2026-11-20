import { describe, it, expect } from "vitest";
import { fridgeGateChecks } from "./fridge-gate-scope";

const calzone = { category: "Calzones", shopifyPushOnWrap: false };

describe("fridgeGateChecks", () => {
  it("checks core-menu calzones against the fridge", () => {
    expect(fridgeGateChecks({ ...calzone, isCoreMenu: true, isFridgeProduct: true }, true)).toBe(true);
  });

  it("REGRESSION #139897: leaves a non-core freezer calzone to Shopify while core-menu-only is on", () => {
    // Open Fire BBQ Chicken: fridge product, not core menu, stock in the
    // freezer; despatch never takes it off the fridge, so the fridge's 0
    // held an order Shopify had already stock-checked.
    expect(fridgeGateChecks({ ...calzone, isCoreMenu: false, isFridgeProduct: true }, true)).toBe(false);
  });

  it("checks non-core fridge products when despatch does count them", () => {
    expect(fridgeGateChecks({ ...calzone, isCoreMenu: false, isFridgeProduct: true }, false)).toBe(true);
  });

  it("never checks products that aren't fridge products, or whose stock Shopify holds", () => {
    expect(fridgeGateChecks({ ...calzone, isCoreMenu: false, isFridgeProduct: false }, false)).toBe(false);
    expect(fridgeGateChecks({ category: "Fried Chicken", shopifyPushOnWrap: false, isCoreMenu: true, isFridgeProduct: true }, true)).toBe(false);
  });
});
