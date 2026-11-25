import { describe, it, expect } from "vitest";
import { shopifyCostString, shopifyCostTickDefault, supplyLinkCost, VARIANT_ID_RE, wonkyTarget, type MainMappingRow } from "./variant-cost-rules";

describe("shopifyCostTickDefault", () => {
  it("ticked when Shopify has no cost", () => {
    expect(shopifyCostTickDefault(null)).toBe(true);
    expect(shopifyCostTickDefault(undefined)).toBe(true);
    expect(shopifyCostTickDefault(0)).toBe(true);
  });
  it("not ticked when Shopify already has one", () => {
    expect(shopifyCostTickDefault(1.25)).toBe(false);
  });
});

describe("shopifyCostString", () => {
  it("pounds to the penny", () => {
    expect(shopifyCostString(1.2)).toBe("1.20");
    expect(shopifyCostString(0.016)).toBe("0.02");
    expect(shopifyCostString(2.345)).toBe("2.35");
  });
  it("under half a penny, or nonsense, isn't sent", () => {
    expect(shopifyCostString(0.004)).toBeNull();
    expect(shopifyCostString(0)).toBeNull();
    expect(shopifyCostString(Number.NaN)).toBeNull();
  });
});

describe("wonkyTarget", () => {
  const one: MainMappingRow[] = [{ id: 7, variantId: "111111", title: "Pepperoni", wonkyVariantId: null }];
  const two: MainMappingRow[] = [...one, { id: 8, variantId: "222222", title: "Pepperoni 8-pack", wonkyVariantId: null }];
  it("the recipe's only main product", () => {
    expect(wonkyTarget(one, "999999")).toEqual({ ok: true, mappingId: 7 });
  });
  it("several → ask which, then use the one chosen", () => {
    expect(wonkyTarget(two, "999999")).toMatchObject({ ok: false, reason: "choose" });
    expect(wonkyTarget(two, "999999", 8)).toEqual({ ok: true, mappingId: 8 });
  });
  it("none → link the main product first", () => {
    expect(wonkyTarget([], "999999")).toMatchObject({ ok: false, reason: "no-main" });
  });
  it("a choice that isn't this recipe's is refused", () => {
    expect(wonkyTarget(one, "999999", 99)).toMatchObject({ ok: false, reason: "not-this-recipe" });
  });
  it("never replaces a different wonky product; the same one again is fine", () => {
    const has: MainMappingRow[] = [{ ...one[0]!, wonkyVariantId: "555555" }];
    expect(wonkyTarget(has, "999999")).toMatchObject({ ok: false, reason: "has-wonky" });
    expect(wonkyTarget(has, "555555")).toEqual({ ok: true, mappingId: 7 });
  });
});

describe("supplyLinkCost", () => {
  it("uses the supply's own cost, ignoring a typed one", () => {
    expect(supplyLinkCost(160.05, 10)).toEqual({ ok: true, costPerPack: 160.05, setsCost: false });
  });
  it("a supply with no cost takes the typed one", () => {
    expect(supplyLinkCost(0, 12.5)).toEqual({ ok: true, costPerPack: 12.5, setsCost: true });
    expect(supplyLinkCost(null, 12.5)).toEqual({ ok: true, costPerPack: 12.5, setsCost: true });
  });
  it("no cost anywhere → say so", () => {
    expect(supplyLinkCost(0, null)).toMatchObject({ ok: false });
  });
});

describe("VARIANT_ID_RE", () => {
  it("numeric Shopify variant ids only", () => {
    expect(VARIANT_ID_RE.test("44912345678901")).toBe(true);
    expect(VARIANT_ID_RE.test("gid://shopify/ProductVariant/1")).toBe(false);
    expect(VARIANT_ID_RE.test("12")).toBe(false);
  });
});
