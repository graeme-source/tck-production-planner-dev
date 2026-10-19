import { describe, expect, it } from "vitest";
import { mainMixDoughIds, aggregateDoughIngredients, buildSameDayDoughGroups } from "./dough-mix-split";

describe("main dough mix (Graeme, 2026-10-19: bun + calzone dough were one list)", () => {
  const links = [
    { subRecipeId: 1, madeOnProductionDay: false }, // Calzone Dough
    { subRecipeId: 60, madeOnProductionDay: true },  // Bun Dough
    { subRecipeId: 1, madeOnProductionDay: false },
  ];
  it("keeps bun dough out of the calzone mixes", () => {
    expect(mainMixDoughIds([1, 60], links)).toEqual([1]);
  });
  it("leaves a plan with only calzone dough unchanged", () => {
    expect(mainMixDoughIds([1], links)).toEqual([1]);
  });
  it("treats a missing flag as an ordinary dough", () => {
    expect(mainMixDoughIds([5], [{ subRecipeId: 5, madeOnProductionDay: null }])).toEqual([5]);
  });
});

// Both doughs share Flour, Salt and Yeast (same ingredient ids). Each must be
// scaled from its OWN sub-recipe only — no crossover either way.
const FLOUR = 10, SALT = 11, YEAST = 12, SUGAR = 13;
const ingredientRows = [
  // Calzone Dough (id 1): yield 10 kg
  { subRecipeId: 1, ingredientId: FLOUR, quantity: "6", ingredientName: "Flour", unit: "kg" },
  { subRecipeId: 1, ingredientId: SALT, quantity: "0.1", ingredientName: "Salt", unit: "kg" },
  { subRecipeId: 1, ingredientId: YEAST, quantity: "0.05", ingredientName: "Yeast", unit: "kg" },
  // Bun Dough (id 60): yield 5 kg
  { subRecipeId: 60, ingredientId: FLOUR, quantity: "3", ingredientName: "Flour", unit: "kg" },
  { subRecipeId: 60, ingredientId: SALT, quantity: "0.04", ingredientName: "Salt", unit: "kg" },
  { subRecipeId: 60, ingredientId: YEAST, quantity: "0.1", ingredientName: "Yeast", unit: "kg" },
  { subRecipeId: 60, ingredientId: SUGAR, quantity: "0.5", ingredientName: "Sugar", unit: "kg" },
];

describe("no ingredient crossover between calzone and bun dough (Graeme, 19 Oct 2026)", () => {
  it("the calzone mix counts only calzone dough's flour, salt and yeast", () => {
    const doughLinks = [
      { subRecipeId: 1, madeOnProductionDay: false },
      { subRecipeId: 60, madeOnProductionDay: true },
    ];
    const mixIds = mainMixDoughIds([1, 60], doughLinks);
    // 50 batches × 1.15 kg calzone dough = 57.5 kg; bun dough 45.8 kg is NOT here.
    const totals = aggregateDoughIngredients(
      mixIds,
      new Map([[1, 57.5], [60, 45.792]]),
      new Map([[1, 10], [60, 5]]),
      ingredientRows,
    );
    const by = Object.fromEntries(totals.map(t => [t.ingredientName, t.totalQty]));
    expect(by.Flour).toBeCloseTo(6 * 5.75);
    expect(by.Salt).toBeCloseTo(0.1 * 5.75);
    expect(by.Yeast).toBeCloseTo(0.05 * 5.75);
    expect(by.Sugar).toBeUndefined();
  });

  it("the bun group is scaled from bun dough only, with billets and the portion weight", () => {
    const groups = buildSameDayDoughGroups({
      items: [
        { planId: 202, planName: "Tue", planDate: "2026-10-20", recipeId: 5, batchesTarget: 50, recipeName: "Calzone", portionsPerBatch: 10 },
        { planId: 202, planName: "Tue", planDate: "2026-10-20", recipeId: 27, batchesTarget: 18, recipeName: "Cinnamon Buns", portionsPerBatch: 48, billetWeightG: 2467 },
      ],
      // Only same-day links reach this function (the route filters by flag).
      links: [{ recipeId: 27, subRecipeId: 60, quantityPerPortion: "0.053", subRecipeName: "Bun Dough", subRecipeYield: "5" }],
      ingredients: ingredientRows,
      mixerCapacityKg: 25,
      fallbackPlanDate: "2026-10-20",
    });
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.billetCount).toBe(18);
    expect(g.recipes).toHaveLength(1);
    expect(g.recipes[0].doughKgPerBatch).toBeCloseTo(2.544);
    expect(g.recipes[0].billetWeightG).toBe(2467); // portion lighter; dough still made at 2,544 g
    expect(g.totalDoughKg).toBeCloseTo(45.79, 2);
    const scale = 45.792 / 5;
    const by = Object.fromEntries(g.ingredients.map(i => [i.ingredientName, i.totalQty]));
    expect(by.Flour).toBeCloseTo(3 * scale, 2);
    expect(by.Salt).toBeCloseTo(0.04 * scale, 2);
    expect(by.Yeast).toBeCloseTo(0.1 * scale, 2);
    expect(g.ingredients.map(i => i.ingredientName)).toEqual(["Flour", "Salt", "Yeast", "Sugar"]);
  });

  it("falls back to the dough per batch when the recipe has no billet weight", () => {
    const [g] = buildSameDayDoughGroups({
      items: [{ planId: 1, planName: "P", planDate: "2026-10-20", recipeId: 27, batchesTarget: 2, recipeName: "Buns", portionsPerBatch: 48, billetWeightG: null }],
      links: [{ recipeId: 27, subRecipeId: 60, quantityPerPortion: "0.053", subRecipeName: "Bun Dough", subRecipeYield: "5" }],
      ingredients: ingredientRows,
      mixerCapacityKg: 25,
      fallbackPlanDate: "2026-10-20",
    });
    expect(g.recipes[0].billetWeightG).toBe(2544);
  });
});
