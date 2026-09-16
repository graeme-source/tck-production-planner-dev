import { describe, it, expect } from "vitest";
import { tinsCompleteFrom } from "./tin-math";

describe("tinsCompleteFrom", () => {
  it("counts whole tins from mixed batches", () => {
    expect(tinsCompleteFrom(0, 3, 4)).toBe(0);
    expect(tinsCompleteFrom(4, 3, 4)).toBe(1);
    expect(tinsCompleteFrom(11, 3, 4)).toBe(2);
    expect(tinsCompleteFrom(12, 3, 4)).toBe(3);
  });

  it("caps at the tin target even when over-mixed", () => {
    expect(tinsCompleteFrom(99, 3, 4)).toBe(3);
  });

  // Regression (live, 2026-09-16): a 0-batch item gives batchesPerTinEven 0;
  // floor(0/0) = NaN used to leak into the day totals as "NaN/36 tins".
  it("returns 0, never NaN, for zero-batch items", () => {
    expect(tinsCompleteFrom(0, 1, 0)).toBe(0);
    expect(tinsCompleteFrom(5, 0, 0)).toBe(0);
    expect(Number.isNaN(tinsCompleteFrom(0, 1, 0))).toBe(false);
  });
});
