import { describe, it, expect } from "vitest";
import { orderTotalSummary } from "./order-total-summary";

describe("orderTotalSummary (Graeme, 20 Nov 2026)", () => {
  it("adds up what's being ordered and counts the lines with no price", () => {
    expect(orderTotalSummary([
      { editedPacks: 2, costPerPack: 12.5 },
      { editedPacks: 20, costPerPack: 4.1 }, // the butter: 20 × £4.10 = £82
      { editedPacks: 3, costPerPack: 0 },
      { editedPacks: 0, costPerPack: 9 },   // not being ordered
    ])).toEqual({ total: 107, unpriced: 1, lines: 3 });
  });
});
