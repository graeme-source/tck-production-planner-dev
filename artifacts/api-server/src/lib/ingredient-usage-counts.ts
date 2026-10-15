/**
 * How many recipes and sub-recipes use each ingredient — the "Used in" count.
 * One copy, shared by the Ingredients list (GET /api/ingredients) and the
 * Orders page's Pulled Kanbans list (GET /api/kanbans/ingredients), so the
 * two can never disagree. The list behind the number is
 * GET /api/ingredients/:id/usage. Objective C.
 */
import { db, recipeIngredientsTable, subRecipeIngredientsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface IngredientUsageCount {
  recipes: number;
  subRecipes: number;
}

export async function loadIngredientUsageCounts(): Promise<Map<number, IngredientUsageCount>> {
  const recipeUsage = await db
    .select({ ingredientId: recipeIngredientsTable.ingredientId, cnt: sql<number>`count(distinct ${recipeIngredientsTable.recipeId})` })
    .from(recipeIngredientsTable)
    .groupBy(recipeIngredientsTable.ingredientId);
  const subRecipeUsage = await db
    .select({ ingredientId: subRecipeIngredientsTable.ingredientId, cnt: sql<number>`count(distinct ${subRecipeIngredientsTable.subRecipeId})` })
    .from(subRecipeIngredientsTable)
    .groupBy(subRecipeIngredientsTable.ingredientId);

  const usage = new Map<number, IngredientUsageCount>();
  const entry = (id: number) => {
    let e = usage.get(id);
    if (!e) { e = { recipes: 0, subRecipes: 0 }; usage.set(id, e); }
    return e;
  };
  for (const r of recipeUsage) entry(r.ingredientId).recipes = Number(r.cnt);
  for (const s of subRecipeUsage) entry(s.ingredientId).subRecipes = Number(s.cnt);
  return usage;
}
