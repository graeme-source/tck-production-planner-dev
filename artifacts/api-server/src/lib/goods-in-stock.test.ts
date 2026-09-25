import { describe, it, expect } from "vitest";
import { isPackCountUnit, receiptDelta, stockQuantityForReceipt } from "./goods-in-stock";

describe("isPackCountUnit", () => {
  it("treats packs, bottles and pallets as counts", () => {
    expect(isPackCountUnit("packs")).toBe(true);
    expect(isPackCountUnit("bottles")).toBe(true);
    expect(isPackCountUnit("pallets")).toBe(true);
  });
  it("treats weights, volumes and pieces as native quantities", () => {
    for (const u of ["kg", "g", "l", "ml", "pieces", "each"]) expect(isPackCountUnit(u)).toBe(false);
    expect(isPackCountUnit(null)).toBe(false);
  });
});

describe("stockQuantityForReceipt", () => {
  it("multiplies a pack count by the pack weight, in the ingredient's unit", () => {
    expect(stockQuantityForReceipt(3, { unit: "packs", packWeight: "2.5", ingredientUnit: "kg" }))
      .toEqual({ quantity: 7.5, unit: "kg" });
  });
  it("keeps native-unit lines as they are", () => {
    expect(stockQuantityForReceipt(12, { unit: "kg", packWeight: "5", ingredientUnit: "kg" }))
      .toEqual({ quantity: 12, unit: "kg" });
  });
  it("counts a pack as 1 when the pack weight is missing (legacy behaviour)", () => {
    expect(stockQuantityForReceipt(4, { unit: "packs", packWeight: "0", ingredientUnit: "pieces" }))
      .toEqual({ quantity: 4, unit: "pieces" });
  });
  it("handles a negative delta (a receipt edited down)", () => {
    expect(stockQuantityForReceipt(-1, { unit: "packs", packWeight: 10, ingredientUnit: "kg" }))
      .toEqual({ quantity: -10, unit: "kg" });
  });
});

describe("receiptDelta — stock goes up once per delivery", () => {
  it("first receipt adds the full quantity", () => {
    expect(receiptDelta(0, 6)).toBe(6);
  });
  it("re-saving the same receipt adds nothing", () => {
    expect(receiptDelta(6, 6)).toBe(0);
  });
  it("correcting the count moves stock by the difference only", () => {
    expect(receiptDelta(6, 5)).toBe(-1);
  });
});
