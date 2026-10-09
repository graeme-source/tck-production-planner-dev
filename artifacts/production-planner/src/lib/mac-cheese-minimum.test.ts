import { describe, it, expect } from "vitest";
import { applyMacCheeseMinimum, MAC_CHEESE_MIN_PACKS } from "./mac-cheese-minimum";

describe("mac cheese minimum run", () => {
  it("rounds a small run up to 15 packs", () => {
    expect(MAC_CHEESE_MIN_PACKS).toBe(15);
    expect(applyMacCheeseMinimum(8)).toBe(15);
    expect(applyMacCheeseMinimum(1)).toBe(15);
    expect(applyMacCheeseMinimum(14)).toBe(15);
  });
  it("leaves 15 or more alone", () => {
    expect(applyMacCheeseMinimum(15)).toBe(15);
    expect(applyMacCheeseMinimum(23)).toBe(23);
  });
  it("keeps zero at zero — nothing needed, nothing made", () => {
    expect(applyMacCheeseMinimum(0)).toBe(0);
    expect(applyMacCheeseMinimum(-3)).toBe(0);
    expect(applyMacCheeseMinimum(Number.NaN)).toBe(0);
  });
});
