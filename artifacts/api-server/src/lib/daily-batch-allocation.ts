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
 * Main kitchen only (kitchen-scope rule): fried chicken rides along in the
 * calculation for its pack-table stock, but it is made in a separate
 * facility, so it never takes a share of the day's batches or counts towards
 * the day's deficit. Before this it was handed batches for its open orders —
 * 42 of a 100-batch day on 7 Oct 2026.
 */
import { isMainKitchen } from "@workspace/production-schedule";

export interface AllocationRecipe {
  category: string | null;
  /** DPT % (or live sales % when no DPT is configured). */
  weight: number;
  /** Packs per batch (> 0). */
  ppb: number;
  /** Projected end-of-horizon packs with NO production (can be negative). */
  proj: number;
  deficitBatches: number;
}

export interface DailyAllocation {
  suggestedBatches: number[];
  /** This recipe's DPT share of the achievable end-stock pool; null when
   *  capacity can't cover shortfalls or the recipe has no share. */
  targetStockPacks: Array<number | null>;
  totalDeficitBatches: number;
  remainingCapacity: number;
}

/** Round fractional allocations to integers that sum to `total`: floor each,
 *  then hand the leftover units to the largest remainders. */
export function largestRemainderRound(exact: number[], total: number): number[] {
  const floors = exact.map(e => Math.floor(e));
  let leftover = total - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, idx) => ({ idx, remainder: e - Math.floor(e) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { idx } of order) {
    if (leftover <= 0) break;
    floors[idx] += 1;
    leftover--;
  }
  return floors;
}

export function allocateDailyBatches(recipes: readonly AllocationRecipe[], totalDailyBatches: number): DailyAllocation {
  const inKitchen = recipes.map(r => isMainKitchen(r.category));
  const totalDeficitBatches = recipes.reduce((s, r, i) => s + (inKitchen[i] ? r.deficitBatches : 0), 0);
  const remainingCapacity = Math.max(0, totalDailyBatches - totalDeficitBatches);

  // A separate-facility row has no weight and no gap, so it gets nothing.
  const pool = recipes.map((r, i) => inKitchen[i]
    ? { weight: r.weight, ppb: r.ppb > 0 ? r.ppb : 1, proj: r.proj }
    : { weight: 0, ppb: 1, proj: 0 });
  // Rounding hands leftover units to main-kitchen rows only — a tie at zero
  // must never give a separate-facility row a batch.
  const round = (exact: number[]): number[] => {
    const idx = exact.map((_, i) => i).filter(i => inKitchen[i]);
    const rounded = largestRemainderRound(idx.map(i => exact[i]), totalDailyBatches);
    const out = exact.map(() => 0);
    idx.forEach((i, k) => { out[i] = rounded[k]; });
    return out;
  };
  // Batches needed to lift every under-target recipe to its λ-target.
  const needBatches = (lambda: number) =>
    pool.reduce((s, p) => s + Math.max(0, lambda * p.weight - p.proj) / p.ppb, 0);

  const floorNeed = needBatches(0); // just covering shortfalls to zero stock
  if (floorNeed >= totalDailyBatches) {
    // Capacity can't even cover the shortfalls — scale each gap pro-rata.
    const gaps = pool.map(p => Math.max(0, -p.proj) / p.ppb);
    const scale = floorNeed > 0 ? totalDailyBatches / floorNeed : 0;
    return {
      suggestedBatches: round(gaps.map(g => g * scale)),
      targetStockPacks: pool.map(() => null),
      totalDeficitBatches,
      remainingCapacity,
    };
  }
  // Bisect λ until the targets exactly spend the day's capacity.
  let lo = 0, hi = 1;
  while (needBatches(hi) < totalDailyBatches && hi < 1e9) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (needBatches(mid) < totalDailyBatches) lo = mid; else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  const exact = pool.map(p => Math.max(0, lambda * p.weight - p.proj) / p.ppb);
  return {
    suggestedBatches: round(exact),
    targetStockPacks: pool.map(p => p.weight > 0 ? Math.round(lambda * p.weight) : null),
    totalDeficitBatches,
    remainingCapacity,
  };
}
