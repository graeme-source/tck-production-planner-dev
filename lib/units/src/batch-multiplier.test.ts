import { describe, it, expect } from "vitest";
import { exactBatchMultiplier, formatBatchMultiplier } from "./batch-multiplier";

describe("exactBatchMultiplier", () => {
  it("scales a mix to exactly today's need, across units", () => {
    // 8.32 kg needed from a 6.2 kg mix
    const m = exactBatchMultiplier(8.32, "kg", 6.2, "kg")!;
    expect(m * 6.2).toBeCloseTo(8.32, 10);
    expect(formatBatchMultiplier(m)).toBe("1.34×");
    // the prep screen says grams, the recipe yields kg
    expect(exactBatchMultiplier(8320, "g", 6.2, "kg")).toBeCloseTo(8.32 / 6.2, 10);
    expect(exactBatchMultiplier(450, "g", 1.5, "kg")).toBeCloseTo(0.3, 10);
  });
  it("won't guess", () => {
    expect(exactBatchMultiplier(0, "kg", 6, "kg")).toBeNull();
    expect(exactBatchMultiplier(null, "kg", 6, "kg")).toBeNull();
    expect(exactBatchMultiplier(5, "kg", 0, "kg")).toBeNull();
    expect(exactBatchMultiplier(3, "each", 2, "kg")).toBeNull();
  });
  it("formats tidily", () => {
    expect(formatBatchMultiplier(2)).toBe("2×");
    expect(formatBatchMultiplier(1.5)).toBe("1.5×");
    expect(formatBatchMultiplier(1.3419)).toBe("1.34×");
  });
});
