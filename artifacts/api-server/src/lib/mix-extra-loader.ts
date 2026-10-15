/**
 * Reads a recipe's lines for the Mix +g maths in lib/mix-extra.ts. Used by
 * the prep endpoints that read recipe rows themselves (main prep, sub-recipe
 * requirements, raw-meat marinades, outstanding prep); the ingredient
 * resolver reads the same columns in its own queries.
 */
import { db, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeMixExtras, type MixExtras, type MixLine } from "./mix-extra";

export async function loadRecipeMixLines(recipeId: number): Promise<MixLine[]> {
  const ingRows = await db
    .select({
      lineId: recipeIngredientsTable.id,
      itemId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
      unit: ingredientsTable.unit,
      mixingOverage: recipeIngredientsTable.mixingOverage,
      includeInFillingMix: recipeIngredientsTable.includeInFillingMix,
      marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));
  const subRows = await db
    .select({
      lineId: recipeSubRecipesTable.id,
      itemId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
      unit: subRecipesTable.yieldUnit,
      mixingOverage: recipeSubRecipesTable.mixingOverage,
      includeInFillingMix: recipeSubRecipesTable.includeInFillingMix,
      marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(eq(recipeSubRecipesTable.recipeId, recipeId));
  const toLine = (kind: MixLine["kind"]) => (r: typeof ingRows[number]): MixLine => ({
    kind,
    lineId: r.lineId,
    itemId: r.itemId,
    quantityPerPortion: Number(r.quantity) || 0,
    unit: r.unit ?? (kind === "ingredient" ? "g" : "kg"),
    mixingOverage: Number(r.mixingOverage) || 0,
    includeInFillingMix: r.includeInFillingMix ?? false,
    marinadeForIngredientId: r.marinadeForIngredientId ?? null,
  });
  return [...ingRows.map(toLine("ingredient")), ...subRows.map(toLine("subRecipe"))];
}

export async function loadRecipeMixExtras(recipeId: number): Promise<MixExtras> {
  return computeMixExtras(await loadRecipeMixLines(recipeId));
}

/** One request's memo, so a handler that walks the plan twice reads each
 *  recipe once. */
export function createMixExtrasCache(): (recipeId: number) => Promise<MixExtras> {
  const cache = new Map<number, Promise<MixExtras>>();
  return (recipeId: number) => {
    let p = cache.get(recipeId);
    if (!p) { p = loadRecipeMixExtras(recipeId); cache.set(recipeId, p); }
    return p;
  };
}
