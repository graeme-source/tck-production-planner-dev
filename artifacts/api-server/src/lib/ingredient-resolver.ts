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
    })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(subRecipeIngredientsTable.subRecipeId, subRecipeId));

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
  options?: { skipToppings?: boolean },
): Promise<ResolvedIngredient[]> {
  const skipToppings = options?.skipToppings ?? false;

  const directIngredients = await db
    .select({
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
      includeInFillingMix: recipeIngredientsTable.includeInFillingMix,
      isTopping: recipeIngredientsTable.isTopping,
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
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));

  const filteredDirect = skipToppings ? directIngredients.filter(r => !r.isTopping) : directIngredients;

  const results: ResolvedIngredient[] = filteredDirect.map((row) => ({
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
    quantityPerBatch: Number(row.quantity) * portionsPerBatch,
    includeInFillingMix: row.includeInFillingMix ?? false,
  }));

  const recipeSubRecipes = await db
    .select({
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
      isTopping: recipeSubRecipesTable.isTopping,
    })
    .from(recipeSubRecipesTable)
    .where(eq(recipeSubRecipesTable.recipeId, recipeId));

  const filteredSubRecipes = skipToppings ? recipeSubRecipes.filter(r => !r.isTopping) : recipeSubRecipes;

  for (const rsr of filteredSubRecipes) {
    const visited = new Set<number>();
    const subResults = await resolveSubRecipeIngredients(
      rsr.subRecipeId,
      Number(rsr.quantity),
      visited,
    );
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
