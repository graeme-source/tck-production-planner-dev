/**
 * Analytics → KPIs (Graeme, 17 Nov 2026: "KPIs are scattered ... I don't know
 * where to go to see them"). One page, one date range, every production KPI
 * and its targets. This file is the page's pure logic: which KPI is open,
 * where the old addresses land, and the run rate's trend series. Viewing
 * only — no KPI is worked out here; the figures come from the existing
 * endpoints. Tested in kpis-page.test.ts. Objective G.
 */
import { rollingAverages } from "./kpi-trend";
import { kpiBand, type KpiBand } from "./station-kpi-bands";

export const KPIS_PATH = "/analytics/kpis";

export type KpiViewId =
  | "overview"
  | "run-rate"
  | "room"
  | "packing"
  | "wrapping"
  | "efficiency"
  | "defects"
  | "targets";

export interface KpiView {
  id: KpiViewId;
  name: string;
  /** What the number counts, in a few words. */
  unit: string;
  /** Uses the page's date range (the others carry their own). */
  usesPageRange: boolean;
  /** Managers and admins only (the server refuses everyone else). */
  managersOnly?: boolean;
}

/** The switcher, in order. Overview first; All targets last. */
export const KPI_VIEWS: readonly KpiView[] = [
  { id: "overview", name: "All KPIs", unit: "at a glance", usesPageRange: true },
  { id: "run-rate", name: "TCK run rate", unit: "batches an hour", usesPageRange: true },
  { id: "room", name: "Packing & wrapping room", unit: "% of a typical day", usesPageRange: false },
  { id: "packing", name: "Packing speed", unit: "orders an hour", usesPageRange: true },
  { id: "wrapping", name: "Wrapping speed", unit: "packs an hour", usesPageRange: true },
  { id: "efficiency", name: "Team efficiency", unit: "% of standard", usesPageRange: false, managersOnly: true },
  { id: "defects", name: "Defects & waste", unit: "% of packs made", usesPageRange: false },
  { id: "targets", name: "All targets", unit: "every target in one place", usesPageRange: false },
];

export function visibleKpiViews(isManagerOrAdmin: boolean): KpiView[] {
  return KPI_VIEWS.filter(v => !v.managersOnly || isManagerOrAdmin);
}

/** The open KPI from the page's query string; unknown or missing = overview. */
export function parseKpiView(search: string): KpiViewId {
  const id = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("kpi");
  return KPI_VIEWS.some(v => v.id === id) ? (id as KpiViewId) : "overview";
}

/** The page address for a KPI, keeping any other query (team efficiency keeps its own range there). */
export function kpiHref(id: KpiViewId, keep: string = ""): string {
  const q = new URLSearchParams(keep.startsWith("?") ? keep.slice(1) : keep);
  q.delete("kpi");
  const rest = q.toString();
  return id === "overview"
    ? `${KPIS_PATH}${rest ? `?${rest}` : ""}`
    : `${KPIS_PATH}?kpi=${id}${rest ? `&${rest}` : ""}`;
}

/**
 * Where an old KPI address lands now, or null when it isn't one. The old
 * pages' own query (team efficiency's range, say) comes along.
 *   /analytics/production-kpis    → All targets
 *   /analytics/efficiency         → Team efficiency
 *   /analytics/defects            → Defects & waste
 *   /reports?tab=kpis             → TCK run rate (Analytics' old first tab)
 *   /reports?tab=packing-speed    → Packing speed
 */
export function legacyKpiHref(path: string, search: string): string | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (path === "/analytics/production-kpis") return kpiHref("targets");
  if (path === "/analytics/efficiency") return kpiHref("efficiency", q.toString());
  if (path === "/analytics/defects") return kpiHref("defects");
  if (path === "/reports") {
    const tab = q.get("tab");
    if (tab === "kpis") return kpiHref("run-rate");
    if (tab === "packing-speed") return kpiHref("packing");
  }
  return null;
}

// ── TCK run rate trend ──────────────────────────────────────────────────

/** Production days in each point of the rolling line (same as the meeting slide). */
export const RUN_RATE_ROLLING_DAYS = 7;

/** One day from GET /api/reports/production-kpis → dailyDetail. */
export interface RunRateDay {
  date: string;
  bph: number | null;
  activeMinutes: number;
  batches: number;
}

export interface RunRatePoint {
  date: string;
  /** That day's run rate; null when it had no measurable window. */
  daily: number | null;
  /** Average of this day and the production days before it (up to 7). */
  rolling: number | null;
  band: KpiBand;
  batches: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Oldest first, with the rolling average and each day's colour band. */
export function runRateSeries(days: readonly RunRateDay[], standard: number, window = RUN_RATE_ROLLING_DAYS): RunRatePoint[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const rolling = rollingAverages(sorted.map(d => d.bph), window);
  return sorted.map((d, i) => ({
    date: d.date,
    daily: d.bph,
    rolling: rolling[i] == null ? null : round1(rolling[i] as number),
    band: kpiBand({ rate: d.bph, activeMinutes: d.activeMinutes }, standard),
    batches: d.batches,
  }));
}

export interface RangeTrend {
  direction: "up" | "down" | "flat";
  /** Rolling average at the start and end of the range. */
  start: number;
  end: number;
  startDate: string;
  endDate: string;
  change: number;
  pct: number | null;
}

/** Changes smaller than this (in %) read as level. */
const FLAT_PCT = 1;

/**
 * Is the run rate going up or down over the range? The rolling average at
 * the start against the end. The start is the first FULL window (the 7th
 * production day) when the range is long enough, so one odd first day can't
 * set the comparison. Null with fewer than two rolling points.
 */
export function rangeTrend(points: readonly RunRatePoint[], window = RUN_RATE_ROLLING_DAYS): RangeTrend | null {
  const usable = points.length >= window * 2 ? points.slice(window - 1) : points;
  const withRolling = usable.filter((p): p is RunRatePoint & { rolling: number } => p.rolling != null);
  if (withRolling.length < 2) return null;
  const first = withRolling[0];
  const last = withRolling[withRolling.length - 1];
  const change = round1(last.rolling - first.rolling);
  const pct = first.rolling === 0 ? null : ((last.rolling - first.rolling) / first.rolling) * 100;
  const flat = pct == null ? change === 0 : Math.abs(pct) < FLAT_PCT;
  return {
    direction: flat ? "flat" : change > 0 ? "up" : "down",
    start: first.rolling,
    end: last.rolling,
    startDate: first.date,
    endDate: last.date,
    change,
    pct: pct == null ? null : Math.round(pct),
  };
}

/** "Up 8%", "Down 1.5", "Level" — the trend in two words. */
export function trendWords(t: RangeTrend): string {
  if (t.direction === "flat") return "Level";
  const amount = t.pct != null ? `${Math.abs(t.pct)}%` : String(Math.abs(t.change));
  return `${t.direction === "up" ? "Up" : "Down"} ${amount}`;
}

// ── Packing speed range cap ─────────────────────────────────────────────

/**
 * Packing speed reads Shopify live, one call per day of the range
 * (GET /api/reports/packing-speed). A 3-month range is ~93 calls at once —
 * more than Shopify allows, so it fails and can slow the packing screen.
 * The KPIs page asks for at most this many days: the END of the range.
 */
export const PACKING_MAX_DAYS = 31;
/** The overview's packing card: the last week of the range. */
export const PACKING_OVERVIEW_DAYS = 7;

function isoAddDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The last `maxDays` days of from–to (the whole range when it's shorter). */
export function capRange(from: string, to: string, maxDays: number): { from: string; to: string; capped: boolean } {
  const earliest = isoAddDays(to, -(maxDays - 1));
  return from < earliest ? { from: earliest, to, capped: true } : { from, to, capped: false };
}
