/**
 * Will we have the 8-pack bags to cover the next few despatches?
 *
 * THE QUESTION (Graeme, 2026-08-27): for every 8-pack order going out on the
 * next three despatches, will the bags exist in time — counting what's in the
 * fridge and what's planned for production between now and then, and NOT
 * counting production scheduled after the despatch would have to leave.
 *
 * That last clause is the whole point. Delivery takes one calendar day after
 * despatch, so an order delivering on D despatches on D−1, and bags planned
 * for D−1 or later are no use to it. Batches on a plan two days after the van
 * has gone look like cover in a naive total and are not.
 *
 * WHAT COUNTS AS SUPPLY, and why it is deliberately mean:
 *
 *   • Bags wrapped TODAY. Wrapping writes an 8-pack fridge count, but nothing
 *     ever decrements it — packing an order doesn't take bags off that
 *     reading. So yesterday's number is not a stock level, it's a historical
 *     high-water mark, and treating it as stock would let orders through
 *     against bags that left the building last week. The fulfilment pick list
 *     already takes exactly this line (routes/fulfilment-availability.ts).
 *   • Bags allocated on production plans dated from today up to the despatch
 *     day. For today's plan the bags already wrapped and the bags still to
 *     wrap are the same bags, so today contributes max(wrapped, planned)
 *     rather than the sum.
 *   • Bags queued against a date whose plan doesn't exist yet
 *     (lib/queued-bags.ts). These count, because that's the mechanism working
 *     as designed — but they're reported separately as `atRisk`, because they
 *     depend on a plan nobody has made yet.
 *
 * Bags planned BEFORE today are not counted, and are instead reported next to
 * any shortfall as something to go and check. They may well be sitting in the
 * fridge; the system genuinely cannot tell, and a check that guesses
 * optimistically is worse than useless. This one errs towards asking.
 *
 * Everything here is pure, so the arithmetic can be tested without a
 * database, and the result carries its own workings — a check whose sums you
 * can read is one you can act on.
 */

import { isDeliveryDay } from "./production-cutoff";

export interface BagDemand {
  /** The day the van leaves = delivery − 1. */
  dispatchDate: string;
  deliveryDate: string;
  recipeId: number;
  recipeName: string;
  bags: number;
  orderName: string | null;
}

export interface BagSupply {
  /** Production plan date the bags are allocated to. */
  productionDate: string;
  recipeId: number;
  bags: number;
  /** True when this is a queued promise rather than bags on a real plan. */
  queued: boolean;
}

export interface BagCoverInput {
  today: string;
  /** Despatch days to check, earliest first. */
  dispatchDates: string[];
  demand: BagDemand[];
  supply: BagSupply[];
  /** Bags wrapped today, by recipe — the only fridge reading that means
   *  anything for bags (see the note above). */
  wrappedToday: Record<number, number>;
}

export interface BagCoverLine {
  dispatchDate: string;
  deliveryDate: string;
  recipeId: number;
  recipeName: string;
  needed: number;
  /** Bags this despatch can actually draw on, after earlier despatches have
   *  taken theirs. */
  covered: number;
  shortfall: number;
  /** Of `covered`, how many depend on a plan that hasn't been made yet. */
  atRisk: number;
  /** Bags allocated on plans dated before today. Not counted as cover —
   *  reported so a shortfall can be checked against the fridge rather than
   *  acted on blindly. */
  earlierProduction: number;
  /** Where the cover comes from, so the sums can be read. */
  sources: Array<{ date: string; bags: number; queued: boolean; label: string }>;
}

export interface BagCoverResult {
  lines: BagCoverLine[];
  shortfalls: BagCoverLine[];
  /** Cover that rests on a plan not yet made. */
  atRiskLines: BagCoverLine[];
  ok: boolean;
}

function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The despatch day for a delivery: one calendar day earlier. */
export function dispatchDayFor(deliveryDate: string): string {
  return addDaysStr(deliveryDate, -1);
}

/**
 * The next `count` despatch days, earliest first.
 *
 * Deliveries run Tue–Sat and despatch is the day before, so despatch days are
 * Mon–Fri. We start from today: today's van may not have gone yet, and if it
 * has, its orders are fulfilled and drop out of the demand feed anyway.
 */
export function nextDispatchDays(today: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count && i < count * 3 + 14; i++) {
    const delivery = addDaysStr(today, i + 1);
    if (!isDeliveryDay(delivery)) continue;
    const dispatch = dispatchDayFor(delivery);
    if (dispatch < today) continue;
    if (!out.includes(dispatch)) out.push(dispatch);
  }
  return out;
}

export function computeBagCover(input: BagCoverInput): BagCoverResult {
  const { today, dispatchDates, demand, supply, wrappedToday } = input;
  const dispatches = [...dispatchDates].sort();

  // ── Supply, per recipe, indexed by the production date it becomes usable ──
  // Today is special: bags already wrapped and bags still to wrap on today's
  // plan are the same bags, so we take the larger rather than the sum. If the
  // team bagged more than planned, the actual count wins.
  const plannedToday: Record<number, number> = {};
  const perRecipeSupply = new Map<number, BagSupply[]>();
  const earlierByRecipe: Record<number, number> = {};

  for (const s of supply) {
    if (s.bags <= 0) continue;
    if (s.productionDate < today) {
      // Made before today. Not counted — nothing decrements a bag reading, so
      // we cannot tell whether these are still here. Surfaced next to any
      // shortfall instead.
      earlierByRecipe[s.recipeId] = (earlierByRecipe[s.recipeId] ?? 0) + s.bags;
      continue;
    }
    if (s.productionDate === today && !s.queued) {
      plannedToday[s.recipeId] = (plannedToday[s.recipeId] ?? 0) + s.bags;
      continue;
    }
    const list = perRecipeSupply.get(s.recipeId) ?? [];
    list.push(s);
    perRecipeSupply.set(s.recipeId, list);
  }

  const recipeIds = new Set<number>([
    ...demand.map(d => d.recipeId),
    ...supply.map(s => s.recipeId),
    ...Object.keys(wrappedToday).map(Number),
  ]);
  for (const rid of recipeIds) {
    const wrapped = Math.max(0, wrappedToday[rid] ?? 0);
    const planned = plannedToday[rid] ?? 0;
    const todayBags = Math.max(wrapped, planned);
    if (todayBags <= 0) continue;
    const list = perRecipeSupply.get(rid) ?? [];
    list.push({ productionDate: today, recipeId: rid, bags: todayBags, queued: false });
    perRecipeSupply.set(rid, list);
  }
  for (const list of perRecipeSupply.values()) list.sort((a, b) => a.productionDate.localeCompare(b.productionDate));

  // ── Walk the despatches in order, drawing supply down as we go ───────────
  // A bag used by Tuesday's van is not available to Wednesday's, so this has
  // to be a running allocation, not three independent sums.
  const remaining = new Map<number, Array<{ date: string; bags: number; queued: boolean }>>();
  for (const [rid, list] of perRecipeSupply) {
    remaining.set(rid, list.map(s => ({ date: s.productionDate, bags: s.bags, queued: s.queued })));
  }

  const lines: BagCoverLine[] = [];
  for (const dispatchDate of dispatches) {
    // Group this despatch's demand per recipe — several orders can want the
    // same product on the same van.
    const forDispatch = demand.filter(d => d.dispatchDate === dispatchDate);
    const byRecipe = new Map<number, { recipeName: string; deliveryDate: string; bags: number }>();
    for (const d of forDispatch) {
      const prior = byRecipe.get(d.recipeId);
      byRecipe.set(d.recipeId, {
        recipeName: d.recipeName,
        deliveryDate: prior?.deliveryDate ?? d.deliveryDate,
        bags: (prior?.bags ?? 0) + d.bags,
      });
    }

    for (const [recipeId, { recipeName, deliveryDate, bags: needed }] of byRecipe) {
      if (needed <= 0) continue;
      const pool = remaining.get(recipeId) ?? [];
      let left = needed;
      let covered = 0;
      let atRisk = 0;
      const sources: BagCoverLine["sources"] = [];
      for (const slot of pool) {
        if (left <= 0) break;
        // The rule that matters: production after the van has left is no use.
        if (slot.date > dispatchDate) continue;
        if (slot.bags <= 0) continue;
        const take = Math.min(slot.bags, left);
        slot.bags -= take;
        left -= take;
        covered += take;
        if (slot.queued) atRisk += take;
        sources.push({
          date: slot.date,
          bags: take,
          queued: slot.queued,
          label: slot.queued ? "queued — plan not made yet" : slot.date === today ? "today" : "planned",
        });
      }
      lines.push({
        dispatchDate,
        deliveryDate,
        recipeId,
        recipeName,
        needed,
        covered,
        shortfall: left,
        atRisk,
        earlierProduction: left > 0 ? (earlierByRecipe[recipeId] ?? 0) : 0,
        sources,
      });
    }
  }

  const shortfalls = lines.filter(l => l.shortfall > 0);
  return {
    lines,
    shortfalls,
    atRiskLines: lines.filter(l => l.shortfall === 0 && l.atRisk > 0),
    ok: shortfalls.length === 0,
  };
}
