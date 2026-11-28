// The figures on a plan's Production Items table — its header line, each
// row's packs / tins / progress, and the Totals row. Moved out of the plan
// detail page unchanged (28 Nov 2026) so the same table can sit on the
// Production Plans week view too and both read the one set of rules.
//
// Units: calzones count in batches, mac cheese in packs (one batch row = one
// pack) and fried chicken in bags. Fried chicken is made in a separate
// facility and is left out of every main-kitchen figure by the shared
// kitchen-scope rule (@workspace/production-schedule).

import { FRIED_CHICKEN_CATEGORY, kitchenLine, mainKitchenItems } from "@workspace/production-schedule";

export interface PlanTableItem {
  recipeId: number;
  recipeCategory?: string | null;
  batchesTarget?: number | null;
  batchesComplete?: number | null;
  portionsPerBatch?: number | null;
  packSize?: number | null;
  eightPackBagCount?: number | null;
  maxBatchesPerTin?: number | null;
}

export interface PlanItemsTotals {
  /** Main kitchen (calzone batches + mac packs) — the Totals row. */
  totalBatchesTarget: number;
  totalBatchesComplete: number;
  calzoneBatchesTarget: number;
  macPacksTarget: number;
  chickenBagsTarget: number;
  chickenBagsComplete: number;
  /** 2-packs planned across calzones and mac cheese (not chicken bags). */
  totalPacks: number;
}

const sum = <T,>(list: readonly T[], f: (t: T) => number) => list.reduce((s, t) => s + f(t), 0);

export function planItemsTotals(items: readonly PlanTableItem[]): PlanItemsTotals {
  const main = mainKitchenItems(items);
  const line = (it: PlanTableItem) => kitchenLine(it.recipeCategory);
  const calzone = items.filter(it => line(it) === "calzone");
  const mac = items.filter(it => line(it) === "mac");
  const chicken = items.filter(it => line(it) === "separate");
  return {
    totalBatchesTarget: sum(main, it => it.batchesTarget ?? 0),
    totalBatchesComplete: sum(main, it => it.batchesComplete ?? 0),
    calzoneBatchesTarget: sum(calzone, it => it.batchesTarget ?? 0),
    macPacksTarget: sum(mac, it => it.batchesTarget ?? 0),
    chickenBagsTarget: sum(chicken, it => it.batchesTarget ?? 0),
    chickenBagsComplete: sum(chicken, it => it.batchesComplete ?? 0),
    totalPacks: sum(items.filter(it => line(it) !== "separate"), itemGrossPacks),
  };
}

/** Fried chicken already on the plan, for the run-planning dialog: re-opening
 *  it edits the run, and what's already fried can't be planned below. */
export function chickenOnPlan(items: readonly PlanTableItem[]): { recipeId: number; packs: number; made: number }[] {
  return items
    .filter(it => it.recipeCategory === FRIED_CHICKEN_CATEGORY)
    .map(it => ({ recipeId: it.recipeId, packs: it.batchesTarget ?? 0, made: it.batchesComplete ?? 0 }));
}

/** 2-packs from a row's batches, before any go into 8-pack bags. */
export function itemGrossPacks(it: PlanTableItem): number {
  return (it.batchesTarget ?? 0) * (it.portionsPerBatch ?? 10) / (it.packSize ?? 2);
}

/** 2-packs left after the row's 8-pack bags — each bag commits 4 two-packs,
 *  so adding a bag visibly drops the Packs figure. */
export function itemNetPacks(it: PlanTableItem): number {
  return Math.max(0, itemGrossPacks(it) - (it.eightPackBagCount ?? 0) * 4);
}

/** Tins for the row: batches ÷ max per tin, rounded up, and never fewer than
 *  two once a row is over five batches. Null when the recipe has no tin rule
 *  or nothing is planned. */
export function itemTinCount(it: PlanTableItem): number | null {
  const b = it.batchesTarget ?? 0;
  if (!it.maxBatchesPerTin || b <= 0) return null;
  const raw = Math.ceil(b / it.maxBatchesPerTin);
  return b > 5 ? Math.max(2, raw) : raw;
}

/** Whole-number % of the row's batches done (0 when none are planned). */
export function itemProgressPct(it: PlanTableItem): number {
  const target = it.batchesTarget ?? 0;
  return target > 0 ? Math.round(((it.batchesComplete ?? 0) / target) * 100) : 0;
}
