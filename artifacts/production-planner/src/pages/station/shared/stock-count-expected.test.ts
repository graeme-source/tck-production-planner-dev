// #327: "Are you sure? We expected about 2 kg" — a count checked against the
// running-stock expectation (last count + deliveries − usage).
import { describe, expect, it } from "vitest";
import { expectedCountSanity, expectedSanityMessage } from "./stock-count-units";

describe("expectedCountSanity (#327)", () => {
  const base = { expectedNative: 2, lastCountNative: 5, usageTracked: true, packWeight: 0.5 };

  it("asks when a count is far off what's expected", () => {
    expect(expectedCountSanity({ ...base, nativeQty: 12 })).toEqual({ level: "warn", reason: "far-off", expectedNative: 2 });
    expect(expectedCountSanity({ ...base, nativeQty: 0.6 })).toEqual({ level: "warn", reason: "far-off", expectedNative: 2 });
  });

  it("doesn't ask when the count is near what's expected, or within one pack", () => {
    expect(expectedCountSanity({ ...base, nativeQty: 2.5 }).level).toBe("ok");
    expect(expectedCountSanity({ ...base, nativeQty: 3.9 }).level).toBe("ok");
    expect(expectedCountSanity({ ...base, expectedNative: 0.4, nativeQty: 0.9 }).level).toBe("ok"); // under a pack apart
  });

  it("asks on zero straight after a positive count", () => {
    expect(expectedCountSanity({ ...base, nativeQty: 0 })).toEqual({ level: "warn", reason: "zero-after-positive", expectedNative: 2 });
    // Usage the app can't see: say the last count instead.
    expect(expectedCountSanity({ ...base, usageTracked: false, nativeQty: 0 })).toEqual({ level: "warn", reason: "zero-after-positive", expectedNative: 5 });
  });

  it("zero is fine when the app expects it used up, or the last count was zero", () => {
    expect(expectedCountSanity({ ...base, expectedNative: 0.2, nativeQty: 0 }).level).toBe("ok");
    expect(expectedCountSanity({ ...base, lastCountNative: 0, expectedNative: 0, nativeQty: 0 }).level).toBe("ok");
    // …but a delivery since a zero count means zero now is worth a second look.
    expect(expectedCountSanity({ ...base, lastCountNative: 0, nativeQty: 0 }).level).toBe("warn");
  });

  it("no expectation, or usage the app can't see: no far-off question", () => {
    expect(expectedCountSanity({ ...base, expectedNative: null, nativeQty: 50 }).level).toBe("ok");
    expect(expectedCountSanity({ ...base, usageTracked: false, nativeQty: 50 }).level).toBe("ok");
  });

  it("says it in the unit being counted, with the pack's own name", () => {
    const item = { unit: "kg", packWeight: 12, packName: "box" };
    const s = expectedCountSanity({ nativeQty: 0, expectedNative: 24, lastCountNative: 36, usageTracked: true, packWeight: 12 });
    expect(expectedSanityMessage(s, { value: 0, unit: "packs", item })).toBe("Are you sure — 0 boxes? We expected about 2 boxes.");
    const k = expectedCountSanity({ nativeQty: 12, expectedNative: 2, lastCountNative: 3, usageTracked: true });
    expect(expectedSanityMessage(k, { value: 12, unit: "kg", item: { unit: "kg" } })).toBe("Are you sure — 12 kg? We expected about 2 kg.");
  });
});
