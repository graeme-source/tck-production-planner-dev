import { describe, expect, it } from "vitest";
import { labelsLeft, labelCountToPrint, fivePackLabelCopies, fivePackLineKey, MAX_AD_HOC_LABELS } from "./dessert-label-counts";

// Regression (Graeme, 13 Nov 2026): the report still said "Print 3 labels"
// after they'd been printed, and a later despatch had no labels for orders
// placed since. The default is now what's still needed.
describe("labels still needed", () => {
  it("the morning print covers the orders so far; later orders need just the new ones", () => {
    expect(labelsLeft(3, 0)).toBe(3);
    expect(labelsLeft(3, 3)).toBe(0);
    expect(labelsLeft(5, 3)).toBe(2);
  });
  it("never below zero (extra printed by hand)", () => {
    expect(labelsLeft(3, 5)).toBe(0);
  });
  it("no choice prints what's still needed", () => {
    expect(labelCountToPrint(5, 3)).toBe(2);
    expect(labelCountToPrint(5, 3, null)).toBe(2);
  });
  it("an ad-hoc count prints that many, even above the orders (calculation wrong)", () => {
    expect(labelCountToPrint(3, 3, 4)).toBe(4);
    expect(labelCountToPrint(0, 0, 2)).toBe(2);
  });
  it("ad-hoc counts are whole, 0 to the limit; nonsense prints nothing", () => {
    expect(labelCountToPrint(3, 0, 3.7)).toBe(3);
    expect(labelCountToPrint(3, 0, -2)).toBe(0);
    expect(labelCountToPrint(3, 0, Number.NaN)).toBe(0);
    expect(labelCountToPrint(3, 0, 10_000)).toBe(MAX_AD_HOC_LABELS);
  });
});

describe("fivePackLabelCopies", () => {
  const lines = [
    { variantId: "111", productTitle: "Flavour A", quantity: 6 },
    { variantId: "222", productTitle: "Flavour B", quantity: 2 },
    { variantId: null, productTitle: "Flavour C", quantity: 3 },
  ];

  it("no choice, nothing printed = every flavour × its day's quantity", () => {
    expect(fivePackLabelCopies(lines).map(l => l.copies)).toEqual([6, 2, 3]);
  });

  it("no choice after a print = only each flavour's labels still needed", () => {
    const out = fivePackLabelCopies(lines, null, { "111": 4, "222": 2, "Flavour C": 0 });
    expect(out.map(l => [fivePackLineKey(l), l.copies])).toEqual([["111", 2], ["Flavour C", 3]]);
  });

  it("a choice prints exactly what's chosen, above the orders too", () => {
    const out = fivePackLabelCopies(lines, { "111": 2, "222": 9, "Flavour C": 1 }, { "222": 2 });
    expect(out.map(l => [fivePackLineKey(l), l.copies])).toEqual([["111", 2], ["222", 9], ["Flavour C", 1]]);
  });

  it("flavours not chosen, or set to zero/negative, print none", () => {
    expect(fivePackLabelCopies(lines, { "111": 0, "222": -1 })).toEqual([]);
    expect(fivePackLabelCopies(lines, { "222": 1 }).map(fivePackLineKey)).toEqual(["222"]);
  });
});
