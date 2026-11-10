import { describe, it, expect } from "vitest";
import { cardIsOrdering, connectedTopUpPacks, inboundPacks } from "./connected-inventory-rules";

describe("connectedTopUpPacks", () => {
  it("tops up to the maximum in whole cases, never over", () => {
    // 14 bottles on the shelf, room for 48, cases of 6: 34 short → 5 cases (30).
    expect(connectedTopUpPacks({ onHandUnits: 14, inboundUnits: 0, maxUnits: 48, unitsPerPack: 6 })).toBe(5);
    // Exactly a case short.
    expect(connectedTopUpPacks({ onHandUnits: 42, inboundUnits: 0, maxUnits: 48, unitsPerPack: 6 })).toBe(1);
  });

  it("orders nothing when less than a case would fit, or it's full", () => {
    expect(connectedTopUpPacks({ onHandUnits: 44, inboundUnits: 0, maxUnits: 48, unitsPerPack: 6 })).toBe(0);
    expect(connectedTopUpPacks({ onHandUnits: 60, inboundUnits: 0, maxUnits: 48, unitsPerPack: 6 })).toBe(0);
  });

  it("counts stock already on its way", () => {
    expect(connectedTopUpPacks({ onHandUnits: 14, inboundUnits: 24, maxUnits: 48, unitsPerPack: 6 })).toBe(1);
  });

  it("reads oversold (negative) Shopify stock as an empty shelf", () => {
    expect(connectedTopUpPacks({ onHandUnits: -3, inboundUnits: 0, maxUnits: 24, unitsPerPack: 12 })).toBe(2);
  });

  it("treats a missing pack size as single units", () => {
    expect(connectedTopUpPacks({ onHandUnits: 5, inboundUnits: 0, maxUnits: 12, unitsPerPack: 0 })).toBe(7);
  });
});

describe("inboundPacks", () => {
  it("keeps pack-counted lines and converts the rest", () => {
    expect(inboundPacks(3, "packs", 6)).toBe(3);
    expect(inboundPacks(3, "bottles", 6)).toBe(3);
    expect(inboundPacks(18, "pieces", 6)).toBe(3);
    expect(inboundPacks(0, "packs", 6)).toBe(0);
  });
});

describe("cardIsOrdering", () => {
  it("needs a line that's actually being ordered", () => {
    expect(cardIsOrdering([{ packsToOrder: 2, belowRequirement: false }])).toBe(true);
    expect(cardIsOrdering([{ packsToOrder: 0, belowRequirement: true }])).toBe(false);
    expect(cardIsOrdering([])).toBe(false);
  });
});
