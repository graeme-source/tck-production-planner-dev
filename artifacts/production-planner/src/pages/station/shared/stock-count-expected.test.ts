// #327: "Are you sure?" — a count checked against the running-stock
// expectation (last count + deliveries − usage). Blind since 23 Oct 2026:
// the expectation decides whether to ask but is never shown.
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

  // Graeme, 23 Oct 2026: "Keep counts blind — remove the expected figure from
  // the 'Are you sure?' check." No number from the expectation (or the last
  // count) may appear in what the station sees.
  describe("blind: the question never shows the expected figure", () => {
    const item = { unit: "kg", packWeight: 12, packName: "box" };
    // Expected 24 kg = 2 boxes; last count 36 kg = 3 boxes.
    const ledger = { expectedNative: 24, lastCountNative: 36, usageTracked: true, packWeight: 12 };
    const leaks = (msg: string | null) => /\b(2|3|24|36)\b|expected about|usually/i.test(msg ?? "");

    it("zero after a positive count: asks if the shelf is empty, no numbers", () => {
      const s = expectedCountSanity({ ...ledger, nativeQty: 0 });
      const msg = expectedSanityMessage(s, { value: 0, unit: "packs", item });
      expect(msg).toBe("That's zero — are you sure the shelf is empty?");
      expect(msg).not.toMatch(/\d/);
    });

    it("far off: says count again, shows only the amount typed", () => {
      const s = expectedCountSanity({ ...ledger, nativeQty: 84 }); // 7 boxes vs 2 expected
      const msg = expectedSanityMessage(s, { value: 7, unit: "packs", item });
      expect(msg).toBe("7 boxes? That's very different from what we'd expect — count again to be sure.");
      expect(leaks(msg)).toBe(false);
      const k = expectedCountSanity({ nativeQty: 9, expectedNative: 2, lastCountNative: 3, usageTracked: true });
      const kMsg = expectedSanityMessage(k, { value: 9, unit: "kg", item: { unit: "kg" } });
      expect(kMsg).toContain("count again to be sure");
      expect(leaks(kMsg)).toBe(false);
    });

    it("the same in grams and with usage the app can't see (falls back to the last count internally)", () => {
      const s = expectedCountSanity({ ...ledger, usageTracked: false, nativeQty: 0 });
      expect(s.level).toBe("warn");
      expect(expectedSanityMessage(s, { value: 0, unit: "g", item })).not.toMatch(/\d/);
    });

    it("still asks nothing when the count is fine", () => {
      expect(expectedSanityMessage({ level: "ok" }, { value: 2, unit: "packs", item })).toBeNull();
    });
  });
});
