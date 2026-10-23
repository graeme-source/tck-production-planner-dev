import { describe, it, expect } from "vitest";
import { batchCeilings, batchCeilingFor } from "./batch-ceiling";

// #305: Jane wanted the full-team ceiling at 100, not a hidden 110.
describe("batch ceiling follows the DPT daily batches", () => {
  const s = { dptDailyBatches: 100, withoutDoughPrep: 80, legacyWithDoughPrep: 110 };

  it("full team (Dough Prep on) = the DPT figure, not the old 110", () => {
    expect(batchCeilingFor(true, s)).toBe(100);
  });
  it("no Dough Prep = the 80 setting", () => {
    expect(batchCeilingFor(false, s)).toBe(80);
  });
  it("no Dough Prep never exceeds the DPT figure when DPT is lower", () => {
    expect(batchCeilings({ ...s, dptDailyBatches: 70 })).toEqual({ withDoughPrep: 70, withoutDoughPrep: 70 });
  });
  it("DPT not set falls back to the old full-team setting, then 110", () => {
    expect(batchCeilingFor(true, { ...s, dptDailyBatches: 0 })).toBe(110);
    expect(batchCeilingFor(true, { dptDailyBatches: NaN, withoutDoughPrep: NaN, legacyWithDoughPrep: NaN })).toBe(110);
    expect(batchCeilingFor(false, { dptDailyBatches: NaN, withoutDoughPrep: NaN, legacyWithDoughPrep: NaN })).toBe(80);
  });
});
