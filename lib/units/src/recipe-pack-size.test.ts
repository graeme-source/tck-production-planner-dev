import { describe, it, expect } from "vitest";
import { effectivePackSize, hasPackSize, packSizeToStore } from "./recipe-pack-size";

describe("recipe pack size", () => {
  it("a blank pack size counts as 1 for the kitchen maths", () => {
    expect(effectivePackSize(null)).toBe(1);
    expect(effectivePackSize(undefined)).toBe(1);
    expect(effectivePackSize("")).toBe(1);
  });

  it("a set pack size is used as it is", () => {
    expect(effectivePackSize("2.0000")).toBe(2);
    expect(effectivePackSize(6)).toBe(6);
    expect(effectivePackSize("1.0000")).toBe(1);
  });

  it("knows blank from set", () => {
    expect(hasPackSize(null)).toBe(false);
    expect(hasPackSize(" ")).toBe(false);
    expect(hasPackSize("1.0000")).toBe(true);
    expect(hasPackSize(2)).toBe(true);
  });

  it("a save keeps blank blank and defaults a missing value to 1", () => {
    expect(packSizeToStore(null)).toBeNull();
    expect(packSizeToStore(undefined)).toBe("1");
    expect(packSizeToStore(2)).toBe("2");
  });
});
