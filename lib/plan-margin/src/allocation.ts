/**
 * Target-stock batch allocation — the ONE copy of the solver behind the
 * Create Plan suggestion, shared by the API (/production-plans/calculate,
 * lib/daily-batch-allocation.ts) and the Create / Edit Plan screens, which
 * used to carry a hand-mirrored copy each.
 *
 * Target-stock allocation (Graeme, 2026-08-06): the plan should RESULT in
 * end-of-horizon factory numbers split by the DPT percentages. Find the level
 * λ (end-stock packs per weight point) whose per-recipe targets λ·weight
 * exactly spend the day's capacity; each recipe then makes whatever closes
 * its gap to target. Overstocked flavours contribute no gap.
 *
 * Whole-batch floors (Graeme, 15 Oct 2026): every row also carries
 * `floorBatches` — the fewest WHOLE batches that cover its orders plus the
 * safety margin (minBatchesForOrders). The allocation never goes below it.
 * Before this, a row with no DPT weight (a test product) got its shortfall as
 * a FRACTION of a batch — 32 packs ÷ 5 = 6.4 — and the rounding that makes
 * the day's batches add up handed the 0.4 to a core recipe with a bigger
 * remainder: Properoni Chicken & Chorizo was planned at 6 batches (30 packs)
 * for 32 packs of orders on 14 Oct 2026.
 *
 * When the floors alone exceed the day's capacity, they are scaled pro-rata
 * to fit (capacity is a hard limit); the plan's margin warnings then name
 * every recipe left short, so it is never silent.
 */

export interface AllocationPoolRow {
  /** Surplus weight (DPT % or live sales %). 0 = make orders only, no surplus. */
  weight: number;
  /** Packs per batch (> 0). */
  ppb: number;
  /** Projected end-of-horizon packs with NO production (can be negative). */
  proj: number;
  /** Fewest whole batches this row must get (orders + margin). */
  floorBatches: number;
  /** false = takes no batches at all (e.g. made in another kitchen). Default true. */
  eligible?: boolean;
  /** At most this many batches ABOVE the floor (orders + margin) — a
   *  scheduled DPT rule such as "leaving the one-time menu: orders + 2
   *  batches a day" (Graeme, 2026-10-26). Real orders are always made; the
   *  capacity it doesn't take goes to the other recipes. null = no cap. */
  extraBatchesCap?: number | null;
}

export interface TargetAllocation {
  /** Whole batches per row; eligible rows sum to the capacity unless there is
   *  no surplus weight to spread (then the floors alone). */
  batches: number[];
  /** λ·weight per row — the end-stock the row is steered to; null when the
   *  floors fill the day or the row has no weight. */
  targets: Array<number | null>;
  /** True when the floors (orders + margin) needed more than the capacity. */
  floorsExceedCapacity: boolean;
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

/** Rounding can hand a capped row one batch over its cap; give that batch to
 *  the uncapped row with the most batches instead. */
function capRounding(batches: number[], pool: ReadonlyArray<{ floor: number; cap: number }>): number[] {
  const out = [...batches];
  for (let i = 0; i < out.length; i++) {
    const max = pool[i].floor + pool[i].cap;
    while (out[i] > max) {
      let j = -1;
      for (let k = 0; k < out.length; k++) if (pool[k].cap === Infinity && (j < 0 || out[k] > out[j])) j = k;
      if (j < 0) break;
      out[i]--; out[j]++;
    }
  }
  return out;
}

export function solveTargetAllocation(rows: readonly AllocationPoolRow[], capacity: number): TargetAllocation {
  const n = rows.length;
  const zeros = (): TargetAllocation => ({ batches: rows.map(() => 0), targets: rows.map(() => null), floorsExceedCapacity: false });
  if (!(capacity > 0) || n === 0) return zeros();

  const eligible = rows.map(r => r.eligible !== false);
  const pool = rows.map((r, i) => eligible[i]
    ? {
      weight: Math.max(0, r.weight || 0), ppb: r.ppb > 0 ? r.ppb : 1, proj: r.proj || 0, floor: Math.max(0, Math.floor(r.floorBatches || 0)),
      cap: r.extraBatchesCap == null || !Number.isFinite(r.extraBatchesCap) ? Infinity : Math.max(0, Math.floor(r.extraBatchesCap)),
    }
    : { weight: 0, ppb: 1, proj: 0, floor: 0, cap: 0 });
  const idx = pool.map((_, i) => i).filter(i => eligible[i]);
  // Rounding only ever hands units to eligible rows.
  const round = (exact: number[], total: number): number[] => {
    const rounded = largestRemainderRound(idx.map(i => exact[i]), total);
    const out = rows.map(() => 0);
    idx.forEach((i, k) => { out[i] = rounded[k]; });
    return out;
  };

  const floorTotal = pool.reduce((s, p) => s + p.floor, 0);
  if (floorTotal >= capacity) {
    const scale = capacity / floorTotal;
    return {
      batches: floorTotal === capacity ? pool.map(p => p.floor) : round(pool.map(p => p.floor * scale), capacity),
      targets: rows.map(() => null),
      floorsExceedCapacity: floorTotal > capacity,
    };
  }

  const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) {
    // Nothing to spread surplus by — make the orders + margin, no more.
    return { batches: pool.map(p => p.floor), targets: rows.map(() => null), floorsExceedCapacity: false };
  }

  // A capped row stops at floor + cap however high the level goes.
  const exactAt = (lambda: number) => pool.map(p => Math.min(p.floor + p.cap, Math.max(p.floor, Math.max(0, lambda * p.weight - p.proj) / p.ppb)));
  const need = (lambda: number) => exactAt(lambda).reduce((s, e) => s + e, 0);
  // Every row capped and the caps can't use the day: make what the caps
  // allow, don't force the rest onto capped rows.
  const most = need(1e12);
  if (most < capacity) {
    const e = exactAt(1e12);
    return { batches: round(e, Math.round(most)), targets: rows.map(() => null), floorsExceedCapacity: false };
  }
  let lo = 0, hi = 1;
  while (need(hi) < capacity && hi < 1e12) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) < capacity) lo = mid; else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  return {
    batches: capRounding(round(exactAt(lambda), capacity), pool),
    targets: pool.map(p => p.weight > 0 ? Math.round(lambda * p.weight) : null),
    floorsExceedCapacity: false,
  };
}
