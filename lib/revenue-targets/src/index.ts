/**
 * Monthly revenue targets — the pure rules, shared by the API and the screen
 * so Numbers, Sales & Marketing and the server can never disagree
 * (Graeme, 2026-10-08). Objective I (founder command centre: foresight).
 *
 *  - MINIMUM: one figure, the same every month (app_settings
 *    monthly_revenue_target). The line we must not fall below.
 *  - STRETCH: set per month and it CARRIES FORWARD — a month with no stretch
 *    of its own uses the most recent earlier month's, until it's changed.
 *    No stretch set for any earlier month → no stretch line at all.
 *
 * No I/O here — everything is unit-tested in index.test.ts.
 */

/** "YYYY-MM". */
export type MonthKey = string;

/** The minimum when nothing has ever been saved (the figure the app has
 *  always used). The only number written into the code. */
export const DEFAULT_MINIMUM_TARGET = 120000;

export const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(s: unknown): s is MonthKey {
  return typeof s === "string" && MONTH_KEY_RE.test(s);
}

/** The month a YYYY-MM-DD date falls in. */
export function monthOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const idx = y! * 12 + (m! - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** `count` months starting with `start`. */
export function monthsFrom(start: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "November 2026", or "November" with short=true when the year is obvious. */
export function monthLabel(month: MonthKey, opts: { short?: boolean; abbreviated?: boolean } = {}): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[m! - 1] ?? month;
  const shown = opts.abbreviated ? name.slice(0, 3) : name;
  return opts.short ? shown : `${shown} ${y}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

// ── Carry-forward ─────────────────────────────────────────────────────────

/** A stretch target saved for one month. */
export interface StretchRow {
  month: MonthKey;
  stretch: number;
}

export type StretchSource = "set" | "carried" | "none";

export interface ResolvedStretch {
  value: number | null;
  /** "set" = this month has its own; "carried" = from fromMonth; "none". */
  source: StretchSource;
  fromMonth: MonthKey | null;
}

/** The stretch for `month`: its own if set, else the most recent earlier
 *  month's, else none. */
export function resolveStretch(month: MonthKey, rows: readonly StretchRow[]): ResolvedStretch {
  let best: StretchRow | null = null;
  for (const r of rows) {
    if (r.month <= month && (!best || r.month > best.month)) best = r;
  }
  if (!best) return { value: null, source: "none", fromMonth: null };
  return {
    value: best.stretch,
    source: best.month === month ? "set" : "carried",
    fromMonth: best.month,
  };
}

export interface MonthTargets {
  month: MonthKey;
  minimum: number;
  stretch: number | null;
  stretchSource: StretchSource;
  /** The month the stretch figure was set for (itself when "set"). */
  stretchFromMonth: MonthKey | null;
}

export function targetsForMonth(month: MonthKey, minimum: number, rows: readonly StretchRow[]): MonthTargets {
  const r = resolveStretch(month, rows);
  return { month, minimum, stretch: r.value, stretchSource: r.source, stretchFromMonth: r.fromMonth };
}

export function targetsForMonths(months: readonly MonthKey[], minimum: number, rows: readonly StretchRow[]): MonthTargets[] {
  return months.map(m => targetsForMonth(m, minimum, rows));
}

/** The saved minimum as a number, falling back to the default when it's
 *  missing or not a positive number. */
export function minimumFromSetting(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MINIMUM_TARGET;
}

// ── Typing amounts ─────────────────────────────────────────────────────────

/** "150k", "£150,000", "1.5m", "175 000" → pounds. Blank or nonsense → null. */
export function parseAmount(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[£,\s]/g, "");
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(s);
  if (!m) return null;
  const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1;
  const n = Math.round(Number(m[1]) * mult * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatGbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

/** "£8k", "£1.2m", "£950" — for short phrases. */
export function formatGbpShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (a >= 1_000) return `£${Math.round(a / 1_000)}k`;
  return `£${Math.round(a)}`;
}

// ── Editing: what changes, in plain words, and how to undo it ─────────────

export interface TargetChange {
  kind: "minimum" | "stretch";
  /** The month, for a stretch change; null for the minimum. */
  month: MonthKey | null;
  /** The saved value before (null = this month had none of its own). */
  from: number | null;
  /** The saved value after (null = clear this month's own figure). */
  to: number | null;
}

export interface TargetsState {
  minimum: number;
  rows: StretchRow[];
}

/** Every difference between two states, minimum first then by month. */
export function diffTargets(before: TargetsState, after: TargetsState): TargetChange[] {
  const out: TargetChange[] = [];
  if (before.minimum !== after.minimum) {
    out.push({ kind: "minimum", month: null, from: before.minimum, to: after.minimum });
  }
  const b = new Map(before.rows.map(r => [r.month, r.stretch]));
  const a = new Map(after.rows.map(r => [r.month, r.stretch]));
  const months = [...new Set([...b.keys(), ...a.keys()])].sort();
  for (const month of months) {
    const from = b.get(month) ?? null;
    const to = a.get(month) ?? null;
    if (from !== to) out.push({ kind: "stretch", month, from, to });
  }
  return out;
}

/** Apply changes to a state (what the server does, minus the database). */
export function applyChanges(state: TargetsState, changes: readonly TargetChange[]): TargetsState {
  let minimum = state.minimum;
  const rows = new Map(state.rows.map(r => [r.month, r.stretch]));
  for (const c of changes) {
    if (c.kind === "minimum") { if (c.to != null) minimum = c.to; continue; }
    if (!c.month) continue;
    if (c.to == null) rows.delete(c.month);
    else rows.set(c.month, c.to);
  }
  return {
    minimum,
    rows: [...rows.entries()].map(([month, stretch]) => ({ month, stretch })).sort((x, y) => x.month.localeCompare(y.month)),
  };
}

/** The changes that put everything back (for Undo). */
export function invertChanges(changes: readonly TargetChange[]): TargetChange[] {
  return changes.map(c => ({ ...c, from: c.to, to: c.from }));
}

/** One line per change, e.g. "Minimum: £120,000 → £130,000" and
 *  "November 2026 stretch: £150,000 (same as October) → £175,000". The
 *  carried-forward figure is shown so "cleared" never reads as "zero". */
export function describeChanges(before: TargetsState, changes: readonly TargetChange[]): string[] {
  const after = applyChanges(before, changes);
  return changes.map(c => {
    if (c.kind === "minimum") {
      return `Minimum (every month): ${formatGbp(c.from ?? before.minimum)} → ${formatGbp(c.to ?? before.minimum)}`;
    }
    const month = c.month!;
    const was = resolveStretch(month, before.rows);
    const now = resolveStretch(month, after.rows);
    return `${monthLabel(month)} stretch: ${stretchPhrase(was)} → ${stretchPhrase(now)}`;
  });
}

function stretchPhrase(r: ResolvedStretch): string {
  if (r.value == null) return "none";
  if (r.source === "carried") return `${formatGbp(r.value)} (same as ${monthLabel(r.fromMonth!, { short: true })})`;
  return formatGbp(r.value);
}

/** Months (from `months`) whose stretch would end up at or below the
 *  minimum — a stretch has to be above the line it stretches past. */
export function stretchBelowMinimum(state: TargetsState, months: readonly MonthKey[]): MonthKey[] {
  return months.filter(m => {
    const r = resolveStretch(m, state.rows);
    return r.value != null && r.value <= state.minimum;
  });
}

// ── Pace against both targets ──────────────────────────────────────────────

export interface PaceInput {
  /** Sales so far this month. */
  monthToDate: number;
  /** Projected month-end (the sales summary's estimate). */
  projected: number;
  /** Today's day of the month (1-based). */
  dayOfMonth: number;
  daysInMonth: number;
}

export interface TargetPace {
  target: number;
  /** Share of the target already sold, 0–100+ (not capped). */
  pctDone: number;
  /** Projected month-end minus the target: positive = over, negative = short. */
  projectedGap: number;
  onPace: boolean;
  /** What each remaining day needs to average to still reach it. */
  neededPerDay: number;
}

/** The same sums the pace card has always done, for any one target. */
export function paceAgainst(target: number, input: PaceInput): TargetPace {
  const daysLeft = Math.max(0, input.daysInMonth - input.dayOfMonth);
  return {
    target,
    pctDone: target > 0 ? (input.monthToDate / target) * 100 : 0,
    projectedGap: input.projected - target,
    onPace: input.projected >= target,
    neededPerDay: Math.max(0, (target - input.monthToDate) / Math.max(1, daysLeft)),
  };
}

export interface TwoTargetPace {
  minimum: TargetPace;
  stretch: TargetPace | null;
  /** Plain English: "On pace for the minimum, £8k short of stretch". */
  headline: string;
  tone: "stretch" | "minimum" | "behind";
  /** Where on a 0–100 bar each thing sits. The bar's full width is the
   *  larger of the stretch and month-to-date, so both markers fit. */
  bar: {
    scale: number;
    fillPct: number;
    minimumPct: number;
    stretchPct: number | null;
    /** Where month-to-date should be by today to reach the minimum. */
    minimumTodayPct: number;
  };
}

export function paceAgainstTargets(input: PaceInput, minimum: number, stretch: number | null): TwoTargetPace {
  const min = paceAgainst(minimum, input);
  const str = stretch != null ? paceAgainst(stretch, input) : null;

  let headline: string;
  let tone: TwoTargetPace["tone"];
  if (str?.onPace) {
    tone = "stretch";
    headline = str.projectedGap >= 1000
      ? `On pace for stretch, ${formatGbpShort(str.projectedGap)} over`
      : "On pace for stretch";
  } else if (min.onPace) {
    tone = "minimum";
    headline = str
      ? `On pace for the minimum, ${formatGbpShort(-str.projectedGap)} short of stretch`
      : min.projectedGap >= 1000
        ? `On pace for the minimum, ${formatGbpShort(min.projectedGap)} over`
        : "On pace for the minimum";
  } else {
    tone = "behind";
    headline = `${formatGbpShort(-min.projectedGap)} short of the minimum at this pace`;
  }

  const scale = Math.max(minimum, stretch ?? 0, input.monthToDate, 1);
  const pct = (n: number) => Math.min(100, Math.max(0, (n / scale) * 100));
  const shareOfMonth = input.daysInMonth > 0 ? Math.min(1, input.dayOfMonth / input.daysInMonth) : 0;
  return {
    minimum: min,
    stretch: str,
    headline,
    tone,
    bar: {
      scale,
      fillPct: pct(input.monthToDate),
      minimumPct: pct(minimum),
      stretchPct: stretch != null ? pct(stretch) : null,
      minimumTodayPct: pct(minimum * shareOfMonth),
    },
  };
}
