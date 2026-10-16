/**
 * Plan rows → the factory-number forecast (Graeme, 15 Oct 2026). Objective C.
 *
 * Uses the SAME figures the Create / Edit Plan table shows for each recipe:
 * stock at the start of the plan day (estimatedFactoryNumber), the batches
 * box, 8-pack bags, and the plan day's own despatch (the D2 column). The
 * floor each recommendation respects is the safety margin's own rule
 * (@workspace/plan-margin minBatchesForOrders on D2 + D3), so the upper
 * limit can never undo the lower one. Calzone line only — mac cheese and
 * fried chicken are kept out (kitchenLine).
 */
import { minBatchesForOrders, type PlanMarginSettings } from "@workspace/plan-margin";
import { kitchenLine } from "@workspace/production-schedule";
import {
  forecastFactoryNumber, recommendBatchChange, needsFreezeConfirmation,
  type FactoryForecast, type FactoryForecastRow, type FactoryRecommendation, type FactoryThresholds, type LateTotal,
  type PullBackAdvice,
} from "@workspace/stock-prediction";

export interface ForecastPlanRow {
  id: string;
  recipeId: number;
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

export interface ForecastContext {
  /** recipeId → category (from the calculate data); unknown → calzone line. */
  categoryOf: (recipeId: number) => string | null | undefined;
  /** recipeId → share of the last 7 days' calzone sales. */
  shares: Record<string | number, number>;
  margin: PlanMarginSettings;
}

const bagPacks = (r: ForecastPlanRow) => (r.eightPackBagCount ?? 0) * (8 / (r.packSize || 2));

export function toForecastRows(rows: readonly ForecastPlanRow[], ctx: ForecastContext): FactoryForecastRow[] {
  return rows
    .filter(r => kitchenLine(ctx.categoryOf(r.recipeId)) === "calzone")
    .map(r => {
      const bags = bagPacks(r);
      const floor = minBatchesForOrders({
        demandPacks: (r.dispatch2Qty || 0) + (r.dispatch3Qty || 0),
        stockPacks: Math.max(0, (r.estimatedFactoryNumber || 0) - bags),
        packsPerBatch: r.packsPerBatch,
      }, ctx.margin).batches;
      return {
        key: r.id,
        recipeName: r.recipeName,
        included: r.included,
        plannedBatches: r.batchesTarget || 0,
        packsPerBatch: r.packsPerBatch,
        startStockPacks: r.estimatedFactoryNumber || 0,
        bagPacks: bags,
        despatchPacks: r.dispatch2Qty || 0,
        salesShare: Number(ctx.shares[r.recipeId] ?? 0) || 0,
        floorBatches: floor,
      };
    });
}

export interface PlanFactoryForecast {
  forecast: FactoryForecast;
  recommendation: FactoryRecommendation | null;
  needsConfirm: boolean;
  /** Average packs per batch across the forecast's planned batches (5 when none). */
  packsPerBatch: number;
}

export interface PlanFactoryOptions {
  /** The day's capacity (whole plan total, all lines). */
  maxTotalBatches?: number;
  /** The fewest batches a day (whole plan total, all lines). */
  minTotalBatches?: number;
  /** Stock building for days → "time to pull back". */
  pullBack?: PullBackAdvice | null;
}

export function planFactoryForecast(
  rows: readonly ForecastPlanRow[],
  ctx: ForecastContext,
  late: LateTotal,
  t: FactoryThresholds,
  opts: PlanFactoryOptions = {},
): PlanFactoryForecast {
  const fr = toForecastRows(rows, ctx);
  const forecast = forecastFactoryNumber(fr, late, t);
  // The plan total counts every included row; the forecast only touches the
  // calzone line, so the limits it works to are net of the other batches.
  const allBatches = rows.reduce((s, r) => s + (r.included ? r.batchesTarget || 0 : 0), 0);
  const forecastBatches = fr.reduce((s, r) => s + (r.included ? r.plannedBatches : 0), 0);
  const outside = allBatches - forecastBatches;
  const madePacks = fr.reduce((s, r) => s + (r.included ? r.plannedBatches * r.packsPerBatch : 0), 0);
  const limits: { maxTotalBatches?: number; minTotalBatches?: number } = {};
  if (opts.maxTotalBatches) limits.maxTotalBatches = Math.max(0, opts.maxTotalBatches - outside);
  if (opts.minTotalBatches) limits.minTotalBatches = Math.max(0, opts.minTotalBatches - outside);
  return {
    forecast,
    recommendation: recommendBatchChange(fr, late, t, { ...limits, pullBack: opts.pullBack ?? null }),
    needsConfirm: needsFreezeConfirmation(forecast, t),
    packsPerBatch: forecastBatches > 0 ? madePacks / forecastBatches : 5,
  };
}

/** Apply a recommendation's batch changes to the plan rows (others untouched). */
export function applyBatchChanges<T extends { id: string; batchesTarget: number }>(rows: readonly T[], rec: FactoryRecommendation): T[] {
  const to = new Map(rec.changes.map(c => [c.key, c.to]));
  return rows.map(r => (to.has(r.id) ? { ...r, batchesTarget: to.get(r.id)! } : r));
}
