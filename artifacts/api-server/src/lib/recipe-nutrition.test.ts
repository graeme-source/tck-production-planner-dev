import { describe, it, expect } from "vitest";
import { computeNutrition, type NutrientValues } from "./recipe-nutrition";

function n(partial: Partial<NutrientValues>): NutrientValues {
  return {
    energyKj: null, energyKcal: null, fat: null, saturates: null,
    carbohydrate: null, sugars: null, fibre: null, protein: null, salt: null,
    ...partial,
  };
}

describe("computeNutrition — cooking loss is water, not nutrients", () => {
  it("Graeme's example: 200 g with 50 g protein, 50% loss → 50 g per portion and 50 g per 100 g", () => {
    // 200 g at 25 g/100 g = 50 g protein in the ingredients.
    const r = computeNutrition([{ quantityG: 200, nutrients: n({ protein: 25 }) }], 50, 1);
    expect(r.totalRawWeightG).toBe(200);
    expect(r.cookedWeightG).toBe(100);
    expect(r.portionWeightG).toBe(100);
    expect(r.perPortion.protein).toBe(50);
    expect(r.per100g.protein).toBe(50);
  });

  it("Margherita-like recipe keeps all its protein per portion after 3% loss", () => {
    const r = computeNutrition([
      { quantityG: 87, nutrients: n({ protein: 25 }) },
      { quantityG: 70.2, nutrients: n({ protein: 12.5 }) },
      { quantityG: 89, nutrients: n({ protein: 0 }) },
    ], 3, 1);
    // 21.75 + 8.775 + 0 = 30.525 g protein, regardless of cooking loss.
    expect(r.perPortion.protein).toBeCloseTo(30.53, 2);
    expect(r.portionWeightG).toBe(239);
    // per 100 g is on the cooked weight (246.2 × 0.97 = 238.814 g).
    expect(r.per100g.protein).toBeCloseTo((30.525 / 238.814) * 100, 2);
  });

  it("divides per portion by servings", () => {
    const r = computeNutrition([{ quantityG: 400, nutrients: n({ protein: 10, fat: 5 }) }], 0, 4);
    expect(r.portionWeightG).toBe(100);
    expect(r.perPortion.protein).toBe(10);
    expect(r.perPortion.fat).toBe(5);
    expect(r.per100g.protein).toBe(10);
  });

  it("keeps a nutrient null when no ingredient has a value for it", () => {
    const r = computeNutrition([
      { quantityG: 100, nutrients: n({ protein: 10 }) },
      { quantityG: 100, nutrients: n({ protein: null, salt: 1 }) },
    ], 0, 1);
    expect(r.per100g.fat).toBeNull();
    expect(r.perPortion.fat).toBeNull();
    expect(r.perPortion.protein).toBe(10);
    expect(r.perPortion.salt).toBe(1);
  });

  it("an empty recipe gives all nulls and no division by zero", () => {
    const r = computeNutrition([], 3, 1);
    expect(r.totalRawWeightG).toBe(0);
    expect(r.cookedWeightG).toBe(0);
    expect(r.portionWeightG).toBe(0);
    for (const v of Object.values(r.per100g)) expect(v).toBeNull();
    for (const v of Object.values(r.perPortion)) expect(v).toBeNull();
  });

  it("clamps cooking loss to 0–99 so a bad figure can't zero or invert the weight", () => {
    const r = computeNutrition([{ quantityG: 100, nutrients: n({ protein: 10 }) }], 150, 1);
    expect(r.cookedWeightG).toBeCloseTo(1, 5);
    expect(r.perPortion.protein).toBe(10);
    const neg = computeNutrition([{ quantityG: 100, nutrients: n({ protein: 10 }) }], -20, 1);
    expect(neg.cookedWeightG).toBe(100);
  });
});

// Regression (Graeme, 27 Oct 2026): a recipe with a cooked sub-recipe showed
// 414 g raw / 401 g portion in the nutrition panel against a declared 320 g /
// 310 g, and per 100 g about 25% low. The weight is the recipe AS MADE.
describe("computeNutrition — the recipe as made, not its sub-recipes' raw weight", () => {
  const vals = (protein: number) => ({ energyKj: null, energyKcal: null, fat: null, saturates: null, carbohydrate: null, sugars: null, fibre: null, protein, salt: null });
  // Raw ingredients behind the recipe add up to 414 g (the braised beef
  // went in cooked), carrying 50 g of protein in total.
  const items = [{ quantityG: 314, nutrients: vals(12.74) }, { quantityG: 100, nutrients: vals(10) }];
  it("divides by the as-made weight less the cooking loss", () => {
    const r = computeNutrition(items, 3, 1, 320);
    expect(r.totalRawWeightG).toBe(320);
    expect(Math.round(r.cookedWeightG)).toBe(310);
    expect(r.portionWeightG).toBe(310);
    expect(r.perPortion.protein).toBeCloseTo(50, 0);
    expect(r.per100g.protein).toBeCloseTo(16.1, 1);
  });
  it("without an as-made weight it falls back to the ingredients' weight", () => {
    expect(computeNutrition(items, 3, 1).totalRawWeightG).toBe(414);
  });
});
