/**
 * The production table shared by the morning meeting ("Order of Production")
 * and the Pack Report. Pure.
 *
 * Totals: calzone batches and packs made, main kitchen only (shared
 * kitchen-scope rule) — fried chicken bags are made in a separate facility
 * and must not swell the kitchen's totals (2026-10-05).
 *
 * Rows: the Pack Report lists fried chicken too (its orders go out in the
 * same pack, stocked from the Shopify freezer figure). The morning meeting
 * doesn't — the fried chicken team isn't there, and fried chicken rows were
 * swelling the meeting's stock totals (Graeme, 2026-10-12).
 */
import { isMainKitchen } from "@workspace/production-schedule";

/** The plan items and stock rows the production table shows. With
 *  `mainKitchenOnly` (the morning meeting) both drop the separate facility's
 *  lines, so they're gone from the rows, the stock totals and the oversell
 *  warning alike; otherwise (the Pack Report) everything passes through. */
export function planSlideScope<I extends { recipeCategory: string | null }, C extends { recipeCategory?: string | null }>(
  items: readonly I[],
  calcRecipes: readonly C[],
  mainKitchenOnly: boolean,
): { items: I[]; calcRecipes: C[] } {
  if (!mainKitchenOnly) return { items: [...items], calcRecipes: [...calcRecipes] };
  return {
    items: items.filter(it => isMainKitchen(it.recipeCategory)),
    calcRecipes: calcRecipes.filter(r => isMainKitchen(r.recipeCategory)),
  };
}

export interface PlanSlideTotalsRow {
  category: string | null;
  unit: "batches" | "packs";
  target: number | null;
  packs: number | null;
}

export function planSlideProductionTotals(rows: readonly PlanSlideTotalsRow[]): { calzoneBatches: number; totalPacks: number } {
  let calzoneBatches = 0;
  let totalPacks = 0;
  for (const r of rows) {
    if (!isMainKitchen(r.category)) continue;
    if (r.unit === "batches") calzoneBatches += r.target ?? 0;
    totalPacks += r.packs ?? 0;
  }
  return { calzoneBatches, totalPacks };
}
