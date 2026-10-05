import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY } from "@workspace/production-schedule";
import { meetingDayTotals } from "./meeting-day-totals";

describe("meetingDayTotals", () => {
  // Regression (2026-10-05): plan 187 — 105 calzone batches, 15 mac packs,
  // 154 fried chicken bags. The meetings said "across 274 batches planned".
  it("leaves fried chicken out of the day's batches and rejects", () => {
    const t = meetingDayTotals([
      { recipeCategory: "Calzones", batchesTarget: 105, wonlyTotal: 6, dogBinCount: 2, shortCount: 1, leftoverFillingGrams: 300 },
      { recipeCategory: MAC_CHEESE_CATEGORY, batchesTarget: 15, wonlyTotal: 1, dogBinCount: 0 },
      { recipeCategory: FRIED_CHICKEN_CATEGORY, batchesTarget: 154, wonlyTotal: 4, dogBinCount: 3, shortCount: 5, leftoverFillingGrams: 900 },
    ]);
    expect(t).toEqual({ wonky: 7, dogBin: 2, batchesTarget: 120, shortCount: 1, leftoverFillingGrams: 300 });
  });

  it("treats missing counters as zero", () => {
    expect(meetingDayTotals([{ recipeCategory: null, batchesTarget: null, wonlyTotal: null, dogBinCount: null }]))
      .toEqual({ wonky: 0, dogBin: 0, batchesTarget: 0, shortCount: 0, leftoverFillingGrams: 0 });
  });
});
