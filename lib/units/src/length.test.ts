import { describe, it, expect } from "vitest";
import { dotsToMm, mmToDots, mmToPt, ptToDots, ptToMm } from "./length";

describe("print lengths", () => {
  it("203 dpi lays down 8 dots per millimetre (to 0.1%)", () => {
    expect(mmToDots(1, 203)).toBeCloseTo(7.992, 3);
    expect(dotsToMm(203, 203)).toBeCloseTo(25.4, 6);
  });
  it("72 points to the inch", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 9);
    expect(ptToMm(72)).toBeCloseTo(25.4, 9);
    expect(ptToDots(72, 300)).toBeCloseTo(300, 9);
  });
});
