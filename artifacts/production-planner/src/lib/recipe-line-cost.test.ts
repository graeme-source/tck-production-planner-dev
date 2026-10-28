import { describe, expect, it } from "vitest";
import { livePackMargin, marginTone, rrpForMargin } from "./recipe-line-cost";

describe("livePackMargin", () => {
  it("matches the server: portion cost × pack size + packaging + labour, margin on RRP", () => {
    const { packCost, margin } = livePackMargin({ costPerPortion: 2.27, packSize: 2, packagingCost: 0.4, labourCost: 0.6, rrp: 14.95 });
    expect(packCost).toBeCloseTo(5.54, 6);
    expect(margin).toBeCloseTo(((14.95 - 5.54) / 14.95) * 100, 6);
  });

  it("has no margin without an RRP, and reads form strings", () => {
    expect(livePackMargin({ costPerPortion: 1, packSize: "2", packagingCost: "", labourCost: undefined, rrp: "" }))
      .toEqual({ packCost: 2, margin: null });
  });
});

describe("rrpForMargin", () => {
  it("is the price for the margin, rounded up so it never falls short", () => {
    const rrp = rrpForMargin(5.54, 80);
    expect(rrp).toBe(27.7);
    expect(livePackMargin({ costPerPortion: 5.54, packSize: 1, packagingCost: 0, labourCost: 0, rrp }).margin!).toBeGreaterThanOrEqual(80);
    expect(rrpForMargin(3.01, 75)).toBe(12.04);
  });
});

describe("marginTone", () => {
  it("uses the Recipes table bands", () => {
    expect(marginTone(null)).toBeNull();
    expect(marginTone(80)).toBe("good");
    expect(marginTone(79.9)).toBe("ok");
    expect(marginTone(75)).toBe("ok");
    expect(marginTone(74.9)).toBe("bad");
  });
});
