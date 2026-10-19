import { billetPortionG } from "@workspace/production-schedule";

/**
 * Which doughs go into the main (calzone) mixes — Graeme, 19 Oct 2026:
 * opening tomorrow's plan straight from the calendar's dough card put the
 * Bun Dough and the Calzone Dough into ONE ingredient list and one set of
 * mixes, so the team couldn't make the dough. Every dough is its own product
 * with its own mixes: a dough made on the production day (bun dough) never
 * joins the main mix; it is shown as its own group (sameDayDough) instead.
 */
export function mainMixDoughIds(
  doughSubRecipeIds: number[],
  links: Array<{ subRecipeId: number; madeOnProductionDay: boolean | null }>,
): number[] {
  const sameDay = new Set(links.filter(l => l.madeOnProductionDay).map(l => l.subRecipeId));
  return doughSubRecipeIds.filter(id => !sameDay.has(id));
}

export type DoughIngredientRow = {
  subRecipeId: number;
  ingredientId: number | null;
  quantity: string | number | null;
  ingredientName: string | null;
  unit: string | null;
};

/**
 * The main mix's ingredient totals: each dough's own ingredients scaled by
 * the dough needed of THAT dough only (dough kg ÷ its yield). Only the doughs
 * in mixDoughIds are counted, so a same-day dough's salt/yeast/flour never
 * lands in the calzone list even when the ingredient is shared.
 */
export function aggregateDoughIngredients(
  mixDoughIds: number[],
  doughKgBySubRecipe: Map<number, number>,
  yieldBySubRecipe: Map<number, number>,
  rows: DoughIngredientRow[],
): Array<{ ingredientId: number | null; ingredientName: string; unit: string; totalQty: number }> {
  const totals = new Map<number, { ingredientId: number | null; ingredientName: string; unit: string; totalQty: number }>();
  for (const srId of mixDoughIds) {
    const srYield = yieldBySubRecipe.get(srId) ?? 0;
    if (srYield <= 0) continue;
    const scale = (doughKgBySubRecipe.get(srId) ?? 0) / srYield;
    for (const ing of rows.filter(r => r.subRecipeId === srId)) {
      const key = ing.ingredientId ?? -1;
      const contribution = (Number(ing.quantity) || 0) * scale;
      const existing = totals.get(key);
      if (existing) existing.totalQty += contribution;
      else totals.set(key, {
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName ?? `Ingredient #${ing.ingredientId}`,
        unit: ing.unit ?? "kg",
        totalQty: contribution,
      });
    }
  }
  return Array.from(totals.values());
}

export type SameDayDoughGroup = {
  subRecipeId: number;
  subRecipeName: string;
  planId: number;
  planName: string;
  planDate: string;
  totalDoughKg: number;
  totalFlourKg: number;
  mixCount: number;
  /** One billet per batch — the dough is portioned and sheeted whole, never balled. */
  billetCount: number;
  recipes: Array<{
    recipeId: number; recipeName: string; batchesTarget: number; portionsPerBatch: number;
    doughKgPerBatch: number; doughKgTotal: number; gramsPerPortion: number;
    /** Grams each billet is portioned to (recipe setting, else dough per batch). */
    billetWeightG: number;
  }>;
  ingredients: Array<{ ingredientId: number | null; ingredientName: string; unit: string; totalQty: number; qtyPerMix: number }>;
};

/**
 * Same-day doughs (made on the production day — cinnamon bun dough) as one
 * self-contained group per dough: its batches, billets and its OWN
 * ingredients scaled from its own sub-recipe only, its own mixes.
 */
export function buildSameDayDoughGroups(input: {
  items: Array<{ planId: number; planName: string; planDate: string; recipeId: number | null; batchesTarget: number | string | null; recipeName: string | null; portionsPerBatch: number | string | null; billetWeightG?: number | string | null }>;
  links: Array<{ recipeId: number; subRecipeId: number; quantityPerPortion: string | number | null; subRecipeName: string | null; subRecipeYield: string | number | null }>;
  ingredients: DoughIngredientRow[];
  mixerCapacityKg: number;
  fallbackPlanDate: string;
}): SameDayDoughGroup[] {
  const out: SameDayDoughGroup[] = [];
  const subIds = [...new Set(input.links.map(l => l.subRecipeId))];
  for (const srId of subIds) {
    const links = input.links.filter(l => l.subRecipeId === srId);
    const srName = links[0]?.subRecipeName ?? "Dough";
    const srYield = Number(links[0]?.subRecipeYield) || 0;

    const recipes: SameDayDoughGroup["recipes"] = [];
    let planId = 0; let planName = ""; let planDate = input.fallbackPlanDate;
    for (const item of input.items) {
      const link = links.find(l => l.recipeId === item.recipeId);
      if (!link || item.recipeId == null) continue;
      const batchesTarget = Number(item.batchesTarget) || 0;
      const ppb = Number(item.portionsPerBatch) || 1;
      const perPortion = Number(link.quantityPerPortion) || 0;
      const doughKgPerBatch = perPortion * ppb;
      planId = item.planId; planName = item.planName; planDate = item.planDate;
      recipes.push({
        recipeId: item.recipeId,
        recipeName: item.recipeName ?? `Recipe #${item.recipeId}`,
        batchesTarget,
        portionsPerBatch: ppb,
        doughKgPerBatch: Math.round(doughKgPerBatch * 1000) / 1000,
        doughKgTotal: Math.round(doughKgPerBatch * batchesTarget * 1000) / 1000,
        gramsPerPortion: Math.round(perPortion * 1000),
        billetWeightG: billetPortionG(doughKgPerBatch, item.billetWeightG),
      });
    }
    if (recipes.length === 0) continue;

    const totalDoughKg = recipes.reduce((s, r) => s + r.doughKgTotal, 0);
    const srIngs = input.ingredients.filter(r => r.subRecipeId === srId);
    const scale = srYield > 0 ? totalDoughKg / srYield : 0;
    const flourRow = srIngs.find(r => r.ingredientName?.toLowerCase().includes("flour"));
    const flourPerYieldKg = flourRow ? (flourRow.unit === "g" ? (Number(flourRow.quantity) || 0) / 1000 : Number(flourRow.quantity) || 0) : 0;
    const totalFlourKg = flourPerYieldKg * scale;
    const cap = input.mixerCapacityKg;
    const mixCount = totalDoughKg > 0 ? Math.max(1, cap > 0 ? Math.ceil(totalFlourKg / cap) : 1) : 0;

    out.push({
      subRecipeId: srId,
      subRecipeName: srName,
      planId, planName, planDate,
      totalDoughKg: Math.round(totalDoughKg * 100) / 100,
      totalFlourKg: Math.round(totalFlourKg * 100) / 100,
      mixCount,
      billetCount: recipes.reduce((s, r) => s + r.batchesTarget, 0),
      recipes,
      ingredients: srIngs.map(ing => {
        const totalQty = (Number(ing.quantity) || 0) * scale;
        return {
          ingredientId: ing.ingredientId,
          ingredientName: ing.ingredientName ?? `Ingredient #${ing.ingredientId}`,
          unit: ing.unit ?? "kg",
          totalQty: Math.round(totalQty * 1000) / 1000,
          qtyPerMix: mixCount > 0 ? Math.round((totalQty / mixCount) * 1000) / 1000 : 0,
        };
      }),
    });
  }
  return out;
}
