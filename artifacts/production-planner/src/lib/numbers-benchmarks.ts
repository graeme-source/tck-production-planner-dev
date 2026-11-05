/**
 * Benchmarks on the Numbers page (Graeme, 5 Nov 2026). Objective I.
 *
 * Each panel has a minimum and a stretch he sets, and its band takes a colour
 * from the Advertising Efficiency scale (shadeAtRatio, lib/ad-efficiency.ts)
 * for where the figure sits against them. Pure, tested.
 *
 * Money and counts that build up over time are benchmarked PER DAY, then
 * scaled to the days in view, so one pair of figures works for Yesterday and
 * for Last 30 days. While today is running it counts as the share of a day's
 * trade that has usually happened by now (the day pace, from the last four
 * weeks' orders), so £1,000 by midday reads as ahead if most of it normally
 * comes later. Rates (AOV, ROAS, conversion) don't scale.
 */
import { shadeAtRatio, type RoasShade } from "./ad-efficiency";

export type KpiUnit = "£" | "%" | "count";

export interface KpiSpec {
  id: string;
  label: string;
  unit: KpiUnit;
  /** Builds up over time, so the benchmark is per day and scales with the period. */
  perDay: boolean;
  /** Less is better: the benchmarks run downwards. */
  lowerIsBetter?: boolean;
  /** Comes from the monthly sales targets, the single source for sales. */
  monthlyTarget?: boolean;
}

export const KPIS = [
  { id: "sales", label: "Total sales", unit: "£", perDay: true, monthlyTarget: true },
  // The month's revenue against the monthly minimum and stretch: Month to Date
  // and Forecast, judged on where the month is heading.
  { id: "monthlySales", label: "Monthly sales", unit: "£", perDay: false, monthlyTarget: true },
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
  stretch: number | null;
}

export type BenchmarkMap = Partial<Record<KpiId, Benchmark>>;

interface Levels { minimum: number; stretch: number }

/** A day's sales target is the month's ÷ its days, and setting a day's target
 *  sets the month's: one target, read or edited either way. */
export const dailyFromMonthly = (monthly: number, daysInMonth: number) => monthly / daysInMonth;
export const monthlyFromDaily = (daily: number, daysInMonth: number) => Math.round(daily * daysInMonth);

export function salesBenchmark(minimum: number, stretch: number | null, daysInMonth: number): Benchmark {
  return { minimum: dailyFromMonthly(minimum, daysInMonth), stretch: stretch == null ? null : dailyFromMonthly(stretch, daysInMonth) };
}

/** Both figures, in order: rising, or falling when less is better. */
export function benchmarkLevels(b: Benchmark | undefined, spec: KpiSpec): Levels | null {
  if (b?.minimum == null || b.stretch == null) return null;
  if (spec.lowerIsBetter ? b.minimum < b.stretch : b.minimum > b.stretch) return null;
  return { minimum: b.minimum, stretch: b.stretch };
}

/** A note for the editor when the figures can't colour anything yet. */
export function benchmarkProblem(b: Benchmark, spec: KpiSpec): string | null {
  const set = [b.minimum, b.stretch].filter(v => v != null).length;
  if (set === 0) return null;
  if (set < 2) return "Fill in both to turn the colour on.";
  if (benchmarkLevels(b, spec)) return null;
  return spec.lowerIsBetter ? "Less is better here, so the stretch should be below the limit." : "The stretch should be above the minimum.";
}

export interface KpiGrade {
  shade: RoasShade;
  /** The two figures scaled to the days in view. */
  levels: Levels;
}

const lerp = (t: number, a: number, b: number) => a + Math.min(1, Math.max(0, t)) * (b - a);

/**
 * Colour a figure. Under the minimum it's the same as a ROAS under target:
 * yellow just under, orange, red, then dark red at 30% under. At the minimum
 * it's brand green, darkening to emerald at the stretch, then on to deep
 * platinum 25% past it. Null without a figure or both benchmarks.
 */
export function gradeKpi(value: number | null | undefined, benchmark: Benchmark | undefined, spec: KpiSpec, days = 1): KpiGrade | null {
  if (value == null || !Number.isFinite(value)) return null;
  const base = benchmarkLevels(benchmark, spec);
  if (!base || !(days > 0)) return null;
  const scale = spec.perDay ? days : 1;
  const levels = { minimum: base.minimum * scale, stretch: base.stretch * scale };
  if (levels.minimum <= 0 || levels.stretch <= 0) return null;

  // Less is better: the same sums on the reciprocals, so spending half the
  // limit reads as doing twice as well.
  const flip = (n: number) => (spec.lowerIsBetter ? (n > 0 ? 1 / n : Number.POSITIVE_INFINITY) : n);
  const [v, min, stretch] = [flip(value), flip(levels.minimum), flip(levels.stretch)];
  const ratio = v < min ? v / min
    : v < stretch ? lerp((v - min) / (stretch - min), 1, 1.25)
      : lerp((v / stretch - 1) / 0.25, 1.25, 1.5);
  return { shade: shadeAtRatio(ratio), levels };
}

/** One KPI's share of a normal day done by the end of each London hour (0–1). */
export type DayPace = Partial<Record<KpiId, number[]>>;

/** The part of a London day gone by now, in hours. */
export function londonHoursGone(now: Date): number {
  const [h, m] = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).split(":").map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

/** How much of a normal day's figure has come in by now; the clock when
 *  there's no history for it. */
export function shareOfDayDone(curve: number[] | undefined, hoursGone: number): number {
  if (!curve || curve.length !== 24) return hoursGone / 24;
  const hour = Math.floor(hoursGone);
  const before = hour > 0 ? curve[hour - 1]! : 0;
  return before + (curve[hour]! - before) * (hoursGone - hour);
}

/** Below this, a running day is too young to judge: the first order of the
 *  morning would swing the colour from dark red to platinum. */
export const TOO_EARLY_SHARE = 0.05;

/** Days the benchmark should cover: the running day counts as the share of it
 *  usually done by now. Null while today alone is too young to judge. */
export function benchmarkDays(win: { dayCount: number; includesToday: boolean }, dayShare: number): number | null {
  if (!win.includesToday) return win.dayCount;
  if (win.dayCount === 1 && dayShare < TOO_EARLY_SHARE) return null;
  return win.dayCount - 1 + dayShare;
}

/** Where today should end up, at its usual pace. */
export function dayForecast(value: number | null | undefined, dayShare: number): number | null {
  if (value == null || dayShare < TOO_EARLY_SHARE) return null;
  return value / dayShare;
}

export function formatBenchmark(n: number, unit: KpiUnit): string {
  if (unit === "£") return `£${Math.round(n).toLocaleString("en-GB")}`;
  const rounded = Math.round(n * 10) / 10;
  return unit === "%" ? `${rounded}%` : rounded.toLocaleString("en-GB");
}
