/**
 * Benchmarks on the Numbers page (Graeme, 5 Nov 2026). Objective I.
 *
 * Every panel gets a grade against three figures he sets, in the Advertising
 * Efficiency colours (shadeAtRatio, lib/ad-efficiency.ts), and an arrow for
 * whether it's improving against the period before. Pure, tested.
 *
 * Money and counts that build up over time are benchmarked PER DAY, then
 * scaled to the days in view, so one set of figures works for Yesterday and
 * for Last 30 days. While today is running it counts as the part of the day
 * gone, or a morning's sales would read as a miss. Rates (AOV, ROAS,
 * conversion) don't scale.
 */
import { addDays, addMonths, endOfMonth, startOfMonth, type DayString } from "./roas";
import { shadeAtRatio, type RoasShade } from "./ad-efficiency";
import type { TrendBucket, TrendFigures } from "./sales-trend-view";

export type KpiUnit = "£" | "%" | "count";

export interface KpiSpec {
  id: string;
  label: string;
  unit: KpiUnit;
  /** Builds up over time, so the benchmark is per day and scales with the period. */
  perDay: boolean;
  /** Less is better: the benchmarks run downwards. */
  lowerIsBetter?: boolean;
}

export const KPIS = [
  { id: "sales", label: "Total sales", unit: "£", perDay: true },
  { id: "aov", label: "Average order value", unit: "£", perDay: false },
  { id: "newCustomerShare", label: "New customer share of orders", unit: "%", perDay: false },
  { id: "newCustomers", label: "New customers", unit: "count", perDay: true },
  { id: "newCustomerRevenue", label: "New customer revenue", unit: "£", perDay: true },
  { id: "newCustomerRoas", label: "New customer ROAS", unit: "%", perDay: false },
  { id: "adSpend", label: "Ad spend", unit: "£", perDay: true, lowerIsBetter: true },
  { id: "recurringSubs", label: "Recurring subscription orders", unit: "count", perDay: true },
  { id: "newSubs", label: "New subscriptions", unit: "count", perDay: true },
  { id: "subscriptionRevenue", label: "Subscription revenue", unit: "£", perDay: true },
  { id: "conversionRate", label: "Conversion rate", unit: "%", perDay: false },
] as const satisfies readonly KpiSpec[];

export type KpiId = (typeof KPIS)[number]["id"];

export const kpiSpec = (id: KpiId): KpiSpec => KPIS.find(k => k.id === id)!;

export interface Benchmark {
  minimum: number | null;
  good: number | null;
  veryGood: number | null;
}

export type BenchmarkMap = Partial<Record<KpiId, Benchmark>>;

interface Levels { minimum: number; good: number; veryGood: number }

/** All three figures, in order: rising, or falling when less is better. */
export function benchmarkLevels(b: Benchmark | undefined, spec: KpiSpec): Levels | null {
  if (b?.minimum == null || b.good == null || b.veryGood == null) return null;
  const sign = spec.lowerIsBetter ? -1 : 1;
  if (sign * b.minimum > sign * b.good || sign * b.good > sign * b.veryGood) return null;
  return { minimum: b.minimum, good: b.good, veryGood: b.veryGood };
}

/** A note for the editor when the figures can't grade anything yet. */
export function benchmarkProblem(b: Benchmark, spec: KpiSpec): string | null {
  const set = [b.minimum, b.good, b.veryGood].filter(v => v != null).length;
  if (set === 0) return null;
  if (set < 3) return "Fill in all three to turn the colours on.";
  if (benchmarkLevels(b, spec)) return null;
  return spec.lowerIsBetter ? "Less is better here, so these should go down from left to right." : "These should go up from left to right.";
}

export type KpiGradeWord = "Under" | "Minimum" | "Good" | "Very good";

export interface KpiGrade {
  word: KpiGradeWord;
  shade: RoasShade;
  /** The three figures scaled to the days in view. */
  levels: Levels;
}

// Where each level lands on the Advertising Efficiency scale.
const SCALE = { floor: 0.7, minimum: 0.95, good: 1, veryGood: 1.25, top: 1.5 };

const lerp = (t: number, a: number, b: number) => a + Math.min(1, Math.max(0, t)) * (b - a);

/**
 * Grade a figure. Yellow at the minimum, brand green at good, emerald at very
 * good, running on to deep platinum 25% past it; red under the minimum,
 * darkest at 30% under. Null without a figure or a full set of benchmarks.
 */
export function gradeKpi(value: number | null | undefined, benchmark: Benchmark | undefined, spec: KpiSpec, days = 1): KpiGrade | null {
  if (value == null || !Number.isFinite(value)) return null;
  const base = benchmarkLevels(benchmark, spec);
  if (!base || !(days > 0)) return null;
  const scale = spec.perDay ? days : 1;
  const levels = { minimum: base.minimum * scale, good: base.good * scale, veryGood: base.veryGood * scale };
  if (spec.lowerIsBetter ? levels.veryGood < 0 : levels.minimum <= 0) return null;

  // Less is better: the same sums on the reciprocals, so spending half the
  // limit reads as doing twice as well.
  const flip = (n: number) => (spec.lowerIsBetter ? (n > 0 ? 1 / n : Number.POSITIVE_INFINITY) : n);
  const [v, min, good, top] = [flip(value), flip(levels.minimum), flip(levels.good), flip(levels.veryGood)];
  const ratio = v < min ? lerp((v / min - 0.7) / 0.3, SCALE.floor, SCALE.minimum)
    : v < good ? lerp((v - min) / (good - min), SCALE.minimum, SCALE.good)
      : v < top ? lerp((v - good) / (top - good), SCALE.good, SCALE.veryGood)
        : lerp((v / top - 1) / 0.25, SCALE.veryGood, SCALE.top);
  const word: KpiGradeWord = v < min ? "Under" : v < good ? "Minimum" : v < top ? "Good" : "Very good";
  return { word, shade: shadeAtRatio(ratio), levels };
}

/** The part of a London day gone by now, 0–1. */
export function londonDayFraction(now: Date): number {
  const [h, m] = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).split(":").map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) / 1440;
}

/** Days the benchmark should cover: the running day counts as the part gone. */
export function benchmarkDays(win: { dayCount: number; includesToday: boolean }, dayFraction: number): number {
  return win.includesToday ? win.dayCount - 1 + dayFraction : win.dayCount;
}

export interface ComparisonWindow {
  from: DayString;
  to: DayString;
  /** "last week", in "vs …". */
  label: string;
  /** Its last day should be cut at this time of day, to match today so far. */
  cutLastDay: boolean;
}

/**
 * What a period is compared with: a single day against the same weekday last
 * week, a month so far against the same days last month, last month against
 * the month before, and anything else against the same number of days just
 * before it.
 */
export function comparisonWindow(win: { id: string; from: DayString; to: DayString; dayCount: number; includesToday: boolean }): ComparisonWindow {
  const cutLastDay = win.includesToday;
  if (win.dayCount === 1) {
    const day = addDays(win.from, -7);
    return { from: day, to: day, label: "last week", cutLastDay };
  }
  if (win.id === "monthToDate") {
    const from = addMonths(win.from, -1);
    const sameDay = `${from.slice(0, 8)}${win.to.slice(8, 10)}`;
    const last = endOfMonth(from);
    return { from, to: sameDay > last ? last : sameDay, label: "this point last month", cutLastDay };
  }
  if (win.id === "lastMonth") {
    const from = startOfMonth(addMonths(win.from, -1));
    return { from, to: endOfMonth(from), label: "the month before", cutLastDay: false };
  }
  return { from: addDays(win.from, -win.dayCount), to: addDays(win.from, -1), label: `the ${win.dayCount} days before`, cutLastDay };
}

/** The figures compared; null means there's no fair comparison for that one. */
export interface PriorFigures {
  revenue: number;
  aov: number | null;
  orders: number;
  newCustomerShare: number | null;
  newCustomers: number;
  newCustomerRevenue: number;
  newCustomerRoas: number | null;
  adSpend: number | null;
  recurringSubs: number;
  newSubs: number;
  subscriptionRevenue: number;
}

export function priorFromTotals(t: TrendFigures): PriorFigures {
  return {
    revenue: t.revenue,
    aov: t.aov,
    orders: t.orders,
    newCustomerShare: t.newCustomerSharePercent,
    newCustomers: t.newCustomerOrders,
    newCustomerRevenue: t.newCustomerRevenue,
    newCustomerRoas: t.roasPercent,
    adSpend: t.adSpend,
    recurringSubs: t.recurringSubOrders,
    newSubs: t.newSubOrders,
    subscriptionRevenue: t.subscriptionRevenue,
  };
}

/**
 * A comparison cut to the same time of day: the whole days before plus the
 * last day's hours gone by, with the running hour taken pro rata. Ad spend is
 * only known by the day, so it and ROAS have no fair comparison here.
 */
export function priorAtThisTime(wholeDays: TrendFigures | null, lastDayHours: TrendBucket[], dayFraction: number): PriorFigures {
  const hoursGone = dayFraction * 24;
  const share = (b: TrendBucket) => Math.min(1, Math.max(0, hoursGone - (b.hourOfDay ?? 0)));
  const add = (pick: (f: TrendFigures) => number) =>
    (wholeDays ? pick(wholeDays) : 0) + lastDayHours.reduce((s, b) => s + pick(b) * share(b), 0);
  const revenue = add(f => f.revenue);
  const paid = add(f => f.paidOrders);
  const newPaid = add(f => f.newCustomerPaidOrders);
  return {
    revenue,
    aov: paid > 0 ? revenue / paid : null,
    orders: add(f => f.orders),
    newCustomerShare: paid > 0 ? (newPaid / paid) * 100 : null,
    newCustomers: add(f => f.newCustomerOrders),
    newCustomerRevenue: add(f => f.newCustomerRevenue),
    newCustomerRoas: null,
    adSpend: null,
    recurringSubs: add(f => f.recurringSubOrders),
    newSubs: add(f => f.newSubOrders),
    subscriptionRevenue: add(f => f.subscriptionRevenue),
  };
}

export interface KpiChange {
  direction: "up" | "down" | "flat";
  /** Whole %, unsigned. */
  percent: number;
  /** True when the change is good news; null when level. */
  better: boolean | null;
}

/** Under this it's level: a rounding wobble isn't a trend. */
const LEVEL_PERCENT = 1;

/** Null when there's nothing to compare with: from £0, a % would mean nothing. */
export function kpiChange(current: number | null | undefined, prior: number | null | undefined, spec: KpiSpec): KpiChange | null {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior) || prior <= 0) return null;
  const change = ((current - prior) / prior) * 100;
  if (Math.abs(change) < LEVEL_PERCENT) return { direction: "flat", percent: 0, better: null };
  const up = change > 0;
  return { direction: up ? "up" : "down", percent: Math.round(Math.abs(change)), better: spec.lowerIsBetter ? !up : up };
}

export function formatBenchmark(n: number, unit: KpiUnit): string {
  if (unit === "£") return `£${Math.round(n).toLocaleString("en-GB")}`;
  const rounded = Math.round(n * 10) / 10;
  return unit === "%" ? `${rounded}%` : rounded.toLocaleString("en-GB");
}
