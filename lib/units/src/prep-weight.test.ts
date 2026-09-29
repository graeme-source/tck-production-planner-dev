import { describe, expect, it } from "vitest";
import { formatPrepWeight, packsToOpen } from "./prep-weight";

describe("formatPrepWeight — the prep room reads weights, never litres", () => {
  it("turns litres into grams (American Mustard 0.0667 l)", () => {
    expect(formatPrepWeight(0.0667, "l")).toBe("67 g");
    expect(formatPrepWeight(250, "ml")).toBe("250 g");
    expect(formatPrepWeight(1.75, "l")).toBe("1.750 kg");
  });
  it("shows grams under a kilo and kilograms from one kilo", () => {
    expect(formatPrepWeight(0.7427, "kg")).toBe("743 g");
    expect(formatPrepWeight(10.65, "kg")).toBe("10.650 kg");
    expect(formatPrepWeight(1000, "g")).toBe("1.000 kg");
  });
  it("rounds to the whole gram — 83.350 g reads 83 g (Graeme's photo, 2026-09-29)", () => {
    expect(formatPrepWeight(83.35, "g")).toBe("83 g");
    expect(formatPrepWeight(33.35, "g")).toBe("33 g");
    expect(formatPrepWeight(3.7135, "kg")).toBe("3.714 kg");
  });
  it("keeps one decimal under 10 g", () => {
    expect(formatPrepWeight(0.67, "g")).toBe("0.7 g");
    expect(formatPrepWeight(0.006667, "kg")).toBe("6.7 g");
  });
  it("never shows a litre", () => {
    for (const [q, u] of [[0.02, "l"], [3, "L"], [500, "ml"], [0.5, "litres"]] as const) {
      expect(formatPrepWeight(q, u)).not.toMatch(/\bl\b|litre|ml/i);
    }
  });
  it("leaves counts as counts, and copes with strings from the API", () => {
    expect(formatPrepWeight(3, "each")).toBe("3 pieces");
    expect(formatPrepWeight("2.2700", "kg")).toBe("2.270 kg");
  });
});

describe("packsToOpen (regression: 3.714 kg of mayo from a 10 kg tub read '372 packs')", () => {
  it("compares the amount and the pack size in the same unit", () => {
    expect(packsToOpen(3.714, 10)).toBe(1);      // mayonnaise, kg
    expect(packsToOpen(0.3335, 3)).toBe(1);      // American mustard, litres
    expect(packsToOpen(83.35, 550)).toBe(1);     // paprika, grams
    expect(packsToOpen(25, 10)).toBe(3);
  });
  it("doesn't round float noise up a pack, and ignores missing sizes", () => {
    expect(packsToOpen(20.0000001, 10)).toBe(2);
    expect(packsToOpen(5, 0)).toBeNull();
    expect(packsToOpen(0, 10)).toBeNull();
  });
});
