// Pure recipe nutrition maths — no DB, no network. Used by
// computeRecipeNutritionals (routes/recipes.ts), which feeds the recipe
// nutrition panel, product labels, spec sheets and the Shopify website sync.
//
// Cooking loss is WATER (the standard UK labelling basis): the nutrients stay
// in the food and only the weight drops. So:
//   per portion = total nutrients in the ingredients ÷ servings  (unchanged by cooking)
//   per 100 g   = total nutrients ÷ COOKED weight × 100           (concentrated by cooking)
// Before 2026-10-23 per 100 g was worked out on the RAW weight and then scaled
// to the cooked portion, which silently took the cooking loss off every
// nutrient (Margherita protein showed 30.7 g per portion instead of 31.6 g).
//
// The weight is the recipe AS MADE (Graeme, 27 Oct 2026): a cooked
// sub-recipe counts at the weight put in, not its raw ingredients' weight —
// the braised beef that started as 1.5 kg raw and went in as 0.97 kg cooked
// counts as 0.97 kg. Its nutrients still come from every raw ingredient
// (the water it lost carried none). Otherwise per 100 g was ~25% low and the
// portion showed 401 g against a declared 310 g. Same weight as the recipe
// page's Declared Weights card.

import { NUTRIENT_KEYS } from "@workspace/product-labels";

export { NUTRIENT_KEYS };
export type NutrientKey = typeof NUTRIENT_KEYS[number];
export type NutrientValues = Record<NutrientKey, number | null>;

export interface NutritionItem {
  /** Weight of this ingredient in the recipe, in grams (raw). */
  quantityG: number;
  /** Per-100 g values for the ingredient; null = not known. */
  nutrients: NutrientValues;
}

export interface NutritionResult {
  totalRawWeightG: number;
  cookedWeightG: number;
  /** Cooked weight of one portion, rounded to whole grams. */
  portionWeightG: number;
  per100g: NutrientValues;
  perPortion: NutrientValues;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyValues(): NutrientValues {
  return {
    energyKj: null, energyKcal: null, fat: null, saturates: null,
    carbohydrate: null, sugars: null, fibre: null, protein: null, salt: null,
  };
}

export function computeNutrition(items: NutritionItem[], cookingLossPercent: number, servings: number, asUsedWeightG?: number | null): NutritionResult {
  const loss = Math.min(99, Math.max(0, Number.isFinite(cookingLossPercent) ? cookingLossPercent : 0));
  const portions = servings > 0 && Number.isFinite(servings) ? servings : 1;

  const totalRawWeightG = asUsedWeightG != null && asUsedWeightG > 0
    ? asUsedWeightG
    : items.reduce((sum, i) => sum + (i.quantityG > 0 ? i.quantityG : 0), 0);
  const cookedWeightG = totalRawWeightG * (1 - loss / 100);
  const portionWeightG = Math.round(cookedWeightG / portions);

  const per100g = emptyValues();
  const perPortion = emptyValues();

  if (cookedWeightG > 0) {
    for (const key of NUTRIENT_KEYS) {
      let total = 0;
      let known = false;
      for (const item of items) {
        const val = item.nutrients[key];
        if (val == null) continue;
        known = true;
        if (item.quantityG > 0) total += (val / 100) * item.quantityG;
      }
      if (!known) continue;
      per100g[key] = round2((total / cookedWeightG) * 100);
      perPortion[key] = round2(total / portions);
    }
  }

  return { totalRawWeightG, cookedWeightG, portionWeightG, per100g, perPortion };
}
