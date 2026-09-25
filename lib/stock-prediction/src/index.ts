// Predicted finished-goods stock at the START of a plan date.
//
// Every production plan asks the same question: "how many packs will already
// be in the fridge when this plan's production day starts?" The live fridge
// count is only the beginning of the answer. Between now and the plan date:
//
//   + today's production that hasn't been wrapped into the fridge yet
//   − today's orders that haven't been scanned out yet
//   + each working day in between: that day's planned production
//   − each working day in between: that day's dispatch
//
// The calzone Factory Number and the macaroni cheese stock figure both need
// exactly this, and for a while only the calzone path had all four terms —
// mac cheese planned from "live − still to dispatch" and so ignored a batch
// still being wrapped and, for a plan made two days ahead (the normal case),
// the whole of the day in between. This module is the single copy both
// categories (server and screen) now use, so they cannot disagree again.
//
// Pure arithmetic: no database, no dates beyond string comparison. The API
// gathers the inputs; the Create Plan screens re-run it when an operator
// corrects the live count so the plan updates with the same maths.

/** One working day between today and the plan date, rolled forward. */
export interface RollForwardDay {
  /** Dispatch date (YYYY-MM-DD) — for display only. */
  date: string;
  /** Packs that day's plan will add to the fridge. 0 when no plan exists yet. */
  plannedProductionPacks: number;
  /** Packs that day's dispatch will take out (orders so far). */
  dispatchPacks: number;
}

export interface PlanStartStockInput {
  /** Latest production-fridge reading (packs). */
  liveStock: number;
  /** Today's production still to land in the fridge (see remainingWrappingPacks). */
  stillToWrapToday: number;
  /** Today's orders not yet scanned out of the fridge. */
  stillToDispatchToday: number;
  /** Working days strictly between today and the plan date, oldest first.
   *  Empty when the plan date is the next working day (or today). */
  rollForward?: RollForwardDay[];
}

export interface RollForwardStep extends RollForwardDay {
  /** Predicted stock at the END of this day (never below zero). */
  stockAfter: number;
}

export interface PlanStartStock {
  liveStock: number;
  stillToWrapToday: number;
  stillToDispatchToday: number;
  /** max(0, live + still to wrap − still to dispatch), rounded — where the
   *  fridge lands by close of business today. */
  endOfToday: number;
  rollForward: RollForwardStep[];
  rolledProductionPacks: number;
  rolledDispatchPacks: number;
  /** The stock figure a plan for the plan date should net its demand against. */
  atPlanStart: number;
}

/**
 * Where the fridge will be at the start of the plan date.
 *
 * Clamps at zero at close of business today and at the end of every rolled
 * day: stock can't go negative, and orders a day can't cover don't come back
 * out of later production. With a single rolled day this is exactly the
 * calzone formula it replaced:
 *   max(0, max(0, round(live + wrap − dispatch)) + prevProduction − dispatch1)
 */
export function planStartStock(input: PlanStartStockInput): PlanStartStock {
  const endOfToday = Math.max(0, Math.round(input.liveStock + input.stillToWrapToday - input.stillToDispatchToday));
  let stock = endOfToday;
  let rolledProductionPacks = 0;
  let rolledDispatchPacks = 0;
  const rollForward: RollForwardStep[] = [];
  for (const day of input.rollForward ?? []) {
    stock = Math.max(0, stock + day.plannedProductionPacks - day.dispatchPacks);
    rolledProductionPacks += day.plannedProductionPacks;
    rolledDispatchPacks += day.dispatchPacks;
    rollForward.push({ ...day, stockAfter: stock });
  }
  return {
    liveStock: input.liveStock,
    stillToWrapToday: input.stillToWrapToday,
    stillToDispatchToday: input.stillToDispatchToday,
    endOfToday,
    rollForward,
    rolledProductionPacks,
    rolledDispatchPacks,
    atPlanStart: stock,
  };
}

/**
 * Working (dispatch) days strictly after `today` and strictly before
 * `planDate`, oldest first. `nextDispatchDay` is the caller's holiday-aware
 * walker, so bank holidays and shutdowns are skipped exactly as elsewhere.
 * The last entry, when there is one, is the plan date's previous working day
 * — the day the calzone path has always rolled forward.
 */
export function interveningDispatchDays(
  today: string,
  planDate: string,
  nextDispatchDay: (from: string) => string,
): string[] {
  const days: string[] = [];
  // Cap as a guard against a walker that never advances; a plan is never
  // made anywhere near 60 working days out.
  for (let d = nextDispatchDay(today); d < planDate && days.length < 60; d = nextDispatchDay(d)) {
    days.push(d);
  }
  return days;
}

/** The recipe + plan-item fields the production maths reads. */
export interface PlanItemPacksRow {
  batchesTarget: number | null;
  portionsPerBatch: number | string | null;
  packSize: number | string | null;
}

/** Packs a plan item will produce: batches × (portions per batch ÷ pack size). */
export function plannedProductionPacks(row: PlanItemPacksRow): number {
  const portionsPerBatch = Number(row.portionsPerBatch) || 10;
  const packSize = Number(row.packSize) || 1;
  return (row.batchesTarget ?? 0) * (portionsPerBatch / packSize);
}

export interface WrappingProgressRow extends PlanItemPacksRow {
  fridgeQty: number | null;
  fridgeEightPackQty: number | null;
  eightPackBagCount: number | null;
  freezerQty: number | null;
  wonlyCount: number | null;
  /** Packs thrown in the dog bin (migration 0131). Optional so callers that
   *  predate dog bins read as zero. */
  dogBinCount?: number | null;
  wrappingComplete: boolean | null;
}

/**
 * Packs of today's plan item still to be wrapped into the fridge (as 2-packs).
 *
 * Once wrapping is marked complete nothing more is coming, whatever the count
 * says. Otherwise the target less everything already accounted for: packs
 * wrapped to the fridge, 8-pack bags, packs sent to the freezer (wonkies +
 * auto-freeze on completion), packs sitting on the wonky rack, and packs
 * thrown in the dog bin. Without the wonky/freezer terms a recipe with
 * wonkies read "still N to wrap" forever; without the dog bin term the
 * prediction counted packs that are in the bin as fridge stock to come.
 * Dog bins are ONLY subtracted here — they are never stock anywhere.
 *
 * The prediction counts 2-PACKS ONLY, so every 8-pack bag — planned or already
 * wrapped — comes off. Bag counters are in BAGS (8 portions each), hence the
 * 8 ÷ packSize conversion (a bag = 4 two-packs for calzones):
 *   eightPackBagCount  = bags PLANNED for the item (set before production)
 *   fridgeEightPackQty = bags actually wrapped so far
 * Bags still to come are excluded up front so the prediction is right from
 * the moment the plan carries a bag allocation — bagging often runs after the
 * next day's plan is made. If the team bags more than planned, actuals win.
 */
export function remainingWrappingPacks(row: WrappingProgressRow): number {
  if (row.wrappingComplete) return 0;
  const packSize = Number(row.packSize) || 1;
  const targetPacks = plannedProductionPacks(row);
  const bagEquiv = 8 / packSize;
  const bagsWrapped = row.fridgeEightPackQty ?? 0;
  const bagsStillToCome = Math.max(0, (row.eightPackBagCount ?? 0) - bagsWrapped);
  const accountedFor = (row.fridgeQty ?? 0)
    + bagsWrapped * bagEquiv
    + (row.freezerQty ?? 0)
    + (row.wonlyCount ?? 0)
    + (row.dogBinCount ?? 0);
  return Math.max(0, targetPacks - accountedFor - bagsStillToCome * bagEquiv);
}
