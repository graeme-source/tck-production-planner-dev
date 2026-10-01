// Supplier minimum order values (Graeme, 2026-10-01). Objective C.
//
// Some suppliers won't deliver below a minimum spend (AB Fruits: £75). When
// a draft order on the Orders page falls short, the team sometimes moves an
// item they'd normally buy elsewhere (double cream from Brakes) onto that
// supplier's order — dearer per pack, but it gets the order over the line.
//
// Pure logic only: pricing a line at the supplier whose card it sits on, the
// order value against the minimum, and which lines on OTHER cards could be
// moved across to close the gap at the lowest extra cost. Nothing here moves
// anything — the page only moves a line when the person taps the button.

/** Who sells an ingredient and at what pack price (from /api/supplier-pricing). */
export type IngredientPricing = {
  ingredientId: number;
  supplierId: number | null;
  secondarySupplierId: number | null;
  /** Price per pack at the PRIMARY supplier. */
  costPerPack: number;
  /** Price per pack at the SECONDARY supplier; null = not known. */
  secondaryCostPerPack: number | null;
};

/** The bits of an order line the maths needs. */
export type PricedLineInput = {
  ingredientId: number;
  /** Price per pack carried on the line (the primary price from the calc,
   *  or the saved unit price on a reopened order). */
  costPerPack: number;
  /** Packs being ordered. */
  editedPacks: number;
  isMisc?: boolean;
};

export type LinePrice = {
  /** Price per pack at this supplier. */
  price: number;
  /** False when we don't actually know this supplier's price and fell back
   *  to the line's (primary supplier's) price. */
  confirmed: boolean;
};

/** Price per pack for a line on `supplierId`'s order.
 *
 *  - The ingredient's primary supplier → the line's own price (unchanged).
 *  - Its secondary supplier → the saved secondary price; with none saved,
 *    the primary price, flagged not confirmed.
 *  - Any other supplier (dragged there by hand) → the line's price, flagged
 *    not confirmed — we hold no price for that supplier.
 *  - Misc lines / unknown ingredients → the line's price as-is. */
export function priceAtSupplier(
  line: Pick<PricedLineInput, "ingredientId" | "costPerPack" | "isMisc">,
  supplierId: number,
  pricing: IngredientPricing | undefined,
): LinePrice {
  const linePrice = Number.isFinite(line.costPerPack) ? line.costPerPack : 0;
  if (line.isMisc || line.ingredientId <= 0 || !pricing) return { price: linePrice, confirmed: true };
  if (pricing.supplierId === supplierId) return { price: linePrice, confirmed: true };
  if (pricing.secondarySupplierId === supplierId) {
    if (pricing.secondaryCostPerPack != null && Number.isFinite(pricing.secondaryCostPerPack)) {
      return { price: pricing.secondaryCostPerPack, confirmed: true };
    }
    return { price: linePrice > 0 ? linePrice : pricing.costPerPack, confirmed: false };
  }
  return { price: linePrice, confirmed: false };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type OrderValue = {
  value: number;
  /** Ingredient ids on this order whose price at this supplier is a guess. */
  unconfirmedIngredientIds: number[];
};

/** Order value at this supplier = Σ packs × pack price at this supplier. */
export function orderValueAtSupplier(
  lines: PricedLineInput[],
  supplierId: number,
  pricingById: ReadonlyMap<number, IngredientPricing>,
): OrderValue {
  let value = 0;
  const unconfirmed: number[] = [];
  for (const l of lines) {
    const packs = Math.max(0, Number(l.editedPacks) || 0);
    const p = priceAtSupplier(l, supplierId, pricingById.get(l.ingredientId));
    value += packs * p.price;
    if (!p.confirmed && packs > 0) unconfirmed.push(l.ingredientId);
  }
  return { value: round2(value), unconfirmedIngredientIds: unconfirmed };
}

/** null/0/negative = no minimum. */
export function hasMinimum(min: number | null | undefined): min is number {
  return min != null && Number.isFinite(min) && min > 0;
}

/** How far under the minimum the order is; 0 when it meets it (or there's
 *  no minimum). */
export function shortfall(value: number, minimum: number | null | undefined): number {
  if (!hasMinimum(minimum)) return 0;
  return Math.max(0, round2(minimum - value));
}

/** One supplier card on the page right now. */
export type CardForTopUp = {
  supplierId: number;
  supplierName: string;
  minimumOrderValue: number | null;
  lines: (PricedLineInput & { ingredientName: string })[];
  /** False for cards whose lines must not be pulled out (e.g. a reopened,
   *  already-placed order being edited). Defaults to true. */
  canGiveLines?: boolean;
};

export type TopUpSuggestion = {
  ingredientId: number;
  ingredientName: string;
  packs: number;
  fromSupplierId: number;
  fromSupplierName: string;
  /** What it adds to THIS supplier's order (packs × price here). */
  addedValue: number;
  /** What it costs on the other supplier's order today. */
  costThere: number;
  /** addedValue − costThere: positive = dearer here. */
  extraCost: number;
  /** False when this supplier's price isn't saved and we used the other
   *  supplier's price instead. */
  priceConfirmed: boolean;
  /** Moving it (together with the rest of the suggested set) leaves the
   *  other supplier's order under ITS minimum. */
  leavesSourceUnderMinimum: boolean;
  /** The other supplier's minimum (for the warning text). */
  sourceMinimum: number | null;
};

export type TopUpPlan = {
  /** How far under the minimum this order is now. 0 = meets it. */
  gap: number;
  /** The suggested set (empty when there's nothing to move). */
  suggestions: TopUpSuggestion[];
  /** True when moving the suggested set reaches the minimum. */
  closesGap: boolean;
  /** Total extra cost of the suggested set. */
  totalExtraCost: number;
};

// Above this many candidates the exhaustive search would be slow; fall back
// to a greedy pick (cheapest extra cost per £ added first). A real order card
// has a handful of candidates, so the exact search is the normal path.
const EXACT_SEARCH_LIMIT = 14;

type Candidate = TopUpSuggestion & { _sourceValue: number };

/** Suggest lines on OTHER cards to move onto `targetSupplierId`'s order so it
 *  reaches its minimum at the lowest extra cost.
 *
 *  Candidates: lines on other cards whose ingredient lists this supplier as
 *  its secondary supplier (or primary — an item dragged away from its own
 *  supplier). The chosen set closes the gap with the lowest total extra
 *  cost; ties go to fewer items, then the smaller overshoot. Sets that would
 *  leave another supplier under ITS minimum are only used when no other set
 *  closes the gap, and are flagged. If nothing closes the gap, every
 *  candidate is returned (cheapest first) with closesGap = false. */
export function suggestTopUps(
  targetSupplierId: number,
  cards: CardForTopUp[],
  pricingById: ReadonlyMap<number, IngredientPricing>,
): TopUpPlan {
  const target = cards.find(c => c.supplierId === targetSupplierId);
  if (!target || !hasMinimum(target.minimumOrderValue)) {
    return { gap: 0, suggestions: [], closesGap: true, totalExtraCost: 0 };
  }
  const current = orderValueAtSupplier(target.lines, targetSupplierId, pricingById).value;
  const gap = shortfall(current, target.minimumOrderValue);
  if (gap <= 0) return { gap: 0, suggestions: [], closesGap: true, totalExtraCost: 0 };

  const onTarget = new Set(target.lines.map(l => l.ingredientId));
  const candidates: Candidate[] = [];
  for (const card of cards) {
    if (card.supplierId === targetSupplierId || card.canGiveLines === false) continue;
    const sourceValue = orderValueAtSupplier(card.lines, card.supplierId, pricingById).value;
    for (const l of card.lines) {
      if (l.isMisc || l.ingredientId <= 0 || onTarget.has(l.ingredientId)) continue;
      const packs = Math.max(0, Number(l.editedPacks) || 0);
      if (packs <= 0) continue;
      const pricing = pricingById.get(l.ingredientId);
      if (!pricing) continue;
      if (pricing.secondarySupplierId !== targetSupplierId && pricing.supplierId !== targetSupplierId) continue;
      const here = priceAtSupplier(l, targetSupplierId, pricing);
      const there = priceAtSupplier(l, card.supplierId, pricing);
      const addedValue = round2(packs * here.price);
      if (addedValue <= 0) continue;
      const costThere = round2(packs * there.price);
      candidates.push({
        ingredientId: l.ingredientId,
        ingredientName: l.ingredientName,
        packs,
        fromSupplierId: card.supplierId,
        fromSupplierName: card.supplierName,
        addedValue,
        costThere,
        extraCost: round2(addedValue - costThere),
        priceConfirmed: here.confirmed,
        leavesSourceUnderMinimum: false,
        sourceMinimum: hasMinimum(card.minimumOrderValue) ? card.minimumOrderValue : null,
        _sourceValue: sourceValue,
      });
    }
  }
  if (candidates.length === 0) return { gap, suggestions: [], closesGap: false, totalExtraCost: 0 };

  // Which sources a set leaves under their minimum (only sources that met it
  // before — one already short isn't "dropped below" by us, and isn't flagged).
  const sourcesBroken = (set: Candidate[]): Set<number> => {
    const removed = new Map<number, number>();
    for (const c of set) removed.set(c.fromSupplierId, (removed.get(c.fromSupplierId) ?? 0) + c.costThere);
    const broken = new Set<number>();
    for (const c of set) {
      if (c.sourceMinimum == null) continue;
      if (c._sourceValue < c.sourceMinimum) continue;
      if (c._sourceValue - (removed.get(c.fromSupplierId) ?? 0) < c.sourceMinimum - 0.005) broken.add(c.fromSupplierId);
    }
    return broken;
  };

  const better = (a: Candidate[], b: Candidate[] | null): boolean => {
    if (!b) return true;
    const ea = a.reduce((s, c) => s + c.extraCost, 0);
    const eb = b.reduce((s, c) => s + c.extraCost, 0);
    if (Math.abs(ea - eb) > 0.005) return ea < eb;
    if (a.length !== b.length) return a.length < b.length;
    const va = a.reduce((s, c) => s + c.addedValue, 0);
    const vb = b.reduce((s, c) => s + c.addedValue, 0);
    return va < vb;
  };

  const best: { safe: Candidate[] | null; any: Candidate[] | null } = { safe: null, any: null };
  const consider = (set: Candidate[]) => {
    const added = set.reduce((s, c) => s + c.addedValue, 0);
    if (added + 0.005 < gap) return;
    if (sourcesBroken(set).size === 0) { if (better(set, best.safe)) best.safe = set; }
    else if (better(set, best.any)) best.any = set;
  };

  if (candidates.length <= EXACT_SEARCH_LIMIT) {
    const n = candidates.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      const set: Candidate[] = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) set.push(candidates[i]);
      consider(set);
    }
  } else {
    // Greedy: cheapest extra cost per £ added first, stop once the gap closes.
    const ordered = [...candidates].sort((a, b) => a.extraCost / a.addedValue - b.extraCost / b.addedValue);
    const set: Candidate[] = [];
    for (const c of ordered) {
      set.push(c);
      if (set.reduce((s, x) => s + x.addedValue, 0) + 0.005 >= gap) break;
    }
    consider(set);
  }

  const finish = (set: Candidate[], closes: boolean): TopUpPlan => {
    const broken = sourcesBroken(set);
    const suggestions = [...set]
      .sort((a, b) => a.extraCost - b.extraCost || b.addedValue - a.addedValue)
      .map(({ _sourceValue: _unused, ...c }) => ({ ...c, leavesSourceUnderMinimum: broken.has(c.fromSupplierId) }));
    return {
      gap,
      suggestions,
      closesGap: closes,
      totalExtraCost: round2(suggestions.reduce((s, c) => s + c.extraCost, 0)),
    };
  };

  if (best.safe) return finish(best.safe, true);
  if (best.any) return finish(best.any, true);
  return finish(candidates, false);
}
