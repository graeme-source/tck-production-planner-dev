/**
 * How many bags of each fried chicken variant to make.
 *
 * The driver is kilos of RAW CHICKEN (the way calzones are driven by batches).
 * Everything else follows from the recipes: raw meat becomes strips at the
 * sub-recipe's own conversion, and each variant spends a known weight of
 * strips per bag.
 *
 * The split between variants is a DPT share expressed in PACKS, not weight.
 * That distinction is the whole point (Graeme, 2026-09-03). A 1.2 kg bag
 * weighs three times a 500 g bag but is still one sale, so sharing out by
 * weight credits the big bags three times over and quietly over-stocks them.
 * Measured against real sales it showed: 28 days of cover on 1 kg buttermilk
 * and 26 on 1.2 kg korean, while korean 500 g had under two days left.
 *
 * The target is the stock AFTER this production, not the production itself.
 * Anything short gets topped up; anything already ahead gets nothing. There
 * is no minimum — one bag of 1.2 kg is a perfectly good answer, it goes in
 * the same crate either way.
 */

export interface VariantAllocationInput {
  /** Stable identity — recipe id in practice. */
  key: string;
  /** Target share of stock, in packs. Shares are normalised, so they need
   *  not sum to exactly 1. */
  dptShare: number;
  /** What one bag of this variant costs out of the run's budget, in kg.
   *  Resolved from the recipe — raw chicken per pack — so nothing here has
   *  to know about strips. The old sheet counted strips; the recipes already
   *  hold the weights, so we don't need to (Graeme, 2026-09-03). */
  kgPerPack: number;
  /** What Shopify says is on the shelf right now. */
  stockPacks: number;
}

export interface VariantAllocation {
  key: string;
  /** Bags to make. */
  packs: number;
  /** What those bags cost out of the budget, kg. */
  kg: number;
  /** Where this variant's stock lands once they're made. */
  stockAfter: number;
}

export interface AllocationResult {
  variants: VariantAllocation[];
  totalPacks: number;
  /** Actually spent — at or just under the budget. */
  kgUsed: number;
  /** Left unspent because every variant reached its target. A signal the
   *  run is bigger than the shelf needs. */
  kgSpare: number;
}

/** Shortfall against a hypothetical post-production total of `totalStock`. */
function shortfalls(
  variants: readonly VariantAllocationInput[],
  shareOf: (v: VariantAllocationInput) => number,
  totalStock: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of variants) {
    out.set(v.key, Math.max(0, shareOf(v) * totalStock - v.stockPacks));
  }
  return out;
}

export function allocateFriedChickenPacks(
  variants: readonly VariantAllocationInput[],
  availableKg: number,
): AllocationResult {
  const usable = variants.filter(v => v.kgPerPack > 0 && v.dptShare > 0);
  if (usable.length === 0 || !(availableKg > 0)) {
    return {
      variants: variants.map(v => ({ key: v.key, packs: 0, kg: 0, stockAfter: v.stockPacks })),
      totalPacks: 0,
      kgUsed: 0,
      kgSpare: Math.max(0, availableKg),
    };
  }

  const shareTotal = usable.reduce((n, v) => n + v.dptShare, 0);
  const shareOf = (v: VariantAllocationInput) => v.dptShare / shareTotal;
  const stockNow = usable.reduce((n, v) => n + v.stockPacks, 0);

  const spend = (totalStock: number) => {
    const short = shortfalls(usable, shareOf, totalStock);
    return usable.reduce((kg, v) => kg + (short.get(v.key) ?? 0) * v.kgPerPack, 0);
  };

  // Raise the post-production total until the top-ups exactly consume the
  // strips available. Monotonic in totalStock, so a bisection is safe.
  //
  // The low end has to be ZERO, not today's stock. It is tempting to start
  // at stockNow on the grounds that "no production" spends nothing — but
  // that is only true when stock already sits at the target proportions.
  // With stock out of balance there are shortfalls at stockNow already, so
  // starting there puts the answer outside the bracket and the bisection
  // returns a total far too large: an early version happily spent 280 kg of
  // a 62 kg run.
  let lo = 0;
  let hi = Math.max(1, stockNow + 1);
  while (spend(hi) < availableKg && hi < stockNow + 1e7) hi *= 2;
  const capped = spend(hi) < availableKg;   // every variant satisfied
  for (let i = 0; i < 200 && !capped; i++) {
    const mid = (lo + hi) / 2;
    if (spend(mid) < availableKg) lo = mid; else hi = mid;
  }

  const raw = shortfalls(usable, shareOf, capped ? hi : lo);

  // Whole bags only. Round down first so we can never overspend, then hand
  // out what's left to whoever lost the most in the rounding and can still
  // afford a bag.
  const packs = new Map<string, number>();
  let used = 0;
  for (const v of usable) {
    const n = Math.floor(raw.get(v.key) ?? 0);
    packs.set(v.key, n);
    used += n * v.kgPerPack;
  }
  const byRemainder = [...usable].sort((a, b) =>
    ((raw.get(b.key) ?? 0) % 1) - ((raw.get(a.key) ?? 0) % 1));
  let progress = true;
  while (progress) {
    progress = false;
    for (const v of byRemainder) {
      const wanted = raw.get(v.key) ?? 0;
      if ((packs.get(v.key) ?? 0) >= Math.ceil(wanted)) continue;
      if (used + v.kgPerPack > availableKg + 1e-9) continue;
      packs.set(v.key, (packs.get(v.key) ?? 0) + 1);
      used += v.kgPerPack;
      progress = true;
    }
  }

  const out: VariantAllocation[] = variants.map(v => {
    const n = packs.get(v.key) ?? 0;
    return { key: v.key, packs: n, kg: n * v.kgPerPack, stockAfter: v.stockPacks + n };
  });

  return {
    variants: out,
    totalPacks: out.reduce((n, v) => n + v.packs, 0),
    kgUsed: Math.round(used * 1000) / 1000,
    kgSpare: Math.round(Math.max(0, availableKg - used) * 1000) / 1000,
  };
}

/** DPT shares straight from trailing sales. Used to seed the settings so
 *  nobody has to invent percentages; they stay editable afterwards. */
export function dptSharesFromSales(sales: Readonly<Record<string, number>>): Record<string, number> {
  const total = Object.values(sales).reduce((n, v) => n + Math.max(0, v), 0);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sales)) out[k] = total > 0 ? Math.max(0, v) / total : 0;
  return out;
}
