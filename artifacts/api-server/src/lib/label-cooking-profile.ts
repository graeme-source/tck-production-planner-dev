/**
 * What's in each calzone, for the suggested cooking times (Graeme,
 * 2026-10-12) — database side. Loads every recipe's components per portion
 * and every sub-recipe's makeup in a handful of queries (the tables are
 * small), converts units through @workspace/units and hands the sums to the
 * pure engine in @workspace/product-labels (cooking-tiers.ts), which decides
 * dough vs filling, meat / veg / cheese and the tier.
 *
 * Recipe quantities are per portion (one calzone). Marinade rows are left
 * out (they cook into the meat, as on the building station's weight basis).
 * Count units ("each", "pieces") aren't weights, so they're skipped.
 */
import { db, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { gramsOrNull } from "@workspace/units";
import {
  cookingProfile, subRecipeMix, suggestCooking,
  type CalzoneComponent, type CookingProfile, type CookingSuggestion, type CookingTiersConfig, type SubRecipeMakeup,
} from "@workspace/product-labels";

export interface CookingData {
  /** recipeId → its components per calzone. */
  recipes: Map<number, CalzoneComponent[]>;
}

/** Every recipe's components (or just one). */
export async function loadCookingData(recipeId?: number): Promise<CookingData> {
  const [subRows, subIngRows, subSubRows] = await Promise.all([
    db.select({ id: subRecipesTable.id, yieldUnit: subRecipesTable.yieldUnit }).from(subRecipesTable),
    db.select({
      subRecipeId: subRecipeIngredientsTable.subRecipeId, quantity: subRecipeIngredientsTable.quantity,
      unit: ingredientsTable.unit, category: ingredientsTable.category,
    }).from(subRecipeIngredientsTable)
      .innerJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(isNull(subRecipeIngredientsTable.marinadeForIngredientId)),
    db.select({
      subRecipeId: subRecipeSubRecipesTable.subRecipeId, componentId: subRecipeSubRecipesTable.componentSubRecipeId,
      quantity: subRecipeSubRecipesTable.quantity, yieldUnit: subRecipesTable.yieldUnit,
    }).from(subRecipeSubRecipesTable)
      .innerJoin(subRecipesTable, eq(subRecipeSubRecipesTable.componentSubRecipeId, subRecipesTable.id))
      .where(isNull(subRecipeSubRecipesTable.marinadeForIngredientId)),
  ]);

  const subs = new Map<number, SubRecipeMakeup>();
  for (const s of subRows) subs.set(s.id, { ingredients: [], components: [] });
  for (const r of subIngRows) {
    const g = gramsOrNull(Number(r.quantity), r.unit);
    if (g != null) subs.get(r.subRecipeId)?.ingredients.push({ category: r.category, grams: g });
  }
  for (const r of subSubRows) {
    const g = gramsOrNull(Number(r.quantity), r.yieldUnit);
    if (g != null) subs.get(r.subRecipeId)?.components.push({ subRecipeId: r.componentId, grams: g });
  }

  const [ingRows, subLinkRows] = await Promise.all([
    db.select({
      recipeId: recipeIngredientsTable.recipeId, quantity: recipeIngredientsTable.quantity,
      unit: ingredientsTable.unit, category: ingredientsTable.category,
    }).from(recipeIngredientsTable)
      .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(isNull(recipeIngredientsTable.marinadeForIngredientId)),
    db.select({
      recipeId: recipeSubRecipesTable.recipeId, subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity, yieldUnit: subRecipesTable.yieldUnit,
    }).from(recipeSubRecipesTable)
      .innerJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
      .where(isNull(recipeSubRecipesTable.marinadeForIngredientId)),
  ]);

  const memo = new Map<number, Record<string, number>>();
  const recipes = new Map<number, CalzoneComponent[]>();
  const add = (id: number, c: CalzoneComponent) => {
    if (recipeId != null && id !== recipeId) return;
    const list = recipes.get(id) ?? [];
    list.push(c);
    recipes.set(id, list);
  };
  for (const r of ingRows) {
    const g = gramsOrNull(Number(r.quantity), r.unit);
    if (g != null) add(r.recipeId, { grams: g, mix: { [r.category ?? ""]: 1 } });
  }
  for (const r of subLinkRows) {
    const g = gramsOrNull(Number(r.quantity), r.yieldUnit);
    if (g != null) add(r.recipeId, { grams: g, mix: subRecipeMix(r.subRecipeId, subs, [], memo) });
  }
  return { recipes };
}

export interface RecipeCookingSuggestion {
  profile: CookingProfile;
  suggestion: CookingSuggestion | null;
}

export function recipeCookingSuggestion(data: CookingData, recipeId: number, cfg: CookingTiersConfig): RecipeCookingSuggestion {
  const profile = cookingProfile(data.recipes.get(recipeId) ?? [], cfg.categories);
  return { profile, suggestion: suggestCooking(profile, cfg) };
}
