// "Split with another supplier" (#248 + #328): the Orders page's stock-edit
// recompute keeps a split exactly as /orders/calculate applied it.
import { describe, it, expect } from "vitest";
import { suggestedPacks, type SurplusLineFields } from "./order-line-surplus";

const flour: SurplusLineFields = { totalRequired: 150, surplusTarget: 150, packWeight: 15, isKanban: false };

describe("suggestedPacks with splits", () => {
  it("a stock edit keeps the packs split away off today's line", () => {
    expect(suggestedPacks(flour, 0)).toBe(20);
    expect(suggestedPacks({ ...flour, splitAwayPacks: 10 }, 0)).toBe(10);
    expect(suggestedPacks({ ...flour, splitAwayPacks: 30 }, 0)).toBe(0); // never below 0
  });
  it("a split-in line stays its fixed amount whatever the stock", () => {
    const splitIn: SurplusLineFields = { totalRequired: 0, surplusTarget: 0, packWeight: 15, isKanban: false, splitInPacks: 10 };
    expect(suggestedPacks(splitIn, 0)).toBe(10);
    expect(suggestedPacks(splitIn, 300)).toBe(10);
  });
});
