/**
 * End-of-week factory number (Graeme, 16 Oct 2026). Objective C (never run
 * out, nothing goes out of date) and G (glanceable status).
 *
 * "On the week total, could you show the end-of-week factory number as it
 * will stand if we don't sell anything more? Or, even better, predict it based
 * on the time left and what we'd normally sell on those delivery days, much
 * like the production plan creation screen does."
 *
 * Calzone 2-packs in the production fridge on Sunday night, two ways:
 *
 *   If no more orders = factory number now
 *                     + today's production still to be wrapped in
 *                     + every later day's planned production (net of 8-pack bags)
 *                     − today's orders not yet scanned out
 *                     − every later day's orders already placed
 *
 *   Predicted         = If no more orders
 *                     − the further packs we'd normally still be ordered for
 *                       each despatch left this week, before its cut-off
 *                       (forecastLateOrders — the SAME forecast the Create
 *                       Plan factory number uses; no second sales model).
 *
 *   Best guess (26 Oct) = Predicted
 *                     + what the kitchen could make on every despatch week
 *                       day with no plan yet (the same Planday capacity
 *                       forecast as the panel's "could still make" bar)
 *                     − a nudge to the late orders for how sales are running
 *                       this week (sales-momentum.ts)
 *     Graeme: "Assume that we will make everything that we can ... It's
 *     saying we're going to have 548 packs ... we've currently got like
 *     1,100 in there, and if we make as much as we want every day this week,
 *     we will have a lot more."
 *
 * Deliberately NOT clamped at zero: a negative end is the useful answer —
 * "short by 40 packs" — not a hidden zero. The lowest point during the week
 * is reported too, so a mid-week shortfall that later production makes good
 * isn't hidden by a healthy Sunday figure.
 *
 * Pure: the API gathers the inputs, the Dispatch Orders panel runs this.
 */
import { plannedProductionPacks, type PlanItemPacksRow } from "./index";

/** A plan item with its 8-pack bag allocation. */
export interface PlanItemTwoPackRow extends PlanItemPacksRow {
  /** 8-pack bags allocated to the item (8 portions each). */
  eightPackBagCount: number | null;
}

/**
 * 2-packs a plan item will add to the fridge: its planned packs less the
 * 2-pack equivalent of its 8-pack bags (8 ÷ pack size each — 4 for
 * calzones). Bags are counted on their own, never in the factory number.
 */
export function plannedTwoPackPacks(row: PlanItemTwoPackRow): number {
  const packSize = Number(row.packSize) || 1;
  const bags = Math.max(0, row.eightPackBagCount ?? 0);
  return Math.max(0, plannedProductionPacks(row) - bags * (8 / packSize));
}

export interface WeekEndLate {
  /** Packs normally still to be ordered before this despatch's cut-off. */
  latePacks: number;
  /** 80% range for latePacks. */
  low: number;
  high: number;
  /** Cut-off already passed — nothing more is coming for this despatch. */
  closed: boolean;
}

export interface WeekEndDay {
  /** Production / despatch day, YYYY-MM-DD (London). */
  date: string;
  /** True when orders go out this day (a weekday that isn't a non-despatch date). */
  isDispatchDay: boolean;
  /** 2-packs planned for production this day, net of bags. Ignored for today
   *  — today's figure is stillToWrapToday. */
  plannedPacks: number;
  /** A production plan exists for this day. */
  hasPlan: boolean;
  /** Packs on orders already placed for this day's despatch. Ignored for
   *  today — today's figure is stillToDispatchToday. */
  knownOrderPacks: number;
  /** No plan yet: what the kitchen could make this day (capacity forecast).
   *  Only used for the best guess, and only after today. */
  couldMakePacks?: number;
  /** Expected further orders for this despatch; null = no forecast possible
   *  (too little history). Ignored on non-despatch days. */
  late: WeekEndLate | null;
}

export interface WeekEndInput {
  /** Today, YYYY-MM-DD (London). */
  today: string;
  /** The Sunday the week ends on. */
  weekEnd: string;
  /** Calzone 2-packs in the production fridge now; null = never counted. */
  stockNow: number | null;
  /** Today's production not yet wrapped into the fridge. */
  stillToWrapToday: number;
  /** Today's orders not yet scanned out; null = couldn't be read (Shopify down). */
  stillToDispatchToday: number | null;
  /** Today through weekEnd (other dates are ignored), any order. */
  days: readonly WeekEndDay[];
  /** Multiplier on the usual late orders for how sales are running now
   *  (salesMomentum().factor); 1 = as normal. Best guess only. */
  salesFactor?: number;
}

export type WeekEndStatus =
  | "ok"
  /** No factory number has ever been counted. */
  | "no-stock-count"
  /** Today's despatch couldn't be read from Shopify. */
  | "no-today-orders"
  /** The week ended before today — use the recorded end instead. */
  | "week-over";

export interface WeekEndStep {
  date: string;
  made: number;
  known: number;
  late: number;
  /** Running "if no more orders" stock at the end of this day. */
  knownEnd: number;
  /** Running predicted stock at the end of this day (null once a forecast is missing). */
  predictedEnd: number | null;
}

export interface WeekEndResult {
  status: WeekEndStatus;
  stockNow: number | null;
  /** Production still to land in the fridge this week. */
  toMake: number;
  /** Orders already placed still to go out this week. */
  toDispatch: number;
  /** End of week if nothing else sells. Negative = a shortfall. */
  ifNoMoreOrders: number | null;
  /** Further packs we'd normally sell for the despatches left. */
  expectedMore: number | null;
  /** End of week, predicted. Negative = a shortfall. */
  predicted: number | null;
  /** 80% range for `predicted` (more late orders → lower fridge). */
  predictedLow: number | null;
  predictedHigh: number | null;
  /** Could still make on unplanned days after today (capacity forecast). */
  couldMake: number;
  /** End of week if every unplanned day makes what it could, late orders
   *  nudged by how sales are running. Null when `predicted` is. */
  bestGuess: number | null;
  bestGuessLow: number | null;
  bestGuessHigh: number | null;
  /** The late orders in the best guess, after the sales nudge. */
  bestGuessMore: number | null;
  /** Open despatch days with no forecast — why `predicted` is missing. */
  predictionGap: string[];
  /** Despatch days after today with no production plan yet — counted as
   *  nothing made. */
  unplannedDays: string[];
  /** The lowest end-of-day stock on the way to Sunday (predicted where
   *  available, otherwise known orders only). */
  tightest: { date: string; packs: number } | null;
  steps: WeekEndStep[];
}

const r = (n: number) => Math.round(n);

export function weekEndFactoryNumber(input: WeekEndInput): WeekEndResult {
  const empty: WeekEndResult = {
    status: "ok", stockNow: input.stockNow, toMake: 0, toDispatch: 0, couldMake: 0,
    bestGuess: null, bestGuessLow: null, bestGuessHigh: null, bestGuessMore: null,
    ifNoMoreOrders: null, expectedMore: null, predicted: null, predictedLow: null, predictedHigh: null,
    predictionGap: [], unplannedDays: [], tightest: null, steps: [],
  };
  if (input.weekEnd < input.today) return { ...empty, status: "week-over" };
  if (input.stockNow == null || !Number.isFinite(input.stockNow)) return { ...empty, status: "no-stock-count" };

  const days = [...input.days]
    .filter(d => d.date >= input.today && d.date <= input.weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date));
  const todayRow = days.find(d => d.date === input.today);
  const todayDispatches = todayRow?.isDispatchDay ?? false;
  if (todayDispatches && input.stillToDispatchToday == null) return { ...empty, status: "no-today-orders" };

  // Today always gets a step (production can still be wrapping on a day
  // with no despatch), even if the caller left it out of `days`.
  if (!todayRow) {
    days.unshift({ date: input.today, isDispatchDay: false, plannedPacks: 0, hasPlan: false, knownOrderPacks: 0, late: null });
  }

  let known = input.stockNow;
  let predicted: number | null = input.stockNow;
  let toMake = 0, toDispatch = 0, expectedMore = 0, down = 0, up = 0, couldMake = 0;
  const predictionGap: string[] = [];
  const unplannedDays: string[] = [];
  const steps: WeekEndStep[] = [];
  let tightest: { date: string; packs: number } | null = null;

  for (const d of days) {
    const isToday = d.date === input.today;
    const made = Math.max(0, isToday ? input.stillToWrapToday : d.plannedPacks);
    const out = d.isDispatchDay ? Math.max(0, isToday ? (input.stillToDispatchToday ?? 0) : d.knownOrderPacks) : 0;
    let late = 0;
    if (d.isDispatchDay) {
      if (!isToday && !d.hasPlan) unplannedDays.push(d.date);
      if (d.late == null) {
        predictionGap.push(d.date);
      } else if (!d.late.closed) {
        late = Math.max(0, d.late.latePacks);
        down += Math.max(0, late - d.late.low);
        up += Math.max(0, d.late.high - late);
      }
    }
    if (!isToday && !d.hasPlan) couldMake += Math.max(0, d.couldMakePacks ?? 0);
    // Production on a non-despatch day (a weekend plan) still lands in the fridge.
    toMake += made;
    toDispatch += out;
    expectedMore += late;
    known += made - out;
    predicted = predicted == null || (d.isDispatchDay && d.late == null) ? null : predicted + made - out - late;
    const stepEnd = predicted ?? known;
    if (tightest == null || stepEnd < tightest.packs) tightest = { date: d.date, packs: r(stepEnd) };
    steps.push({ date: d.date, made: r(made), known: r(out), late: r(late), knownEnd: r(known), predictedEnd: predicted == null ? null : r(predicted) });
  }

  const hasForecast = predictionGap.length === 0;
  const factor = input.salesFactor != null && Number.isFinite(input.salesFactor) && input.salesFactor > 0 ? input.salesFactor : 1;
  const more = expectedMore * factor;
  const best = known + couldMake - more;
  return {
    status: "ok",
    stockNow: r(input.stockNow),
    couldMake: r(couldMake),
    bestGuess: hasForecast ? r(best) : null,
    bestGuessLow: hasForecast ? r(best - up * factor) : null,
    bestGuessHigh: hasForecast ? r(best + down * factor) : null,
    bestGuessMore: hasForecast ? r(more) : null,
    toMake: r(toMake),
    toDispatch: r(toDispatch),
    ifNoMoreOrders: r(known),
    expectedMore: hasForecast ? r(expectedMore) : null,
    predicted: hasForecast ? r(known - expectedMore) : null,
    predictedLow: hasForecast ? r(known - expectedMore - up) : null,
    predictedHigh: hasForecast ? r(known - expectedMore + down) : null,
    predictionGap,
    unplannedDays,
    tightest,
    steps,
  };
}

const fmt = (n: number) => Math.abs(Math.round(n)).toLocaleString("en-GB");

/** "310 packs" or "short by 40 packs"; `approx` adds a leading "~",
 *  `unit: false` leaves off the word "packs". */
export function formatEndPacks(n: number, approx = false, unit = true): string {
  const a = approx ? "~" : "";
  const u = unit ? " packs" : "";
  return n < 0 ? `short by ${a}${fmt(n)}${u}` : `${a}${fmt(n)}${u}`;
}

/** The one plain line under the numbers. */
export function describeWeekEnd(res: WeekEndResult, dayName: (date: string) => string = d => d): string {
  switch (res.status) {
    case "week-over": return "This week has finished.";
    case "no-stock-count": return "Can't work out the end of the week: there's no factory number count yet.";
    case "no-today-orders": return "Can't work out the end of the week: today's orders couldn't be read from Shopify.";
    case "ok": break;
  }
  const parts = [`End of week in the fridge: ${formatEndPacks(res.ifNoMoreOrders ?? 0)} if nothing else sells`];
  if (res.predicted != null) {
    parts.push(`${formatEndPacks(res.predicted, true, false)} predicted`);
  } else if (res.predictionGap.length > 0) {
    parts.push(`no prediction for ${res.predictionGap.map(dayName).join(", ")} (not enough order history)`);
  }
  // Without this, a week whose later days aren't planned yet reads as a
  // frightening shortfall with no reason given.
  if (res.unplannedDays.length > 0) {
    parts.push(res.bestGuess != null && res.couldMake > 0
      ? `best guess ${formatEndPacks(res.bestGuess, true, false)} if ${res.unplannedDays.map(dayName).join(", ")} make what they could`
      : `no plan yet for ${res.unplannedDays.map(dayName).join(", ")}, so nothing counted as made`);
  }
  return parts.join(" · ");
}
