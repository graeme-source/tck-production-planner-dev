/**
 * Database side of "stock at the start of the plan date".
 *
 * The maths lives in @workspace/stock-prediction (pure, tested). These
 * loaders fetch its inputs the same way for every product category, so the
 * calzone Factory Number and the macaroni cheese stock read identical plan
 * data: today's production still to be wrapped, and the packs planned on the
 * working days between today and the plan date.
 */

import { db, productionPlansTable, productionPlanItemsTable, recipesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { plannedProductionPacks, remainingWrappingPacks } from "@workspace/stock-prediction";

/** Plan statuses whose production is still going to happen (or is happening). */
const PLANNED_PRODUCTION_STATUSES = ["draft", "active", "prep", "building", "complete"];
/** Plan statuses whose wrapping can still be in progress today. */
const WRAPPING_IN_PROGRESS_STATUSES = ["active", "prep", "building"];

/**
 * recipeId → packs of `today`'s production not yet in the fridge.
 * @param recipeIds  Limit to these recipes; omit for every recipe.
 */
export async function loadStillToWrapToday(today: string, recipeIds?: number[]): Promise<Record<number, number>> {
  if (recipeIds && recipeIds.length === 0) return {};
  const rows = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      fridgeQty: productionPlanItemsTable.fridgeQty,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
      eightPackBagCount: productionPlanItemsTable.eightPackBagCount,
      freezerQty: productionPlanItemsTable.freezerQty,
      wonlyCount: productionPlanItemsTable.wonlyCount,
      wrappingComplete: productionPlanItemsTable.wrappingComplete,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      eq(productionPlansTable.planDate, today),
      inArray(productionPlansTable.status, WRAPPING_IN_PROGRESS_STATUSES),
      recipeIds ? inArray(productionPlanItemsTable.recipeId, recipeIds) : undefined,
    ));

  const byRecipe: Record<number, number> = {};
  for (const row of rows) {
    if (row.recipeId == null) continue;
    byRecipe[row.recipeId] = (byRecipe[row.recipeId] ?? 0) + remainingWrappingPacks(row);
  }
  return byRecipe;
}

/**
 * date → recipeId → packs planned for production on that date. A date with
 * no plan yet is simply absent (0 packs) — the screen says so.
 */
export async function loadPlannedProductionByDate(
  dates: string[],
  recipeIds?: number[],
): Promise<Record<string, Record<number, number>>> {
  const out: Record<string, Record<number, number>> = {};
  if (dates.length === 0 || (recipeIds && recipeIds.length === 0)) return out;
  const rows = await db
    .select({
      planDate: productionPlansTable.planDate,
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      inArray(productionPlansTable.planDate, dates),
      inArray(productionPlansTable.status, PLANNED_PRODUCTION_STATUSES),
      recipeIds ? inArray(productionPlanItemsTable.recipeId, recipeIds) : undefined,
    ));

  for (const row of rows) {
    if (row.recipeId == null) continue;
    const byRecipe = (out[row.planDate] ??= {});
    byRecipe[row.recipeId] = (byRecipe[row.recipeId] ?? 0) + plannedProductionPacks(row);
  }
  return out;
}
