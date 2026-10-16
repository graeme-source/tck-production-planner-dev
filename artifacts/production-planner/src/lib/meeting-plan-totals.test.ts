import { describe, expect, it } from "vitest";
import { FRIED_CHICKEN_CATEGORY, MAC_CHEESE_CATEGORY } from "@workspace/production-schedule";
import { planSlideProductionTotals, planSlideScope } from "./meeting-plan-totals";

describe("planSlideScope", () => {
  const items = [
    { recipeId: 1, recipeCategory: MAC_CHEESE_CATEGORY },
    { recipeId: 2, recipeCategory: "Calzones" },
    { recipeId: 3, recipeCategory: FRIED_CHICKEN_CATEGORY },
  ];
  const calc = [
    { recipeId: 2, recipeCategory: "Calzones" },
    { recipeId: 3, recipeCategory: FRIED_CHICKEN_CATEGORY },
    { recipeId: 9, recipeCategory: null },
  ];

  // Regression (2026-10-12): Monday's Order of Production slide listed the
  // four fried chicken lines and counted their freezer stock in the totals.
  it("leaves fried chicken out of the morning meeting's rows and stock", () => {
    const s = planSlideScope(items, calc, true);
    expect(s.items.map(i => i.recipeId)).toEqual([1, 2]);
    expect(s.calcRecipes.map(r => r.recipeId)).toEqual([2, 9]);
  });

  it("keeps everything for the Pack Report", () => {
    const s = planSlideScope(items, calc, false);
    expect(s.items).toHaveLength(3);
    expect(s.calcRecipes).toHaveLength(3);
  });
});

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
  // Graeme, 16 Oct 2026: buns are not calzone batches (recipe flag).
  it("leaves recipes flagged out of the KPIs out of the calzone batches", () => {
    expect(planSlideProductionTotals([
      { category: "Calzones", unit: "batches", target: 90, packs: 450 },
      { category: "Desserts", excludeFromKpis: true, unit: "batches", target: 6, packs: 48 },
    ])).toEqual({ calzoneBatches: 90, totalPacks: 498 });
  });
});
