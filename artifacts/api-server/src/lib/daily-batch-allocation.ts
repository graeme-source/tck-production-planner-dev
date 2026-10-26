/**
 * How /production-plans/calculate shares a day's batch capacity between
 * recipes (moved out of routes/production-plans.ts on 2026-10-05; the maths
 * is unchanged apart from the main-kitchen rule). Pure.
 *
 * Target-stock allocation (Graeme, 2026-08-06): the plan should RESULT in
 * end-of-horizon factory numbers split by the DPT percentages. Batch counts
 * are whatever closes each flavour's gap to its target — a flavour with a
 * massive deficit gets heavily produced; one sitting above its share gets
 * nothing until sales pull it back down (stock can't be unmade).
 *
 * Mechanics: find the level λ (end-stock packs per weight point) whose
 * per-recipe targets λ·weight are exactly affordable with the day's
 * capacity, i.e. Σ gap-batches = totalDailyBatches. Overstocked flavours
 * contribute no gap; everyone else lands ON the DPT split around them.
 * Weight 0 (retiring specials with DPT 0) means target 0 — the gap formula
 * still produces up to zero stock when real orders drove it negative, so
 * genuine demand is honoured without ever building surplus.
 *
 * Whole batches (15 Oct 2026): each recipe's orders + safety margin is a
 * floor in WHOLE batches (floorBatches). Before, a recipe with no DPT weight
 * got its shortfall as a fraction (32 packs ÷ 5 = 6.4) and the rounding gave
 * the .4 away — Properoni Chicken & Chorizo was planned 2 packs short.
 *
 * Main kitchen only (kitchen-scope rule): fried chicken rides along in the
 * calculation for its pack-table stock, but it is made in a separate
 * facility, so it never takes a share of the day's batches or counts towards
 * the day's deficit. Before this it was handed batches for its open orders —
 * 42 of a 100-batch day on 7 Oct 2026.
 */
import { isMainKitchen } from "@workspace/production-schedule";
import { solveTargetAllocation, largestRemainderRound, minBatchesForOrders, type PlanMarginSettings } from "@workspace/plan-margin";

// Kept as a re-export: older callers and tests import it from here.
export { largestRemainderRound };

export interface AllocationRecipe {
  category: string | null;
  /** DPT % (or live sales % when no DPT is configured). */
  weight: number;
  /** Packs per batch (> 0). */
  ppb: number;
  /** Projected end-of-horizon packs with NO production (can be negative). */
  proj: number;
  deficitBatches: number;
  /** Fewest whole batches this recipe must get — orders + safety margin
   *  (@workspace/plan-margin minBatchesForOrders, 15 Oct 2026). Defaults to
   *  deficitBatches, so a shortfall is always covered in WHOLE batches. */
  floorBatches?: number;
  /** A scheduled DPT rule's "orders + N batches" (lib/dpt-schedules.ts). */
  extraBatchesCap?: number | null;
}

export interface DailyAllocation {
  suggestedBatches: number[];
  /** This recipe's DPT share of the achievable end-stock pool; null when
   *  capacity can't cover shortfalls or the recipe has no share. */
  targetStockPacks: Array<number | null>;
  totalDeficitBatches: number;
  remainingCapacity: number;
}

/** Fewest whole batches a /calculate row needs: the orders this plan covers
 *  (dispatch 2 + 3 — the same figures the Create Plan table shows) plus the
 *  safety margin, net of the stock at plan start less 8-pack bag packs. Used
 *  as the allocation floor and as the chilled / test-product suggestion. */
export function orderFloorBatches(
  r: { dispatch2Qty: number; dispatch3Qty: number; estimatedFactoryNumber: number; bagPackEquivalents?: number; packsPerBatch: number },
  margin: PlanMarginSettings,
): number {
  return minBatchesForOrders({
    demandPacks: r.dispatch2Qty + r.dispatch3Qty,
    stockPacks: r.estimatedFactoryNumber - (r.bagPackEquivalents ?? 0),
    packsPerBatch: r.packsPerBatch,
  }, margin).batches;
}

/** The solver itself is @workspace/plan-margin (shared with the Create and
 *  Edit Plan screens, so the two can never disagree). This wrapper adds the
 *  main-kitchen rule and the deficit totals the response reports. */
export function allocateDailyBatches(recipes: readonly AllocationRecipe[], totalDailyBatches: number): DailyAllocation {
  const inKitchen = recipes.map(r => isMainKitchen(r.category));
  const totalDeficitBatches = recipes.reduce((s, r, i) => s + (inKitchen[i] ? r.deficitBatches : 0), 0);
  const remainingCapacity = Math.max(0, totalDailyBatches - totalDeficitBatches);
  const solved = solveTargetAllocation(recipes.map((r, i) => ({
    weight: r.weight,
    ppb: r.ppb,
    proj: r.proj,
    floorBatches: r.floorBatches ?? r.deficitBatches,
    eligible: inKitchen[i],
    extraBatchesCap: r.extraBatchesCap ?? null,
  })), totalDailyBatches);
  return {
    suggestedBatches: solved.batches,
    targetStockPacks: solved.targets,
    totalDeficitBatches,
    remainingCapacity,
  };
}
