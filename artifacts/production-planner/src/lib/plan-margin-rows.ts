/**
 * Plan rows → the safety-margin warning list (Graeme, 15 Oct 2026).
 *
 * Uses the SAME demand the Create / Edit Plan table already shows for each
 * recipe — the D2 + D3 dispatch columns (the orders this plan's production
 * has to cover) — and the same stock the row's "short / low" colouring uses:
 * the estimated factory number at plan start, less packs going out as 8-pack
 * bags. No second demand calculation. A row with no dispatch figures (a
 * manually added recipe, a queued row with no orders in the window) has no
 * known demand and is never warned about.
 */
import { buildMarginWarnings, checkPlanMargin, type MarginCheck, type MarginWarning, type PlanMarginSettings } from "@workspace/plan-margin";

export interface MarginPlanRow {
  id: string;
  recipeName: string;
  included: boolean;
  batchesTarget: number;
  packsPerBatch: number;
  packSize: number;
  eightPackBagCount: number;
  estimatedFactoryNumber: number;
  dispatch2Qty: number;
  dispatch3Qty: number;
}

/** 2-pack stock consumed by 8-pack bags (a bag is 8 portions). */
function bagPacks(r: MarginPlanRow): number {
  return (r.eightPackBagCount ?? 0) * (8 / (r.packSize || 2));
}

function toInput(r: MarginPlanRow) {
  return {
    key: r.id,
    recipeName: r.recipeName,
    included: r.included,
    demandPacks: (r.dispatch2Qty || 0) + (r.dispatch3Qty || 0),
    stockPacks: Math.max(0, (r.estimatedFactoryNumber || 0) - bagPacks(r)),
    packsPerBatch: r.packsPerBatch,
    plannedBatches: r.batchesTarget,
  };
}

export function marginWarningsForRows(rows: readonly MarginPlanRow[], s: PlanMarginSettings): MarginWarning[] {
  return buildMarginWarnings(rows.map(toInput), s);
}

export function marginCheckForRow(row: MarginPlanRow, s: PlanMarginSettings): MarginCheck {
  return checkPlanMargin(toInput(row), s);
}

/** The one-tap fix: add each warned row's missing batches (rows not warned
 *  about are returned untouched). */
export function addMarginBatches<T extends MarginPlanRow>(rows: readonly T[], warnings: readonly MarginWarning[]): T[] {
  const add = new Map(warnings.map(w => [w.key, w.check.batchesToAdd]));
  return rows.map(r => {
    const n = add.get(r.id) ?? 0;
    return n > 0 ? { ...r, batchesTarget: r.batchesTarget + n } : r;
  });
}
