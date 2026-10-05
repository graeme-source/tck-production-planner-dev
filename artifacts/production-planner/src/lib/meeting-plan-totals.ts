/**
 * The morning meeting production table's column totals: calzone batches and
 * packs made. Main kitchen only (shared kitchen-scope rule) — fried chicken
 * rows stay in the table for their stock position, but its bags are made in
 * a separate facility and must not swell the kitchen's totals (2026-10-05).
 * Pure.
 */
import { isMainKitchen } from "@workspace/production-schedule";

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
