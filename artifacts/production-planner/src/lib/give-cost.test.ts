import { describe, it, expect } from "vitest";
import { canGiveCost, formatUnitCost, matchesSearch, perItemFromPack, positiveNumber } from "./give-cost";

describe("canGiveCost — which items get the 'give it a cost' options", () => {
  it("an uncosted item with a Shopify variant", () => {
    expect(canGiveCost({ costed: false, variantId: "44912345678901" })).toBe(true);
  });
  it("not one that's costed (recipe, supply, app or Shopify cost, or digital)", () => {
    expect(canGiveCost({ costed: true, variantId: "44912345678901" })).toBe(false);
  });
  it("not a custom line with no Shopify variant — nothing to link", () => {
    expect(canGiveCost({ costed: false, variantId: null })).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("every word, any order, any case", () => {
    expect(matchesSearch("Garlic Cheese Calzone", "cheese gar")).toBe(true);
    expect(matchesSearch("Garlic Cheese Calzone", "pepperoni")).toBe(false);
    expect(matchesSearch("Anything", "  ")).toBe(true);
  });
});

describe("perItemFromPack", () => {
  it("the order insert: £160.05 for 10,000", () => {
    expect(perItemFromPack(160.05, 10000)).toBeCloseTo(0.016, 4);
  });
  it("null until both are real", () => {
    expect(perItemFromPack(null, 12)).toBeNull();
    expect(perItemFromPack(10, 0)).toBeNull();
  });
});

describe("positiveNumber", () => {
  it("reads pounds, with or without £", () => {
    expect(positiveNumber("1.20")).toBe(1.2);
    expect(positiveNumber("£0.35")).toBe(0.35);
  });
  it("blank, zero, negative or nonsense → null", () => {
    expect(positiveNumber("")).toBeNull();
    expect(positiveNumber("0")).toBeNull();
    expect(positiveNumber("-1")).toBeNull();
    expect(positiveNumber("abc")).toBeNull();
  });
});

describe("formatUnitCost", () => {
  it("pence when small, pounds otherwise", () => {
    expect(formatUnitCost(0.016)).toBe("1.6p");
    expect(formatUnitCost(0.004)).toBe("0.40p");
    expect(formatUnitCost(1.2)).toBe("£1.20");
  });
});
