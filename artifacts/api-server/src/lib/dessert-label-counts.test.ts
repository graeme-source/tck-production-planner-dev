import { describe, expect, it } from "vitest";
import { cappedLabelCount, fivePackLabelCopies, fivePackLineKey } from "./dessert-label-counts";

// Regression for fix-queue #374: the dessert label buttons could only print
// the whole day; "Print some" may choose fewer, never more than the orders.
describe("cappedLabelCount", () => {
  it("no count = the day's full total (the one-tap default)", () => {
    expect(cappedLabelCount(12)).toBe(12);
    expect(cappedLabelCount(12, null)).toBe(12);
  });

  it("a smaller count prints just that many", () => {
    expect(cappedLabelCount(12, 4)).toBe(4);
  });

  it("a count above the day's total is capped at the total", () => {
    expect(cappedLabelCount(12, 50)).toBe(12);
  });

  it("zero, negative or nonsense counts print nothing", () => {
    expect(cappedLabelCount(12, 0)).toBe(0);
    expect(cappedLabelCount(12, -3)).toBe(0);
    expect(cappedLabelCount(12, Number.NaN)).toBe(0);
  });

  it("whole labels only", () => {
    expect(cappedLabelCount(12, 3.7)).toBe(3);
  });
});

describe("fivePackLabelCopies", () => {
  const lines = [
    { variantId: "111", productTitle: "Flavour A", quantity: 6 },
    { variantId: "222", productTitle: "Flavour B", quantity: 2 },
    { variantId: null, productTitle: "Flavour C", quantity: 3 },
  ];

  it("no choice = every flavour × its day's quantity", () => {
    expect(fivePackLabelCopies(lines).map(l => l.copies)).toEqual([6, 2, 3]);
  });

  it("caps each flavour at its own day's quantity", () => {
    const out = fivePackLabelCopies(lines, { "111": 2, "222": 9, "Flavour C": 1 });
    expect(out.map(l => [fivePackLineKey(l), l.copies])).toEqual([["111", 2], ["222", 2], ["Flavour C", 1]]);
  });

  it("flavours not chosen, or set to zero/negative, print none", () => {
    const out = fivePackLabelCopies(lines, { "111": 0, "222": -1 });
    expect(out).toEqual([]);
    expect(fivePackLabelCopies(lines, { "222": 1 }).map(fivePackLineKey)).toEqual(["222"]);
  });

  it("ignores flavours that aren't on the day's orders", () => {
    expect(fivePackLabelCopies(lines, { "999": 5 })).toEqual([]);
  });
});
