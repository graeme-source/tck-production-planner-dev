import {
  db,
  recipeIngredientsTable,
  recipeSubRecipesTable,
  ingredientsTable,
  subRecipesTable,
  subRecipeIngredientsTable,
  subRecipeSubRecipesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { computeMixExtras, mixExtraFor, mixExtraPerBatch, subRecipeComponentExtras, type MixLine } from "./mix-extra";

export interface ResolvedIngredient {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  category: string | null;
  processingRatio: number | null;
  prepWeightMode: "raw" | "processed";
  rawMeatTrayCapacityKg: number | null;
  minCookingTempC: number | null;
  estimatedCookTimeMin: number | null;
  ovenTempC: number | null;
  steamPct: number | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  quantityPerBatch: number;
  includeInFillingMix: boolean;
  prepCountPerPortion: number | null;
  stockInPacks: boolean;
  packWeight: number | null;
  /** Part of quantityPerBatch that is the recipe's Mix +g spread over the
   *  plan item's batches (lib/mix-extra.ts). 0 unless the caller passed
   *  mixExtraBatches. × batchesTarget = the day's extra, cooked basis. */
  mixExtraPerBatch: number;
  /** The share of mixExtraPerBatch that is marinade — counted the same way
   *  as the by-recipe prep endpoint's marinade subtraction (recipe-level
   *  marinade ingredient lines, and marinade components directly inside a
   *  non-marinade sub-recipe the recipe uses). */
  marinadeMixExtraPerBatch: number;
  /** Internal: a marinade-flagged component of a sub-recipe used directly by
   *  the recipe (the slow-cook beef pattern). */
  isSubMarinadeComponent?: boolean;
}

export async function resolveSubRecipeIngredients(
  subRecipeId: number,
  scale: number,
  ancestorPath: Set<number>,
): Promise<ResolvedIngredient[]> {
  if (ancestorPath.has(subRecipeId)) return [];

  const subRecipe = await db
    .select({ yield: subRecipesTable.yield })
    .from(subRecipesTable)
    .where(eq(subRecipesTable.id, subRecipeId))
    .limit(1);

  const yieldVal = subRecipe.length > 0 ? Number(subRecipe[0].yield) : 0;
  if (yieldVal === 0) return [];

  const effectiveScale = scale / yieldVal;

  const directIngredients = await db
    .select({
      ingredientId: subRecipeIngredientsTable.ingredientId,
      quantity: subRecipeIngredientsTable.quantity,
      marinadeForIngredientId: subRecipeIngredientsTable.marinadeForIngredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      category: ingredientsTable.category,
      processingRatio: ingredientsTable.processingRatio,
      prepWeightMode: ingredientsTable.prepWeightMode,
      rawMeatTrayCapacityKg: ingredientsTable.rawMeatTrayCapacityKg,
      minCookingTempC: ingredientsTable.minCookingTempC,
      estimatedCookTimeMin: ingredientsTable.estimatedCookTimeMin,
      ovenTempC: ingredientsTable.ovenTempC,
      steamPct: ingredientsTable.steamPct,
      stockCheckEnabled: ingredientsTable.stockCheckEnabled,
      stockCheckFrequency: ingredientsTable.stockCheckFrequency,
      stockCheckDay: ingredientsTable.stockCheckDay,
      prepCountPerPortion: ingredientsTable.prepCountPerPortion,
      stockInPacks: ingredientsTable.stockInPacks,
      packWeight: ingredientsTable.packWeight,
    })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(subRecipeIngredientsTable.subRecipeId, subRecipeId));

  const isTopLevel = ancestorPath.size === 0;
  const results: ResolvedIngredient[] = directIngredients.map((row) => ({
    ingredientId: row.ingredientId,
    ingredientName: row.ingredientName ?? `Ingredient #${row.ingredientId}`,
    unit: row.unit ?? "g",
    category: row.category ?? null,
    processingRatio: row.processingRatio ? Number(row.processingRatio) : null,
    prepWeightMode: (row.prepWeightMode === "processed" ? "processed" : "raw") as "raw" | "processed",
    rawMeatTrayCapacityKg: row.rawMeatTrayCapacityKg ? Number(row.rawMeatTrayCapacityKg) : null,
    minCookingTempC: row.minCookingTempC ? Number(row.minCookingTempC) : null,
    estimatedCookTimeMin: row.estimatedCookTimeMin ?? null,
    ovenTempC: row.ovenTempC ?? null,
    steamPct: row.steamPct ?? null,
    stockCheckEnabled: row.stockCheckEnabled ?? false,
    stockCheckFrequency: row.stockCheckFrequency ?? "daily",
    stockCheckDay: row.stockCheckDay ?? null,
    quantityPerBatch: Number(row.quantity) * effectiveScale,
    includeInFillingMix: false,
    prepCountPerPortion: row.prepCountPerPortion != null ? Number(row.prepCountPerPortion) : null,
    stockInPacks: (row.stockInPacks ?? false) && row.packWeight != null && Number(row.packWeight) > 0,
    packWeight: row.packWeight != null ? Number(row.packWeight) : null,
    mixExtraPerBatch: 0,
    marinadeMixExtraPerBatch: 0,
    isSubMarinadeComponent: isTopLevel && row.marinadeForIngredientId != null,
  }));

  const nestedSubRecipes = await db
    .select({
      componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
      quantity: subRecipeSubRecipesTable.quantity,
    })
    .from(subRecipeSubRecipesTable)
    .where(eq(subRecipeSubRecipesTable.subRecipeId, subRecipeId));

  ancestorPath.add(subRecipeId);
  for (const nested of nestedSubRecipes) {
    const nestedScale = Number(nested.quantity) * effectiveScale;
    const nestedResults = await resolveSubRecipeIngredients(
      nested.componentSubRecipeId,
      nestedScale,
      ancestorPath,
    );
    results.push(...nestedResults);
  }
  ancestorPath.delete(subRecipeId);

  return results;
}

export async function resolveRecipeIngredients(
  recipeId: number,
  portionsPerBatch: number = 1,
  options?: {
    skipToppings?: boolean;
    /** The plan item's batchesTarget. When given, each line's Mix +g (one
     *  extra per production day — lib/mix-extra.ts) is folded into
     *  quantityPerBatch spread over these batches, so quantityPerBatch ×
     *  batchesTarget is what prep must make, extra included. Omit for
     *  per-batch figures that must not carry a per-day extra. */
    mixExtraBatches?: number;
  },
): Promise<ResolvedIngredient[]> {
  const skipToppings = options?.skipToppings ?? false;
  const mixBatches = Number(options?.mixExtraBatches) || 0;

  const directIngredients = await db
    .select({
      lineId: recipeIngredientsTable.id,
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
      includeInFillingMix: recipeIngredientsTable.includeInFillingMix,
      isTopping: recipeIngredientsTable.isTopping,
      mixingOverage: recipeIngredientsTable.mixingOverage,
      marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      category: ingredientsTable.category,
      processingRatio: ingredientsTable.processingRatio,
      prepWeightMode: ingredientsTable.prepWeightMode,
      rawMeatTrayCapacityKg: ingredientsTable.rawMeatTrayCapacityKg,
      minCookingTempC: ingredientsTable.minCookingTempC,
      estimatedCookTimeMin: ingredientsTable.estimatedCookTimeMin,
      ovenTempC: ingredientsTable.ovenTempC,
      steamPct: ingredientsTable.steamPct,
      stockCheckEnabled: ingredientsTable.stockCheckEnabled,
      stockCheckFrequency: ingredientsTable.stockCheckFrequency,
      stockCheckDay: ingredientsTable.stockCheckDay,
      prepCountPerPortion: ingredientsTable.prepCountPerPortion,
      stockInPacks: ingredientsTable.stockInPacks,
      packWeight: ingredientsTable.packWeight,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));

  const recipeSubRecipes = await db
    .select({
      lineId: recipeSubRecipesTable.id,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
      isTopping: recipeSubRecipesTable.isTopping,
      includeInFillingMix: recipeSubRecipesTable.includeInFillingMix,
      mixingOverage: recipeSubRecipesTable.mixingOverage,
      marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
      yieldUnit: subRecipesTable.yieldUnit,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(eq(recipeSubRecipesTable.recipeId, recipeId));

  // Mix +g for the whole recipe (marinade splits need every line, toppings
  // included), only when the caller is totalling a real plan item.
  const mixExtras = mixBatches > 0
    ? computeMixExtras([
        ...directIngredients.map((r): MixLine => ({
          kind: "ingredient", lineId: r.lineId, itemId: r.ingredientId,
          quantityPerPortion: Number(r.quantity) || 0, unit: r.unit ?? "g",
          mixingOverage: Number(r.mixingOverage) || 0, includeInFillingMix: r.includeInFillingMix ?? false,
          marinadeForIngredientId: r.marinadeForIngredientId ?? null,
        })),
        ...recipeSubRecipes.map((r): MixLine => ({
          kind: "subRecipe", lineId: r.lineId, itemId: r.subRecipeId,
          quantityPerPortion: Number(r.quantity) || 0, unit: r.yieldUnit ?? "kg",
          mixingOverage: Number(r.mixingOverage) || 0, includeInFillingMix: r.includeInFillingMix ?? false,
          marinadeForIngredientId: r.marinadeForIngredientId ?? null,
        })),
      ])
    : null;

  const filteredDirect = skipToppings ? directIngredients.filter(r => !r.isTopping) : directIngredients;

  const results: ResolvedIngredient[] = filteredDirect.map((row) => {
    const extraPerBatch = mixExtraPerBatch(mixExtraFor(mixExtras, "ingredient", row.lineId), mixBatches);
    return {
    ingredientId: row.ingredientId,
    ingredientName: row.ingredientName ?? `Ingredient #${row.ingredientId}`,
    unit: row.unit ?? "g",
    category: row.category ?? null,
    processingRatio: row.processingRatio ? Number(row.processingRatio) : null,
    prepWeightMode: (row.prepWeightMode === "processed" ? "processed" : "raw") as "raw" | "processed",
    rawMeatTrayCapacityKg: row.rawMeatTrayCapacityKg ? Number(row.rawMeatTrayCapacityKg) : null,
    minCookingTempC: row.minCookingTempC ? Number(row.minCookingTempC) : null,
    estimatedCookTimeMin: row.estimatedCookTimeMin ?? null,
    ovenTempC: row.ovenTempC ?? null,
    steamPct: row.steamPct ?? null,
    stockCheckEnabled: row.stockCheckEnabled ?? false,
    stockCheckFrequency: row.stockCheckFrequency ?? "daily",
    stockCheckDay: row.stockCheckDay ?? null,
    quantityPerBatch: Number(row.quantity) * portionsPerBatch + extraPerBatch,
    includeInFillingMix: row.includeInFillingMix ?? false,
    prepCountPerPortion: row.prepCountPerPortion != null ? Number(row.prepCountPerPortion) : null,
    stockInPacks: (row.stockInPacks ?? false) && row.packWeight != null && Number(row.packWeight) > 0,
    packWeight: row.packWeight != null ? Number(row.packWeight) : null,
    mixExtraPerBatch: extraPerBatch,
    marinadeMixExtraPerBatch: row.marinadeForIngredientId != null ? extraPerBatch : 0,
    };
  });

  const filteredSubRecipes = skipToppings ? recipeSubRecipes.filter(r => !r.isTopping) : recipeSubRecipes;

  for (const rsr of filteredSubRecipes) {
    const visited = new Set<number>();
    // recipe_sub_recipes.quantity is stored per-portion (same convention as
    // recipe_ingredients.quantity — see dough-prep endpoint comment at
    // production-plans.ts:4566 and sub-recipe-requirements at :3124). Scale
    // up to per-batch here so quantityPerBatch is comparable to the direct
    // ingredient calculation above.
    // Mix +g on the sub-recipe line scales the whole sub-recipe up, so the
    // extra expands into its ingredients exactly like the line itself.
    const extraPerBatch = mixExtraPerBatch(mixExtraFor(mixExtras, "subRecipe", rsr.lineId), mixBatches);
    const scalePerBatch = Number(rsr.quantity) * portionsPerBatch + extraPerBatch;
    const subResults = await resolveSubRecipeIngredients(
      rsr.subRecipeId,
      scalePerBatch,
      visited,
    );
    if (extraPerBatch > 0) {
      const compExtras = subRecipeComponentExtras(subResults.map(r => r.quantityPerBatch), scalePerBatch, extraPerBatch);
      subResults.forEach((r, i) => {
        r.mixExtraPerBatch = compExtras[i] ?? 0;
        if (r.isSubMarinadeComponent && rsr.marinadeForIngredientId == null) r.marinadeMixExtraPerBatch = r.mixExtraPerBatch;
      });
    }
    results.push(...subResults);
  }

  return results;
}

export function aggregateIngredients(
  ingredients: ResolvedIngredient[],
): Map<number, ResolvedIngredient> {
  const map = new Map<number, ResolvedIngredient>();
  for (const ing of ingredients) {
    const existing = map.get(ing.ingredientId);
    if (existing) {
      existing.quantityPerBatch += ing.quantityPerBatch;
      existing.mixExtraPerBatch += ing.mixExtraPerBatch;
      existing.marinadeMixExtraPerBatch += ing.marinadeMixExtraPerBatch;
      if (ing.includeInFillingMix) existing.includeInFillingMix = true;
    } else {
      map.set(ing.ingredientId, { ...ing });
    }
  }
  return map;
}

export function roundByUnit(value: number, unit: string): number {
  if (unit === "g" || unit === "ml") {
    return Math.round(value);
  }
  return Math.round(value * 100) / 100;
}
