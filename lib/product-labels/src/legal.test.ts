import { describe, it, expect } from "vitest";
import { legalMinPt, xHeightMmAt } from "./legal";

describe("x-height → minimum point size", () => {
  it("Barlow (x-height 0.506 em) needs 6.75 pt for 1.2 mm", () => {
    expect(legalMinPt(0.506, false)).toBe(6.75);
    expect(xHeightMmAt(6.75, 0.506)).toBeGreaterThanOrEqual(1.2);
    // one step smaller would be under the line
    expect(xHeightMmAt(6.5, 0.506)).toBeLessThan(1.2);
  });
  it("small packs (largest surface under 80 cm²) need 0.9 mm", () => {
    expect(legalMinPt(0.506, true)).toBe(5.25);
    expect(xHeightMmAt(5.25, 0.506)).toBeGreaterThanOrEqual(0.9);
  });
  it("a font with a smaller x-height needs a bigger size", () => {
    // Times-like x-height ~0.448
    expect(legalMinPt(0.448, false)).toBe(7.75);
  });
  it("rounds up, never down", () => {
    // exact answer 6.8031… pt → 7
    expect(legalMinPt(0.5, false)).toBe(7);
  });
});
