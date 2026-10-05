import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY } from "@workspace/production-schedule";
import { planSlideProductionTotals } from "./meeting-plan-totals";

describe("planSlideProductionTotals", () => {
  // Regression (2026-10-05): the meeting's production table totalled every
  // "batches" row, so plan 187's 154 fried chicken bags read as calzone batches.
  it("leaves fried chicken out of the batch and pack totals", () => {
    expect(planSlideProductionTotals([
      { category: "Calzones", unit: "batches", target: 105, packs: 525 },
      { category: MAC_CHEESE_CATEGORY, unit: "packs", target: 15, packs: 15 },
      { category: FRIED_CHICKEN_CATEGORY, unit: "batches", target: 154, packs: 154 },
      { category: null, unit: "batches", target: null, packs: null }, // a core recipe not on today's plan
    ])).toEqual({ calzoneBatches: 105, totalPacks: 540 });
  });
});
