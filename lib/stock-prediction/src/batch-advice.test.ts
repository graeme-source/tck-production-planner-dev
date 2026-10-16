import { describe, it, expect } from "vitest";
import { factoryAdvice, initialBatchTotal, pullBackAdvice, suggestedBatchTotal, batchRange } from "./batch-advice";
import { DEFAULT_FACTORY_THRESHOLDS as T } from "./factory-forecast";

const days = (...packs: number[]) => packs.map((p, i) => ({ date: `2026-10-${String(5 + i).padStart(2, "0")}`, packs: p }));

describe("factoryAdvice — Graeme's levels (16 Oct 2026)", () => {
  it("1,058 predicted: above target, no suggestion", () => {
    expect(factoryAdvice(1058, T)).toEqual({ direction: null, reason: null, aim: null });
  });
  it("800–1,000 and up to 1,249: nothing", () => {
    for (const p of [800, 900, 1000, 1001, 1249]) expect(factoryAdvice(p, T).direction).toBeNull();
  });
  it("1,250 and over: fewer, to land near 1,000; freezing at 1,500", () => {
    expect(factoryAdvice(1250, T)).toEqual({ direction: "fewer", reason: "warning", aim: 1000 });
    expect(factoryAdvice(1500, T)).toEqual({ direction: "fewer", reason: "freeze", aim: 1000 });
  });
  it("over 1,000 while stock is building: time to pull back", () => {
    const pb = { days: 3, latest: 1100, rise: 60 };
    expect(factoryAdvice(1058, T, pb)).toEqual({ direction: "fewer", reason: "pull-back", aim: 1000 });
    // Already back on target → nothing, even with the history.
    expect(factoryAdvice(990, T, pb).direction).toBeNull();
  });
  it("under 800: more, toward 800; under 500 is too low", () => {
    expect(factoryAdvice(799, T)).toEqual({ direction: "more", reason: "under", aim: 800 });
    expect(factoryAdvice(499, T)).toEqual({ direction: "more", reason: "too-low", aim: 800 });
  });
});

describe("pullBackAdvice", () => {
  it("3 plan days in a row above 1,000 and rising", () => {
    expect(pullBackAdvice(days(900, 1020, 1060, 1110), T)).toEqual({ days: 3, latest: 1110, rise: 90 });
  });
  it("only 2 days above 1,000 → not yet", () => {
    expect(pullBackAdvice(days(900, 950, 1060, 1110), T)).toBeNull();
  });
  it("above 1,000 but coming down → not pulling back", () => {
    expect(pullBackAdvice(days(1200, 1150, 1100), T)).toBeNull();
  });
  it("the run must reach the latest day", () => {
    expect(pullBackAdvice(days(1050, 1100, 1150, 990), T)).toBeNull();
  });
  it("no history → null; order of input doesn't matter", () => {
    expect(pullBackAdvice([], T)).toBeNull();
    expect(pullBackAdvice([...days(1010, 1030, 1080)].reverse(), T)).toEqual({ days: 3, latest: 1080, rise: 70 });
  });
});

describe("suggested total (left column)", () => {
  it("Graeme's case: 100 batches → ~1,058, floor 80, cap 110 → 100 stays", () => {
    expect(suggestedBatchTotal({ currentTotal: 100, cap: 110, minBatchesPerDay: 80, change: 0 })).toBe(100);
  });
  it("follows the forecast's recommendation, never below 80 or above the cap", () => {
    expect(suggestedBatchTotal({ currentTotal: 100, cap: 110, minBatchesPerDay: 80, change: -12 })).toBe(88);
    expect(suggestedBatchTotal({ currentTotal: 90, cap: 110, minBatchesPerDay: 80, change: -40 })).toBe(80);
    expect(suggestedBatchTotal({ currentTotal: 100, cap: 110, minBatchesPerDay: 80, change: 30 })).toBe(110);
  });
  it("the old ceiling's 5 batches can never be suggested", () => {
    expect(suggestedBatchTotal({ currentTotal: 5, cap: 110, minBatchesPerDay: 80, change: 0 })).toBe(80);
  });
  it("a no-Dough-Prep day (cap 80) keeps the floor at the cap", () => {
    expect(batchRange(80, 90)).toEqual({ floor: 80, cap: 80 });
    expect(suggestedBatchTotal({ currentTotal: 100, cap: 80, minBatchesPerDay: 90, change: 0 })).toBe(80);
  });
});

describe("initialBatchTotal (what Create Plan starts on)", () => {
  const base = { cap: 110, minBatchesPerDay: 80, packsPerBatch: 5, thresholds: T };
  it("Graeme's case: 100 → 1,058; the cap (110 → ~1,108) is still under the warning, so 110", () => {
    expect(initialBatchTotal({ ...base, currentTotal: 100, predicted: 1058 })).toBe(110);
  });
  it("cap would reach the warning → the total that lands near 1,000", () => {
    // 100 → 1,200; 110 → 1,250 (warning) → 110 − 50 = 60, floored at 80.
    expect(initialBatchTotal({ ...base, currentTotal: 100, predicted: 1200 })).toBe(80);
    // 100 → 1,150; 110 → 1,200 … not a warning → cap.
    expect(initialBatchTotal({ ...base, currentTotal: 100, predicted: 1150 })).toBe(110);
    // Already at the cap, 1,310 → 110 − 62 = 48, floored at 80.
    expect(initialBatchTotal({ ...base, currentTotal: 110, predicted: 1310 })).toBe(80);
    // A 140 cap: 1,300 → 140 − 60 = 80; 1,260 → 140 − 52 = 88 (lands ~1,000).
    expect(initialBatchTotal({ ...base, cap: 140, currentTotal: 140, predicted: 1300 })).toBe(80);
    expect(initialBatchTotal({ ...base, cap: 140, currentTotal: 140, predicted: 1260 })).toBe(88);
  });
  it("stock building for days → pull back even under the warning", () => {
    expect(initialBatchTotal({ ...base, currentTotal: 100, predicted: 1058, pullBack: { days: 4, latest: 1120, rise: 90 } })).toBe(88);
  });
  it("low stock → the full cap", () => {
    expect(initialBatchTotal({ ...base, currentTotal: 100, predicted: 400 })).toBe(110);
  });
});
