/**
 * Marinades that travel on a raw meat's prep trays, for one recipe run.
 *
 * Moved verbatim out of GET /production-plans/:id/prep-requirements-by-recipe
 * (routes/production-plans.ts, frozen by the charter) on 2026-10-01 so the
 * slow-meat tray limit on Create Plan counts trays with EXACTLY the weights
 * the Raw Meat station shows — the station adds every marinade's weight to
 * its meat before dividing by the meat's kg-per-tray, including marinades
 * held back until cooking ("weight still counts toward tray capacity").
 *
 * Four sources, in the order the station has always read them:
 *   1. recipe ingredient rows flagged marinade_for_ingredient_id
 *   2. recipe sub-recipe rows flagged marinade_for_ingredient_id (rubs)
 *   3. marinade-flagged components INSIDE a sub-recipe the recipe uses
 *      (the slow-cook beef sub-recipe pattern, migration 0111) — both
 *      ingredient components and nested sub-recipe components
 *   4. the legacy recipe_meat_marinades table (grams per kg of raw meat),
 *      only when none of the above exist
 * Only marinades whose target ingredient is category raw_meat are returned.
 */
import {
  db,
  recipeIngredientsTable,
  ingredientsTable,
  recipeSubRecipesTable,
  subRecipesTable,
  subRecipeIngredientsTable,
  subRecipeSubRecipesTable,
  recipeMeatMarinadesTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { subMarinadeTotalGrams, subMarinadeExactGrams } from "./sub-recipe-marinades";

export interface RawMeatMarinade {
  rawMeatIngredientId: number;
  marinadeIngredientId: number | null;
  marinadeIngredientName: string | null;
  marinadeSubRecipeId: number | null;
  marinadeSubRecipeName: string | null;
  /** Whole grams across the run — what the station displays. */
  totalGrams: number;
  /** Unrounded grams across the run — for per-batch maths (tray limits). */
  exactGrams: number;
  // True = held back from prep day; the mixing/cooking station adds it
  // on production day. Weight still counts toward tray capacity.
  addAtCooking: boolean;
}

export async function loadRawMeatMarinades(input: {
  recipeId: number;
  portionsPerBatch: number;
  batchesTarget: number;
  /** Raw meat kg used by the legacy grams-per-kg table (source 4). The
   *  station passes its own figure so its output is unchanged. */
  legacyRawMeatKgFor: (rawMeatIngredientId: number) => number;
}): Promise<RawMeatMarinade[]> {
  const { recipeId, portionsPerBatch, batchesTarget, legacyRawMeatKgFor } = input;
  const marinades: RawMeatMarinade[] = [];

  const marinadeTargetAlias = alias(ingredientsTable, "marinadeTarget");
  const marinadeIngRows = await db
    .select({
      ingredientId: recipeIngredientsTable.ingredientId,
      ingredientName: ingredientsTable.name,
      quantity: recipeIngredientsTable.quantity,
      unit: ingredientsTable.unit,
      marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
      marinadeAddAtCooking: recipeIngredientsTable.marinadeAddAtCooking,
      targetCategory: marinadeTargetAlias.category,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .leftJoin(marinadeTargetAlias, eq(recipeIngredientsTable.marinadeForIngredientId, marinadeTargetAlias.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));

  for (const mr of marinadeIngRows) {
    if (!mr.marinadeForIngredientId) continue;
    if (mr.targetCategory !== "raw_meat") continue;
    const totalQty = Number(mr.quantity) * portionsPerBatch * batchesTarget;
    const exactGrams = mr.unit === "kg" ? totalQty * 1000 : totalQty;
    const totalGrams = Math.round(exactGrams);
    marinades.push({
      rawMeatIngredientId: mr.marinadeForIngredientId,
      marinadeIngredientId: mr.ingredientId,
      marinadeIngredientName: mr.ingredientName ?? null,
      marinadeSubRecipeId: null,
      marinadeSubRecipeName: null,
      totalGrams,
      exactGrams,
      addAtCooking: mr.marinadeAddAtCooking ?? false,
    });
  }

  const marinadeSubTargetAlias = alias(ingredientsTable, "marinadeSubTarget");
  const marinadeSubRows = await db
    .select({
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      subRecipeName: subRecipesTable.name,
      quantity: recipeSubRecipesTable.quantity,
      marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
      marinadeAddAtCooking: recipeSubRecipesTable.marinadeAddAtCooking,
      targetCategory: marinadeSubTargetAlias.category,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .leftJoin(marinadeSubTargetAlias, eq(recipeSubRecipesTable.marinadeForIngredientId, marinadeSubTargetAlias.id))
    .where(eq(recipeSubRecipesTable.recipeId, recipeId));

  for (const sr of marinadeSubRows) {
    if (!sr.marinadeForIngredientId) continue;
    if (sr.targetCategory !== "raw_meat") continue;
    const totalQty = Number(sr.quantity) * portionsPerBatch * batchesTarget;
    const exactGrams = totalQty * 1000;
    const totalGrams = Math.round(exactGrams);
    marinades.push({
      rawMeatIngredientId: sr.marinadeForIngredientId,
      marinadeIngredientId: null,
      marinadeIngredientName: null,
      marinadeSubRecipeId: sr.subRecipeId,
      marinadeSubRecipeName: sr.subRecipeName ?? null,
      totalGrams,
      exactGrams,
      addAtCooking: sr.marinadeAddAtCooking ?? false,
    });
  }

  // Marinades living INSIDE a sub-recipe this recipe uses (the Philly
  // slow-cook beef pattern, migration 0111): the sub's marinade-flagged
  // ingredient components and nested sub-recipes (rubs) group under
  // their raw meat exactly like recipe-level rows, scaled by the
  // recipe's usage of the sub over its yield.
  {
    const marinadeInnerTarget = alias(ingredientsTable, "marinadeInnerTarget");
    const usedSubs = await db
      .select({
        subRecipeId: recipeSubRecipesTable.subRecipeId,
        quantity: recipeSubRecipesTable.quantity,
        subYield: subRecipesTable.yield,
      })
      .from(recipeSubRecipesTable)
      .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
      .where(and(
        eq(recipeSubRecipesTable.recipeId, recipeId),
        isNull(recipeSubRecipesTable.marinadeForIngredientId),
      ));

    for (const us of usedSubs) {
      if (us.subRecipeId == null) continue;
      const subYield = Number(us.subYield) || 0;
      if (subYield <= 0) continue;
      const scale = {
        subUsagePerPortion: Number(us.quantity) || 0,
        subYield,
        portionsPerBatch,
        batchesTarget,
      };

      const innerIngRows = await db
        .select({
          ingredientId: subRecipeIngredientsTable.ingredientId,
          ingredientName: ingredientsTable.name,
          quantity: subRecipeIngredientsTable.quantity,
          unit: ingredientsTable.unit,
          marinadeForIngredientId: subRecipeIngredientsTable.marinadeForIngredientId,
          marinadeAddAtCooking: subRecipeIngredientsTable.marinadeAddAtCooking,
          targetCategory: marinadeInnerTarget.category,
        })
        .from(subRecipeIngredientsTable)
        .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
        .leftJoin(marinadeInnerTarget, eq(subRecipeIngredientsTable.marinadeForIngredientId, marinadeInnerTarget.id))
        .where(eq(subRecipeIngredientsTable.subRecipeId, us.subRecipeId));

      for (const mr of innerIngRows) {
        if (!mr.marinadeForIngredientId) continue;
        if (mr.targetCategory !== "raw_meat") continue;
        marinades.push({
          rawMeatIngredientId: mr.marinadeForIngredientId,
          marinadeIngredientId: mr.ingredientId,
          marinadeIngredientName: mr.ingredientName ?? null,
          marinadeSubRecipeId: null,
          marinadeSubRecipeName: null,
          totalGrams: subMarinadeTotalGrams({ ...scale, componentQty: Number(mr.quantity) || 0, unit: mr.unit }),
          exactGrams: subMarinadeExactGrams({ ...scale, componentQty: Number(mr.quantity) || 0, unit: mr.unit }),
          addAtCooking: mr.marinadeAddAtCooking ?? false,
        });
      }

      const innerSubTarget = alias(ingredientsTable, "marinadeInnerSubTarget");
      const innerSubAlias = alias(subRecipesTable, "marinadeInnerSub");
      const innerSubRows = await db
        .select({
          componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
          componentName: innerSubAlias.name,
          componentYieldUnit: innerSubAlias.yieldUnit,
          quantity: subRecipeSubRecipesTable.quantity,
          marinadeForIngredientId: subRecipeSubRecipesTable.marinadeForIngredientId,
          marinadeAddAtCooking: subRecipeSubRecipesTable.marinadeAddAtCooking,
          targetCategory: innerSubTarget.category,
        })
        .from(subRecipeSubRecipesTable)
        .leftJoin(innerSubAlias, eq(subRecipeSubRecipesTable.componentSubRecipeId, innerSubAlias.id))
        .leftJoin(innerSubTarget, eq(subRecipeSubRecipesTable.marinadeForIngredientId, innerSubTarget.id))
        .where(eq(subRecipeSubRecipesTable.subRecipeId, us.subRecipeId));

      for (const mr of innerSubRows) {
        if (!mr.marinadeForIngredientId) continue;
        if (mr.targetCategory !== "raw_meat") continue;
        marinades.push({
          rawMeatIngredientId: mr.marinadeForIngredientId,
          marinadeIngredientId: null,
          marinadeIngredientName: null,
          marinadeSubRecipeId: mr.componentSubRecipeId,
          marinadeSubRecipeName: mr.componentName ?? null,
          totalGrams: subMarinadeTotalGrams({ ...scale, componentQty: Number(mr.quantity) || 0, unit: mr.componentYieldUnit }),
          exactGrams: subMarinadeExactGrams({ ...scale, componentQty: Number(mr.quantity) || 0, unit: mr.componentYieldUnit }),
          addAtCooking: mr.marinadeAddAtCooking ?? false,
        });
      }
    }
  }

  if (marinades.length === 0) {
    const oldMarinadeIngAlias = alias(ingredientsTable, "marinadeIng");
    const oldMarinadeSubAlias = alias(subRecipesTable, "marinadeSub");
    const oldRawMeatAlias = alias(ingredientsTable, "oldRawMeat");
    const oldMarinadeRows = await db
      .select({
        rawMeatIngredientId: recipeMeatMarinadesTable.rawMeatIngredientId,
        marinadeIngredientId: recipeMeatMarinadesTable.marinadeIngredientId,
        marinadeIngredientName: oldMarinadeIngAlias.name,
        marinadeSubRecipeId: recipeMeatMarinadesTable.marinadeSubRecipeId,
        marinadeSubRecipeName: oldMarinadeSubAlias.name,
        gramsPerKg: recipeMeatMarinadesTable.gramsPerKg,
        rawMeatCategory: oldRawMeatAlias.category,
      })
      .from(recipeMeatMarinadesTable)
      .leftJoin(oldMarinadeIngAlias, eq(recipeMeatMarinadesTable.marinadeIngredientId, oldMarinadeIngAlias.id))
      .leftJoin(oldMarinadeSubAlias, eq(recipeMeatMarinadesTable.marinadeSubRecipeId, oldMarinadeSubAlias.id))
      .leftJoin(oldRawMeatAlias, eq(recipeMeatMarinadesTable.rawMeatIngredientId, oldRawMeatAlias.id))
      .where(eq(recipeMeatMarinadesTable.recipeId, recipeId));

    for (const mr of oldMarinadeRows) {
      if (mr.rawMeatCategory !== "raw_meat") continue;
      const rawMeatKg = legacyRawMeatKgFor(mr.rawMeatIngredientId);
      const gpkg = Number(mr.gramsPerKg);
      const exactGrams = rawMeatKg * gpkg;
      const totalGrams = Math.round(exactGrams);
      marinades.push({
        rawMeatIngredientId: mr.rawMeatIngredientId,
        marinadeIngredientId: mr.marinadeIngredientId ?? null,
        marinadeIngredientName: mr.marinadeIngredientName ?? null,
        marinadeSubRecipeId: mr.marinadeSubRecipeId ?? null,
        marinadeSubRecipeName: mr.marinadeSubRecipeName ?? null,
        totalGrams,
        exactGrams,
        addAtCooking: false,
      });
    }
  }

  return marinades;
}
