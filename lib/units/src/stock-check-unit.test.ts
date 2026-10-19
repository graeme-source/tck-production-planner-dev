import { describe, expect, it } from "vitest";
import {
  defaultStockCheckUnit,
  describeStockCount,
  nativeToStockCount,
  resolveStockCheckUnit,
  stockCheckUnitName,
  stockCheckUnitOptions,
  stockCountToNative,
} from "./stock-check-unit";

// Real rows from tck_live (19 Oct 2026).
const basil = { unit: "g", packWeight: 100, stockInPacks: false };            // Fresh Basil
const chicken = { unit: "kg", packWeight: "2.5000", stockInPacks: false };    // RT Diced Chicken Breast
const milk = { unit: "l", packWeight: 2, stockInPacks: true };
const oil = { unit: "l", packWeight: 5, stockInPacks: false };
const bags = { unit: "each", packWeight: 1, stockInPacks: false };
const gloves = { unit: "box", packWeight: 10, stockInPacks: false };

describe("which unit an item is stock-checked in — the default rule", () => {
  it("diced chicken (kept in kg) is counted in kilograms", () => {
    expect(defaultStockCheckUnit(chicken)).toBe("kg");
    expect(stockCheckUnitName("kg", chicken)).toBe("kilograms");
  });
  it("fresh basil (kept in g, sold in 100 g packs) is counted in grams, not packs", () => {
    expect(defaultStockCheckUnit(basil)).toBe("g");
    expect(stockCheckUnitName("g", basil)).toBe("grams");
  });
  it("litres are weighed in kilograms — the prep room never uses litres", () => {
    expect(defaultStockCheckUnit(oil)).toBe("kg");
    expect(defaultStockCheckUnit({ unit: "ml", packWeight: 500 })).toBe("g");
  });
  it("an item set to stock in whole packs is counted in packs/bottles", () => {
    expect(defaultStockCheckUnit(milk)).toBe("packs");
    expect(stockCheckUnitName("packs", milk)).toBe("bottles");
    // …but not without a pack size.
    expect(defaultStockCheckUnit({ unit: "kg", packWeight: 0, stockInPacks: true })).toBe("kg");
  });
  it("count items are counted in their own unit", () => {
    expect(defaultStockCheckUnit(bags)).toBe("native");
    expect(stockCheckUnitName("native", bags)).toBe("each");
    expect(stockCheckUnitName("native", gloves)).toBe("boxes");
  });
  it("a manager's choice wins when it fits the item, else the default", () => {
    expect(resolveStockCheckUnit({ ...chicken, stockCheckUnit: "g" })).toBe("g");
    expect(resolveStockCheckUnit({ ...chicken, stockCheckUnit: "packs" })).toBe("packs");
    expect(resolveStockCheckUnit({ ...bags, stockCheckUnit: "kg" })).toBe("native");
    expect(resolveStockCheckUnit({ unit: "kg", packWeight: 0, stockCheckUnit: "packs" })).toBe("kg");
    expect(resolveStockCheckUnit({ ...basil, stockCheckUnit: "nonsense" })).toBe("g");
    expect(resolveStockCheckUnit({ ...basil, stockCheckUnit: null })).toBe("g");
  });
  it("offers the default first, and no packs for a pack of one 'each'", () => {
    expect(stockCheckUnitOptions(basil)).toEqual(["g", "kg", "packs"]);
    expect(stockCheckUnitOptions(chicken)).toEqual(["kg", "g", "packs"]);
    expect(stockCheckUnitOptions(bags)).toEqual(["native"]);
    expect(stockCheckUnitOptions(gloves)).toEqual(["native", "packs"]);
  });
});

describe("the typed count → what's stored (the ingredient's own unit)", () => {
  it("basil 550 g is stored as 550 g = 5.5 packs", () => {
    expect(stockCountToNative(550, "g", basil)).toBe(550);
    const d = describeStockCount(550, "g", basil)!;
    expect(d.entered).toBe("550 g");
    expect(d.extras).toEqual(["5.5 packs of 100g"]);
    expect(d.native).toBe(550);
  });
  it("chicken 12.4 kg is stored as 12.4 kg", () => {
    expect(stockCountToNative(12.4, "kg", chicken)).toBe(12.4);
    expect(describeStockCount(12.4, "kg", chicken)!.extras).toEqual(["4.96 packs of 2.5 kg"]);
  });
  it("converts a change of scale and says what's saved", () => {
    expect(stockCountToNative(550, "g", chicken)).toBeCloseTo(0.55, 10);
    expect(describeStockCount(550, "g", chicken)!.extras[0]).toBe("0.55 kg saved");
    expect(stockCountToNative(5.5, "kg", basil)).toBe(5500);
  });
  it("packs multiply by the pack size", () => {
    expect(stockCountToNative(3, "packs", milk)).toBe(6);
    expect(describeStockCount(3, "packs", milk)!.extras).toEqual(["6 kg"]);
    expect(stockCountToNative(2.5, "packs", gloves)).toBe(25);
    expect(stockCountToNative(3, "packs", { unit: "kg", packWeight: 0 })).toBeNull();
  });
  it("litres counted in kilograms are the same number (1 g/ml)", () => {
    expect(stockCountToNative(12.4, "kg", oil)).toBe(12.4);
    expect(describeStockCount(12.4, "kg", oil)!.extras).toEqual(["2.48 bottles of 5 L"]);
  });
  it("zero is a real count; negatives and nonsense are not", () => {
    expect(stockCountToNative(0, "g", basil)).toBe(0);
    expect(describeStockCount(0, "g", basil)!.extras).toEqual([]);
    expect(stockCountToNative(-1, "g", basil)).toBeNull();
    expect(stockCountToNative(Number.NaN, "kg", chicken)).toBeNull();
    expect(stockCountToNative(5, "g", bags)).toBeNull();
  });
  it("reads a stored amount back in the check unit", () => {
    expect(nativeToStockCount(0.55, "g", chicken)).toBeCloseTo(550, 6);
    expect(nativeToStockCount(6, "packs", milk)).toBe(3);
    expect(nativeToStockCount(24, "native", bags)).toBe(24);
  });
});
