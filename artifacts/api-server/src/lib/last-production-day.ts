/**
 * "Last production day" for the morning meeting's numbers slide (Graeme,
 * 2026-10-22): "change 'yesterday' to 'last production', because sometimes
 * it's over the weekend", plus a 7-production-day trend for each KPI.
 *
 * A production day is found from the DATA, never from weekday rules: a plan
 * date counts when the main kitchen recorded same-day production on it (a
 * batch completion at a station that works on that day's plan). Weekends,
 * days off and bank holidays drop out by themselves because nothing was
 * made. Pure — the DB loader lives in services/last-production-kpis.ts.
 */
import { countsInKpis } from "@workspace/production-schedule";

/**
 * Stations that work AHEAD on the next day's plan (station planning logic:
 * dough prep uses tomorrow's plan). A completion there is logged against a
 * plan date that hasn't been produced yet, so it never makes that date a
 * production day — otherwise Thursday's dough, prepped on Wednesday, would
 * make Thursday "the last production day" on Thursday morning's meeting.
 */
export const PREP_AHEAD_STATIONS: readonly string[] = ["dough_prep", "main_prep", "prep", "prep_bases"];

export interface ProductionActivityRow {
  /** Plan date, YYYY-MM-DD. */
  date: string;
  stationType: string | null;
  recipeCategory: string | null;
  excludeFromKpis?: boolean | null;
}

/** The plan dates that had real same-day production in the main kitchen. */
export function productionDates(rows: readonly ProductionActivityRow[]): string[] {
  const dates = new Set<string>();
  for (const r of rows) {
    if (r.stationType && PREP_AHEAD_STATIONS.includes(r.stationType)) continue;
    // Main kitchen only (kitchen-scope rule) — fried chicken is made in a
    // separate facility, and cinnamon buns are out of every KPI.
    if (!countsInKpis(r.recipeCategory, r.excludeFromKpis)) continue;
    dates.add(r.date);
  }
  return [...dates].sort();
}

/**
 * The last `count` production days strictly BEFORE `today`, oldest first —
 * the final entry is the last production day. Empty when there is no
 * history yet (the slide shows a friendly empty state).
 */
export function lastProductionDays(today: string, activeDates: readonly string[], count = 7): string[] {
  const before = [...new Set(activeDates)].filter(d => d < today).sort();
  return before.slice(Math.max(0, before.length - count));
}

/** The most recent production day before `today`, or null with no history. */
export function pickLastProductionDay(today: string, activeDates: readonly string[]): string | null {
  const days = lastProductionDays(today, activeDates, 1);
  return days[0] ?? null;
}

/** Whole calendar days between two YYYY-MM-DD dates (to − from). */
export function calendarDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** YYYY-MM-DD shifted by whole calendar days. */
export function addCalendarDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Per-day KPI series ────────────────────────────────────────────────

/** The figures for one production day, exactly as the headline tiles show them. */
export interface ProductionDayKpis {
  builderBatchesPerHour: number | null;
  packingBatchesPerHour: number | null;
  wonkyCount: number;
  dogBinCount: number;
  shortCount: number;
  leftoverFillingGrams: number;
  batchesTarget: number;
  improvementsCompleted: number | null;
  defects: { count: number; pct: number | null; packsMade: number } | null;
}

/** One line per KPI tile key (same keys as the slide's KPI catalogue). */
export type KpiSeriesKey =
  | "builder_rate" | "packing_rate" | "wonkies" | "dog_bins" | "defects"
  | "improvements" | "batches" | "shorts" | "leftover";

export type KpiSeries = Record<KpiSeriesKey, Array<number | null>>;

/**
 * Turn per-day figures into one series per KPI, in `days` order. A day with
 * no figures (lookup failed) is null throughout — a gap, never a fake zero.
 * Defects trend on the RATE (% of packs made), not the count, so a big day
 * doesn't look worse just for being big.
 */
export function kpiSeries(days: readonly string[], byDay: ReadonlyMap<string, ProductionDayKpis>): KpiSeries {
  const pick = (f: (k: ProductionDayKpis) => number | null) =>
    days.map(d => { const k = byDay.get(d); return k ? f(k) : null; });
  return {
    builder_rate: pick(k => k.builderBatchesPerHour),
    packing_rate: pick(k => k.packingBatchesPerHour),
    wonkies: pick(k => k.wonkyCount),
    dog_bins: pick(k => k.dogBinCount),
    defects: pick(k => k.defects?.pct ?? null),
    improvements: pick(k => k.improvementsCompleted),
    batches: pick(k => k.batchesTarget),
    shorts: pick(k => k.shortCount),
    leftover: pick(k => k.leftoverFillingGrams),
  };
}

/** Group timestamped rows by their London calendar date. */
export function groupByLondonDate<T>(rows: readonly T[], at: (row: T) => Date, londonDate: (d: Date) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const key = londonDate(at(r));
    const list = out.get(key);
    if (list) list.push(r); else out.set(key, [r]);
  }
  return out;
}
