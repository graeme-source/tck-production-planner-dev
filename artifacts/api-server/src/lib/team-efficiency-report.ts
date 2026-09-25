/**
 * Team efficiency — the analytics report and who may see what (Objective I;
 * pure, no I/O).
 *
 *   - Headline: the last 7 counted production days as one ratio of sums
 *     ÷ the standard, against the 7 before them.
 *   - Daily detail, with each day's rolling 7-day figure.
 *   - Weekly (Monday-start) and monthly figures, each a ratio of sums over
 *     counted days — never an average of percentages, so a short day can't
 *     outweigh a long one.
 *   - Days that are pending approval, flagged (uncounted output) or had no
 *     approved hours are shown but never counted.
 *
 * CONFIDENTIAL: pounds (value credited, labour cost, made/despatched value)
 * and R (value per £1 of labour) are the founder's alone. viewerReport()
 * rebuilds the report from an ALLOW-list, so a £ field added to the full
 * report later stays hidden from everyone else unless someone deliberately
 * lists it here.
 */
import { dailyEfficiency } from "./team-efficiency";
import { weekStart, addDaysIso, daysBetween } from "./team-efficiency-labour";
import type { DayFlag, DayStatus } from "./team-efficiency-day";

export interface StoredDay {
  date: string;
  status: DayStatus;
  flags: DayFlag[];
  packsByLine: Record<string, number>;
  eightPackBags: number;
  ordersDespatched: number;
  packsDespatched: number;
  efficiencyPct: number | null;
  // ── founder-only ──
  ratio: number | null;
  valueCredited: number;
  valueMadeNet: number;
  valueDespatchedNet: number;
  labourCost: number;
  paidHours: number;
}

export interface ReportDay extends StoredDay {
  rollingPct: number | null;
}

export interface PeriodFigure {
  /** Week start (YYYY-MM-DD, Monday) or month (YYYY-MM). */
  period: string;
  pct: number | null;
  countedDays: number;
  flaggedDays: number;
  packs: number;
  orders: number;
  // ── founder-only ──
  ratio: number | null;
  valueCredited: number;
  labourCost: number;
}

export interface Headline {
  /** "rolling7": the last 7 counted production days vs the 7 before.
   *  "range": the chosen date range vs the same-length period before it. */
  kind: "rolling7" | "range";
  pct: number | null;
  previousPct: number | null;
  /** pct − previousPct, in percentage points. */
  changePts: number | null;
  /** The days behind the headline (counted days for rolling7, the range for range). */
  from: string | null;
  to: string | null;
  /** The comparison period ("range" only). */
  previousFrom?: string | null;
  previousTo?: string | null;
}

export interface TeamEfficiencyReport {
  range: { from: string; to: string };
  headline: Headline;
  days: ReportDay[];
  weekly: PeriodFigure[];
  monthly: PeriodFigure[];
}

export type RangeKey = "30d" | "3m" | "6m" | "12m";

export const RANGE_DAYS: Record<RangeKey, number> = { "30d": 30, "3m": 91, "6m": 182, "12m": 365 };

export function rangeFrom(range: RangeKey, today: string): string {
  return addDaysIso(today, -RANGE_DAYS[range]);
}

const counted = (d: StoredDay) => d.status === "ok" && d.labourCost > 0;

function periodFigure(period: string, days: StoredDay[], standard: number): PeriodFigure {
  const kept = days.filter(counted);
  const credited = kept.reduce((n, d) => n + d.valueCredited, 0);
  const labour = kept.reduce((n, d) => n + d.labourCost, 0);
  const ratio = labour > 0 ? credited / labour : null;
  return {
    period,
    pct: ratio != null && standard > 0 ? (ratio / standard) * 100 : null,
    countedDays: kept.length,
    flaggedDays: days.length - kept.length,
    packs: days.reduce((n, d) => n + Object.values(d.packsByLine).reduce((a, b) => a + b, 0), 0),
    orders: days.reduce((n, d) => n + d.ordersDespatched, 0),
    ratio,
    valueCredited: credited,
    labourCost: labour,
  };
}

function groupBy(days: StoredDay[], key: (d: StoredDay) => string): Map<string, StoredDay[]> {
  const m = new Map<string, StoredDay[]>();
  for (const d of days) {
    const k = key(d);
    const list = m.get(k) ?? [];
    list.push(d);
    m.set(k, list);
  }
  return m;
}

export function headline(history: StoredDay[], standard: number, window = 7): Headline {
  const kept = history.filter(counted);
  const pctOf = (xs: StoredDay[]) => {
    const labour = xs.reduce((n, d) => n + d.labourCost, 0);
    if (xs.length === 0 || labour <= 0 || standard <= 0) return null;
    return (xs.reduce((n, d) => n + d.valueCredited, 0) / labour / standard) * 100;
  };
  const last = kept.slice(-window);
  const prev = kept.slice(-2 * window, -window);
  const pct = pctOf(last);
  const previousPct = prev.length === window ? pctOf(prev) : null;
  return {
    kind: "rolling7",
    pct,
    previousPct,
    changePts: pct != null && previousPct != null ? pct - previousPct : null,
    from: last[0]?.date ?? null,
    to: last[last.length - 1]?.date ?? null,
  };
}

// ── Custom date ranges ────────────────────────────────────────────────────

/** A range's own figure, value-weighted: total credited ÷ total labour over
 *  its counted days ÷ standard — never a mean of daily percentages. */
export function rangeFigure(history: StoredDay[], standard: number, from: string, to: string): PeriodFigure {
  return periodFigure(`${from}..${to}`, history.filter(d => d.date >= from && d.date <= to), standard);
}

/** The same number of calendar days immediately before [from, to]. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to) + 1;
  return { from: addDaysIso(from, -len), to: addDaysIso(from, -1) };
}

/** Headline for a chosen range: its value-weighted figure against the
 *  same-length period before it (no comparison when that has no counted days). */
export function rangeHeadline(history: StoredDay[], standard: number, from: string, to: string): Headline {
  const now = rangeFigure(history, standard, from, to);
  const prev = previousPeriod(from, to);
  const before = rangeFigure(history, standard, prev.from, prev.to);
  const previousPct = before.countedDays > 0 ? before.pct : null;
  return {
    kind: "range",
    pct: now.pct,
    previousPct,
    changePts: now.pct != null && previousPct != null ? now.pct - previousPct : null,
    from, to,
    previousFrom: prev.from, previousTo: prev.to,
  };
}

/**
 * Keep a requested range inside the stored history [min, max] (the first and
 * latest computed days). Returns null when nothing of it overlaps. Swaps an
 * end that comes before its start.
 */
export function clampRange(
  from: string, to: string, bounds: { min: string | null; max: string | null },
): { from: string; to: string } | null {
  let f = from <= to ? from : to;
  let t = from <= to ? to : from;
  if (bounds.min && f < bounds.min) f = bounds.min;
  if (bounds.max && t > bounds.max) t = bounds.max;
  return f <= t ? { from: f, to: t } : null;
}

/**
 * The full report over [from, to]. `history` is every stored day in date
 * order (the rolling figure at the start of the range needs the days before
 * it); days outside the range only feed the rolling window.
 */
export function buildReport(
  history: StoredDay[], standard: number, from: string, to: string,
  opts: { headline?: "rolling7" | "range" } = {},
): TeamEfficiencyReport {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const rolling = dailyEfficiency(
    sorted.map(d => ({ date: d.date, credited: d.valueCredited, labourCost: d.labourCost, exclude: !counted(d) })),
    standard,
  );
  const rollingByDate = new Map(rolling.map(r => [r.date, r.rollingPct]));
  const inRange = sorted.filter(d => d.date >= from && d.date <= to);
  const days: ReportDay[] = inRange.map(d => ({
    ...d,
    // Rolling only means something once the day itself has been counted.
    rollingPct: d.status === "pending" ? null : rollingByDate.get(d.date) ?? null,
  }));

  const weeks = groupBy(inRange, d => weekStart(d.date));
  const months = groupBy(inRange, d => d.date.slice(0, 7));

  return {
    range: { from, to },
    headline: opts.headline === "range"
      ? rangeHeadline(sorted, standard, from, to)
      : headline(sorted.filter(d => d.date <= to), standard),
    days,
    weekly: [...weeks].map(([k, v]) => periodFigure(k, v, standard)),
    monthly: [...months].map(([k, v]) => periodFigure(k, v, standard)),
  };
}

// ── Who sees what ─────────────────────────────────────────────────────────

/** Keys that carry pounds or R. Listed for the regression test; the viewer
 *  report is built from an allow-list, not by deleting these. */
export const FOUNDER_ONLY_KEYS = [
  "ratio", "valueCredited", "valueMadeNet", "valueDespatchedNet", "labourCost", "paidHours",
] as const;

export type ViewerDay = Pick<ReportDay,
  "date" | "status" | "flags" | "packsByLine" | "eightPackBags" | "ordersDespatched" | "packsDespatched" | "efficiencyPct" | "rollingPct">;
export type ViewerPeriod = Pick<PeriodFigure, "period" | "pct" | "countedDays" | "flaggedDays" | "packs" | "orders">;

export interface ViewerReport {
  range: { from: string; to: string };
  headline: Headline;
  days: ViewerDay[];
  weekly: ViewerPeriod[];
  monthly: ViewerPeriod[];
}

export function viewerReport(r: TeamEfficiencyReport): ViewerReport {
  const day = (d: ReportDay): ViewerDay => ({
    date: d.date,
    status: d.status,
    flags: d.flags.map(f => ({ code: f.code, ...(f.line ? { line: f.line } : {}), message: f.message })),
    packsByLine: { ...d.packsByLine },
    eightPackBags: d.eightPackBags,
    ordersDespatched: d.ordersDespatched,
    packsDespatched: d.packsDespatched,
    efficiencyPct: d.efficiencyPct,
    rollingPct: d.rollingPct,
  });
  const period = (p: PeriodFigure): ViewerPeriod => ({
    period: p.period, pct: p.pct, countedDays: p.countedDays, flaggedDays: p.flaggedDays, packs: p.packs, orders: p.orders,
  });
  return {
    range: { ...r.range },
    // Built field by field like the rest: a £ figure added to the headline
    // later must not ride along.
    headline: {
      kind: r.headline.kind,
      pct: r.headline.pct,
      previousPct: r.headline.previousPct,
      changePts: r.headline.changePts,
      from: r.headline.from,
      to: r.headline.to,
      ...(r.headline.kind === "range" ? { previousFrom: r.headline.previousFrom ?? null, previousTo: r.headline.previousTo ?? null } : {}),
    },
    days: r.days.map(day),
    weekly: r.weekly.map(period),
    monthly: r.monthly.map(period),
  };
}
