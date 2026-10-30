/**
 * Queued test production — the rules (Graeme, 30 Oct 2026). Pure, no
 * database, so every rule is unit-tested (queued-production-rules.test.ts).
 * Objectives C (make the right amount) and B (order what it needs in time).
 *
 * 1. Suggested batches from sales. "I'm making the production for next
 *    Wednesday because next Friday we've got delivery of these products…
 *    automatically look for the sales for next Friday and then tell me how
 *    many packs I need… add on a minimum of 5 packs… round up to the
 *    nearest batch. 91 packs sold would equal 100 packs to be made."
 *      packs to make ≥ sold + 5, in whole batches.
 *
 * 2. Which ingredients need ordering. Before, anything with a stock check or
 *    a kanban card was "routine" and never listed — so the test's 3.5 L of
 *    Malbec and 1.8 kg of crispy bacon (both kanban, both barely used by
 *    the normal menu) never came up. Now a routine ingredient is listed too
 *    when the test would run it out:
 *      special  — not routinely stocked: order all the test needs.
 *                 "Routinely stocked" means a stock check or kanban card AND
 *                 ordered in the last month AND used by normal production in
 *                 the last month (Graeme, 30 Oct: "we'd rather be cautious…
 *                 Only things you're sure about, like … flour"). Fresh thyme
 *                 with a kanban card nobody has bought or used for weeks is
 *                 special.
 *      short    — counted stock plus what's on order doesn't cover the
 *                 test on its own: order the shortfall.
 *      check    — the test needs more than half a normal week's use (or the
 *                 normal menu hardly uses it), and either there's no stock
 *                 figure (kanban, never counted) or the stock only just
 *                 covers it. Normal ordering is sized for normal use and
 *                 can't see the test until its plan exists, so look at the
 *                 shelf; tick it to order.
 *    Normal use before the day is NOT taken off the stock: normal ordering
 *    replaces that (taking 40 days of it off a December test asked for
 *    582 kg of flour).
 *      covered  — normal ordering covers it.
 */

/** Extra packs on top of the packs sold, before rounding up to whole batches. */
export const QUEUE_EXTRA_PACKS = 5;

/** A kanban ingredient is worth checking when the test needs more than this
 *  share of a normal week's use. */
export const CHECK_SHARE_OF_WEEK = 0.5;

/** "Recently" ordered / used = in the last month. */
export const RECENT_DAYS = 30;

/** Working days from production to delivery: made Wednesday, delivered
 *  Friday (the same gap as the test boxes — test-box-schedule productionDateFor). */
export const PRODUCTION_TO_DELIVERY_WORKING_DAYS = 2;

export interface BatchSuggestion {
  packsSold: number;
  /** Sold + extra packs. 0 when nothing sold. */
  requiredPacks: number;
  batches: number;
  /** What those batches make, in packs and single units. */
  packsMade: number;
  unitsMade: number;
}

const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** Packs a batch makes: 10 portions in 2-packs → 5. */
export function packsPerBatch(portionsPerBatch: number, packSize: number): number {
  const ppb = portionsPerBatch > 0 ? portionsPerBatch : 10;
  const size = packSize > 0 ? packSize : 1;
  return clean(ppb / size);
}

/** 91 sold, 10 packs a batch → 96 → 10 batches = 100 packs. Nothing sold → nothing. */
export function suggestQueueBatches(input: { packsSold: number; packSize: number; portionsPerBatch: number }, extraPacks = QUEUE_EXTRA_PACKS): BatchSuggestion {
  const sold = Math.max(0, Math.round(input.packsSold || 0));
  if (sold === 0) return { packsSold: 0, requiredPacks: 0, batches: 0, packsMade: 0, unitsMade: 0 };
  const perBatch = packsPerBatch(input.portionsPerBatch, input.packSize);
  const requiredPacks = sold + Math.max(0, extraPacks);
  const batches = Math.ceil(clean(requiredPacks / perBatch));
  return {
    packsSold: sold,
    requiredPacks,
    batches,
    packsMade: clean(batches * perBatch),
    unitsMade: clean(batches * (input.portionsPerBatch > 0 ? input.portionsPerBatch : 10)),
  };
}

export type IngredientOrderStatus = "special" | "short" | "check" | "covered";

export interface IngredientNeedInput {
  /** What the queued batches need, in the ingredient's own unit. */
  required: number;
  /** On open purchase orders, same unit. */
  inbound: number;
  /** Stock check or kanban card. */
  isRoutine: boolean;
  /** On a placed purchase order in the last month. */
  recentlyOrdered: boolean;
  /** Used by normal production in the last month. */
  recentlyUsed: boolean;
  /** Expected stock now (last count + deliveries − usage); null = no figure. */
  stockNow: number | null;
  /** Average normal use a week (last 4 weeks); null = usage not tracked. */
  weeklyUse: number | null;
}

export type SpecialReason = "not-stocked" | "not-ordered" | "not-used";

export interface IngredientNeed {
  status: IngredientOrderStatus;
  /** Why a special line is special. */
  reason: SpecialReason | null;
  /** What to order if it's ordered (never below 0). */
  toOrder: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function classifyIngredientNeed(i: IngredientNeedInput): IngredientNeed {
  const required = Math.max(0, i.required);
  const inbound = Math.max(0, i.inbound);
  const reason: SpecialReason | null = !i.isRoutine ? "not-stocked" : !i.recentlyOrdered ? "not-ordered" : !i.recentlyUsed ? "not-used" : null;
  // Open orders are for normal production; the test's own orders are
  // ticked off (queued_ingredient_marks), so a special line orders it all.
  if (reason) return { status: "special", reason, toOrder: r2(required) };
  if (i.stockNow != null) {
    const short = r2(required - Math.max(0, i.stockNow) - inbound);
    if (short > 0) return { status: "short", reason: null, toOrder: short };
  }
  const weekly = Math.max(0, i.weeklyUse ?? 0);
  const big = required > 0 && (weekly <= 0 || required > weekly * CHECK_SHARE_OF_WEEK);
  // Stock that covers the test with a normal week's use to spare is fine whatever the size.
  const roomy = i.stockNow != null && Math.max(0, i.stockNow) + inbound >= required + weekly;
  return big && !roomy
    ? { status: "check", reason: null, toOrder: r2(required) }
    : { status: "covered", reason: null, toOrder: 0 };
}

export type IngredientMark = "ordered" | "not_needed";

/** Still to order: listed, something to order, and nobody has ticked it
 *  ordered or not needed. */
export function outstanding(status: IngredientOrderStatus, toOrder: number, mark: IngredientMark | null): boolean {
  return status !== "covered" && toOrder > 0 && mark == null;
}
