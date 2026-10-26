/**
 * Last Production Day slide — trend words for each KPI (Graeme, 2026-10-22:
 * "a trend graph for the last 7 days for each of those KPIs, so we can see if
 * the numbers are going up or down"). Pure; tested in kpi-trend.test.ts. The
 * series themselves come from the API (services/last-production-kpis.ts).
 */

/** Which way is good for a KPI. "neutral" = more isn't better or worse (batches planned). */
export type Better = "higher" | "lower" | "neutral";

export interface KpiTrend {
  direction: "up" | "down" | "flat";
  /** good/bad by the KPI's direction; neutral for flat or a neutral KPI. */
  tone: "good" | "bad" | "neutral";
  /** % change vs the average of the earlier days; null when that average is 0. */
  pct: number | null;
  /** Latest minus the earlier days' average. */
  delta: number;
  previousAverage: number;
  /** How many earlier days had a figure (the "previous N"). */
  previousDays: number;
  /** "▲ 6% vs average of previous 6" */
  text: string;
}

/** Changes smaller than this (in %) read as level, not a trend. */
const FLAT_PCT = 1;

/**
 * The last day against the average of the days before it. Days without a
 * figure (null) are left out of the average. null when the last day has no
 * figure or there's no earlier day to compare with.
 */
export function kpiTrend(values: ReadonlyArray<number | null>, better: Better, fmt: (n: number) => string = n => String(round1(n))): KpiTrend | null {
  if (values.length === 0) return null;
  const latest = values[values.length - 1];
  if (latest == null) return null;
  const earlier = values.slice(0, -1).filter((v): v is number => v != null);
  if (earlier.length === 0) return null;
  const previousAverage = earlier.reduce((s, v) => s + v, 0) / earlier.length;
  const delta = latest - previousAverage;
  const pct = previousAverage === 0 ? null : (delta / Math.abs(previousAverage)) * 100;
  const flat = Math.abs(delta) < 1e-9 || (pct != null && Math.abs(pct) < FLAT_PCT);
  const direction: KpiTrend["direction"] = flat ? "flat" : delta > 0 ? "up" : "down";
  const tone: KpiTrend["tone"] =
    direction === "flat" || better === "neutral" ? "neutral"
    : (direction === "up") === (better === "higher") ? "good" : "bad";
  const vs = `vs average of previous ${earlier.length}`;
  const text = direction === "flat"
    ? `● Level with average of previous ${earlier.length}`
    : `${direction === "up" ? "▲" : "▼"} ${pct != null ? `${Math.round(Math.abs(pct))}%` : fmt(Math.abs(delta))} ${vs}`;
  return { direction, tone, pct, delta, previousAverage, previousDays: earlier.length, text };
}

/** Production days in each window of the weekly trend. */
export const TREND_WINDOW = 7;
/** Fewest days with a figure for a window's average to count. */
const MIN_WINDOW_FIGURES = 3;

function mean(xs: ReadonlyArray<number | null>): { avg: number; n: number } | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? { avg: v.reduce((s, x) => s + x, 0) / v.length, n: v.length } : null;
}

/**
 * Rolling average over the `window` production days ending at each day
 * (days without a figure left out); null until a window has enough figures.
 * The slide's line (Graeme, 2026-10-26: "the line that tracks it is the
 * last 7 days' average") — smoother than single days, so a real change
 * stands out from one odd shift.
 */
export function rollingAverages(values: ReadonlyArray<number | null>, window = TREND_WINDOW): Array<number | null> {
  return values.map((_, i) => {
    const m = mean(values.slice(Math.max(0, i - window + 1), i + 1));
    return m && m.n >= Math.min(MIN_WINDOW_FIGURES, i + 1) ? m.avg : null;
  });
}

/**
 * The last 7 production days' average against the 7 before (Graeme,
 * 2026-10-26: "the 30% increase ... how it is up to the previous 7 days'
 * average", not just yesterday's number). Falls back to the last day vs the
 * days before it while there isn't two weeks of history.
 */
export function kpiWeekTrend(values: ReadonlyArray<number | null>, better: Better, fmt: (n: number) => string = n => String(round1(n))): KpiTrend | null {
  const recent = mean(values.slice(-TREND_WINDOW));
  const before = mean(values.slice(-2 * TREND_WINDOW, -TREND_WINDOW));
  if (!recent || !before || recent.n < MIN_WINDOW_FIGURES || before.n < MIN_WINDOW_FIGURES) {
    return kpiTrend(values.slice(-TREND_WINDOW), better, fmt);
  }
  const delta = recent.avg - before.avg;
  const pct = before.avg === 0 ? null : (delta / Math.abs(before.avg)) * 100;
  const flat = Math.abs(delta) < 1e-9 || (pct != null && Math.abs(pct) < FLAT_PCT);
  const direction: KpiTrend["direction"] = flat ? "flat" : delta > 0 ? "up" : "down";
  const tone: KpiTrend["tone"] =
    direction === "flat" || better === "neutral" ? "neutral"
    : (direction === "up") === (better === "higher") ? "good" : "bad";
  const avgs = `7-day avg ${fmt(recent.avg)} vs ${fmt(before.avg)}`;
  const text = direction === "flat"
    ? `● Level · ${avgs}`
    : `${direction === "up" ? "▲" : "▼"} ${pct != null ? `${Math.round(Math.abs(pct))}%` : fmt(Math.abs(delta))} · ${avgs}`;
  return { direction, tone, pct, delta, previousAverage: before.avg, previousDays: before.n, text };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Whole calendar days between two YYYY-MM-DD dates (to − from). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * The slide's date line: "Friday 17 October" and, when it isn't yesterday,
 * "3 days ago" — so a Monday meeting says plainly it's Friday's numbers.
 */
export function lastProductionDateLabel(day: string, today: string): { date: string; ago: string } {
  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London",
  });
  const n = daysBetween(day, today);
  const ago = n <= 1 ? "yesterday" : `${n} days ago`;
  return { date: date.replace(",", ""), ago };
}

/** Axis label for one production day: "Fri 17". */
export function trendDayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "Europe/London" })
    .replace(",", "");
}
