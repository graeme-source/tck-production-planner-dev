/**
 * Clean prep durations and per-item prep rates (Graeme, 27 Oct 2026 — "if
 * that happens consistently, we can be fairly confident"; Objectives C and
 * I). Pure; services/prep-times-report.ts loads the sessions
 * (prep_sessions, written by the prep screens — lib/prep-session-rules.ts).
 *
 * A session's prep time, step by step:
 *   1. Only sessions that completed something count (a tick or a finished
 *      make flow). Its span is first opened → latest completion.
 *   2. Idle gaps come out: the session's pauses (moved off the item and came
 *      back within 15 minutes) and the person's recorded breaks (Snack /
 *      Lunch on any station; a break nobody ended counts at most
 *      UNENDED_BREAK_MS).
 *   3. The 30-second rule (Graeme, 27 Oct 2026), on what's left:
 *        - opened and closed again inside MIN_SESSION_MS without completing:
 *          a QUICK LOOK (someone checking the numbers) — ignored entirely;
 *        - completed inside MIN_SESSION_MS: a QUICK COMPLETION — the tick
 *          stands, but it's left out of every average and counted per item
 *          instead (likely a ready-made or check-only item);
 *        - over MAX_SESSION_MS it was left open, and is ignored.
 *      A completion with nothing opened (flagged completed_without_open,
 *      lib/prep-session-rules.ts) is never timed, only counted per item.
 *   4. Where the same person had two sessions running at once (two items,
 *      or two iPads), the overlapping time is split evenly between them —
 *      never counted twice.
 *
 * Per item: the median session and its middle 50%, and the rate used for
 * costing — minutes per kg (or per piece) as total minutes ÷ total amount
 * over its sessions, after dropping sessions whose own rate is a Tukey
 * outlier (beyond 1.5 × the middle-50% spread; only with RATE_TRIM_MIN
 * sessions or more). Total ÷ total, not a median of rates, because small
 * top-ups carry the same set-up time as big batches and would otherwise
 * make a kilo look dearer than it is.
 */
import { gramsOrNull } from "@workspace/units";
import { COMPLETED_WITHOUT_OPEN, MAX_SESSION_MS } from "./prep-session-rules";
import { countUnitOf } from "./prep-usage";

export { COMPLETED_WITHOUT_OPEN, MAX_SESSION_MS };

/** Under this, a session isn't timed prep: a quick look when nothing was
 *  completed, a quick completion when something was (step 3 above). */
export const MIN_SESSION_MS = 30_000;
/** A break with no end counts as at most this long. */
export const UNENDED_BREAK_MS = 45 * 60_000;
/** Fewer sessions than this: "needs more data". */
export const ENOUGH_SESSIONS = 8;
/** This many, and consistent: "confident". */
export const CONFIDENT_SESSIONS = 20;
/** Outlier trimming of per-kg rates needs at least this many sessions. */
export const RATE_TRIM_MIN = 4;

export interface TimingSession {
  id: number;
  userId: number | null;
  itemKey: string;
  /** Epoch ms. */
  openedAt: number;
  /** Latest completion, epoch ms; null = nothing completed. */
  completedAt: number | null;
  /** When the person last moved off it, epoch ms; null = still open (or
   *  the screen went away without saying). */
  closedAt: number | null;
  pauses: ReadonlyArray<{ from: number; to: number }>;
  /** One entry per completion: what it prepared (quantity may be unknown). */
  amounts: ReadonlyArray<{ quantity: number | null; unit: string | null }>;
  /** COMPLETED_WITHOUT_OPEN for a completion made with nothing opened. */
  flag?: string | null;
}

export interface TimingBreak {
  userId: number;
  from: number;
  /** null = the break was never ended. */
  to: number | null;
}

export type ExcludedReason =
  /** Opened and closed again inside 30 s without completing — ignored. */
  | "quick_look"
  /** Opened for 30 s or more (or never closed) without completing. */
  | "not_completed"
  /** Completed inside 30 s — the tick stands, the time isn't averaged. */
  | "quick_completion"
  /** Over two hours — left open. */
  | "too_long"
  /** A completion with nothing opened (flag-and-allow). */
  | "completed_without_open";

export interface CleanSession {
  id: number;
  userId: number | null;
  itemKey: string;
  /** Prep minutes after idle gaps and shared time. */
  minutes: number;
  /** Before overlaps were shared (after idle gaps). */
  activeMinutes: number;
  /** What was prepared: grams when weighed, else a count; null = not known. */
  grams: number | null;
  count: number | null;
  countUnit: string | null;
  completedAt: number;
  /** A pause or a break was taken out of it. */
  hadIdleGap: boolean;
  /** Another of the same person's sessions ran alongside it. */
  shared: boolean;
}

type Interval = [number, number];

/** [start, end) minus every cut, as sorted disjoint intervals. */
export function subtractIntervals(base: Interval, cuts: ReadonlyArray<Interval>): Interval[] {
  let pieces: Interval[] = base[1] > base[0] ? [base] : [];
  for (const [cs, ce] of cuts) {
    if (!(ce > cs)) continue;
    const next: Interval[] = [];
    for (const [s, e] of pieces) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    pieces = next;
  }
  return pieces;
}

const span = (intervals: ReadonlyArray<Interval>) => intervals.reduce((n, [s, e]) => n + (e - s), 0);

/** Overlapping time split evenly among everything running at that moment:
 *  each session's share, in ms. Intervals within one session are disjoint. */
export function shareOverlaps(sessions: ReadonlyMap<number, ReadonlyArray<Interval>>): Map<number, { ms: number; shared: boolean }> {
  const events: Array<{ t: number; id: number; delta: 1 | -1 }> = [];
  for (const [id, intervals] of sessions) {
    for (const [s, e] of intervals) {
      if (e <= s) continue;
      events.push({ t: s, id, delta: 1 }, { t: e, id, delta: -1 });
    }
  }
  // Ends before starts at the same instant: touching isn't overlapping.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  const out = new Map<number, { ms: number; shared: boolean }>();
  for (const id of sessions.keys()) out.set(id, { ms: 0, shared: false });
  const active = new Set<number>();
  let prev: number | null = null;
  for (const ev of events) {
    if (prev != null && ev.t > prev && active.size > 0) {
      const each = (ev.t - prev) / active.size;
      for (const id of active) {
        const row = out.get(id)!;
        row.ms += each;
        if (active.size > 1) row.shared = true;
      }
    }
    prev = ev.t;
    if (ev.delta === 1) active.add(ev.id); else active.delete(ev.id);
  }
  return out;
}

/** What a session prepared, summed over its completions. Unknown if any
 *  completion's amount is unknown, or the counts are in different units. */
export function sessionAmount(amounts: TimingSession["amounts"]): { grams: number | null; count: number | null; countUnit: string | null } {
  if (amounts.length === 0 || amounts.some(a => a.quantity == null)) return { grams: null, count: null, countUnit: null };
  let grams = 0;
  let count = 0;
  let countUnit: string | null = null;
  let weighed = false;
  let counted = false;
  for (const a of amounts) {
    const g = gramsOrNull(a.quantity!, a.unit);
    if (g != null) { grams += g; weighed = true; continue; }
    const cu = countUnitOf(a.unit);
    if (countUnit != null && countUnit !== cu) return { grams: null, count: null, countUnit: null };
    countUnit = cu;
    count += a.quantity!;
    counted = true;
  }
  if (weighed && counted) return { grams: null, count: null, countUnit: null };
  return weighed ? { grams, count: null, countUnit: null } : { grams: null, count, countUnit };
}

export interface CleanResult {
  clean: CleanSession[];
  excluded: Record<ExcludedReason, number>;
  /** Per item: completions made inside 30 s — kept as ticks, never averaged. */
  quickCompletionsByItem: Map<string, number>;
  /** Per item: completions made with nothing opened (flagged). */
  unopenedByItem: Map<string, number>;
}

export function cleanSessions(
  sessions: ReadonlyArray<TimingSession>,
  breaks: ReadonlyArray<TimingBreak>,
): CleanResult {
  const excluded: Record<ExcludedReason, number> = {
    quick_look: 0, not_completed: 0, quick_completion: 0, too_long: 0, completed_without_open: 0,
  };
  const quickCompletionsByItem = new Map<string, number>();
  const unopenedByItem = new Map<string, number>();
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  const breaksByUser = new Map<number, Interval[]>();
  for (const b of breaks) {
    const list = breaksByUser.get(b.userId) ?? [];
    list.push([b.from, b.to ?? b.from + UNENDED_BREAK_MS]);
    breaksByUser.set(b.userId, list);
  }
  /** [start, end] less the session's pauses and the person's breaks. */
  const activeIntervals = (s: TimingSession, end: number) => subtractIntervals(
    [s.openedAt, end],
    [...s.pauses.map(p => [p.from, p.to] as Interval), ...(s.userId != null ? breaksByUser.get(s.userId) ?? [] : [])],
  );

  const kept: Array<{ s: TimingSession; intervals: Interval[]; activeMs: number; hadIdleGap: boolean }> = [];
  for (const s of sessions) {
    if (s.flag === COMPLETED_WITHOUT_OPEN) {
      excluded.completed_without_open++;
      bump(unopenedByItem, s.itemKey);
      continue;
    }
    if (s.completedAt == null || s.amounts.length === 0) {
      // Opened, nothing completed: a quick look if closed again inside 30 s.
      const quickLook = s.closedAt != null && span(activeIntervals(s, s.closedAt)) < MIN_SESSION_MS;
      excluded[quickLook ? "quick_look" : "not_completed"]++;
      continue;
    }
    const intervals = activeIntervals(s, s.completedAt);
    const activeMs = span(intervals);
    if (activeMs < MIN_SESSION_MS) {
      excluded.quick_completion++;
      bump(quickCompletionsByItem, s.itemKey);
      continue;
    }
    if (activeMs > MAX_SESSION_MS) { excluded.too_long++; continue; }
    const wall = Math.max(0, s.completedAt - s.openedAt);
    kept.push({ s, intervals, activeMs, hadIdleGap: activeMs < wall });
  }

  // Share overlaps per person (an unknown person shares with nobody).
  const shares = new Map<number, { ms: number; shared: boolean }>();
  const byUser = new Map<number, Map<number, Interval[]>>();
  for (const k of kept) {
    if (k.s.userId == null) { shares.set(k.s.id, { ms: k.activeMs, shared: false }); continue; }
    const m = byUser.get(k.s.userId) ?? new Map<number, Interval[]>();
    m.set(k.s.id, k.intervals);
    byUser.set(k.s.userId, m);
  }
  for (const m of byUser.values()) for (const [id, v] of shareOverlaps(m)) shares.set(id, v);

  const clean = kept.map(({ s, activeMs, hadIdleGap }) => {
    const share = shares.get(s.id) ?? { ms: activeMs, shared: false };
    return {
      id: s.id,
      userId: s.userId,
      itemKey: s.itemKey,
      minutes: share.ms / 60_000,
      activeMinutes: activeMs / 60_000,
      ...sessionAmount(s.amounts),
      completedAt: s.completedAt!,
      hadIdleGap,
      shared: share.shared,
    };
  });
  return { clean, excluded, quickCompletionsByItem, unopenedByItem };
}

/** Linear-interpolated quantile of an ascending list (p in 0…1). */
export function quantile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface Spread { median: number; q1: number; q3: number }

export function spreadOf(values: ReadonlyArray<number>): Spread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75) };
}

/** Indices of values inside the Tukey fences (all of them below RATE_TRIM_MIN). */
export function withinFences(values: ReadonlyArray<number>): boolean[] {
  if (values.length < RATE_TRIM_MIN) return values.map(() => true);
  const s = spreadOf(values)!;
  const iqr = s.q3 - s.q1;
  const lo = s.q1 - 1.5 * iqr;
  const hi = s.q3 + 1.5 * iqr;
  return values.map(v => v >= lo && v <= hi);
}

export type Confidence = "needs_more_data" | "settling" | "confident";

/** How far to trust an item's figure: enough sessions, and consistent (the
 *  middle half of sessions within ±50% of the median, roughly). */
export function confidenceFor(sessions: number, spread: Spread | null): Confidence {
  if (sessions < ENOUGH_SESSIONS || !spread) return "needs_more_data";
  const consistent = spread.median > 0 && (spread.q3 - spread.q1) <= spread.median;
  return sessions >= CONFIDENT_SESSIONS && consistent ? "confident" : "settling";
}

export interface ItemRate {
  /** Minutes per kg (weighed items) — total ÷ total after trimming. */
  minutesPerKg: number | null;
  /** Minutes per counted unit, and the unit. */
  minutesPerCount: number | null;
  countUnit: string | null;
  /** Sessions behind the rate, and how many were trimmed as outliers. */
  rateSessions: number;
  trimmed: number;
  /** Spread of the per-session rates (per kg or per count). */
  rateSpread: Spread | null;
}

export interface ItemTiming {
  itemKey: string;
  /** Timed sessions (30 s or more, under two hours). */
  sessions: number;
  /** Their minutes — null when the item has no timed session yet. */
  minutes: Spread | null;
  rate: ItemRate;
  confidence: Confidence;
  /** Completions inside 30 s: kept as ticks, never averaged — likely a
   *  ready-made or check-only item. */
  quickCompletions: number;
  /** Completions made with nothing opened (flag-and-allow). */
  unopenedCompletions: number;
  /** London days with a timed session for this item. */
  days: number;
  people: number;
  /** Latest timed session, epoch ms; null when none. */
  lastAt: number | null;
}

const NO_RATE: ItemRate = { minutesPerKg: null, minutesPerCount: null, countUnit: null, rateSessions: 0, trimmed: 0, rateSpread: null };

/** Total ÷ total over the sessions whose own rate isn't an outlier. */
export function rateFrom(points: ReadonlyArray<{ minutes: number; amount: number }>): { rate: number | null; used: number; trimmed: number; spread: Spread | null } {
  const usable = points.filter(p => p.amount > 0 && p.minutes > 0);
  if (usable.length === 0) return { rate: null, used: 0, trimmed: 0, spread: null };
  const rates = usable.map(p => p.minutes / p.amount);
  const keep = withinFences(rates);
  let mins = 0;
  let amt = 0;
  let used = 0;
  usable.forEach((p, i) => { if (keep[i]) { mins += p.minutes; amt += p.amount; used++; } });
  return { rate: amt > 0 ? mins / amt : null, used, trimmed: usable.length - used, spread: spreadOf(rates) };
}

/** An item's timing. `counts` are its quick and unopened completions
 *  (cleanSessions' per-item maps); an item with only those still gets an
 *  entry — no minutes, but the counts say what's going on. Null when there
 *  is nothing at all. */
export function summariseItem(
  itemKey: string,
  sessions: ReadonlyArray<CleanSession>,
  dayOf: (ms: number) => string,
  counts: { quickCompletions?: number; unopenedCompletions?: number } = {},
): ItemTiming | null {
  const quickCompletions = counts.quickCompletions ?? 0;
  const unopenedCompletions = counts.unopenedCompletions ?? 0;
  if (sessions.length === 0) {
    if (quickCompletions === 0 && unopenedCompletions === 0) return null;
    return {
      itemKey, sessions: 0, minutes: null, rate: NO_RATE, confidence: "needs_more_data",
      quickCompletions, unopenedCompletions, days: 0, people: 0, lastAt: null,
    };
  }
  const minutes = spreadOf(sessions.map(s => s.minutes))!;
  const weighed = rateFrom(sessions.filter(s => s.grams != null).map(s => ({ minutes: s.minutes, amount: s.grams! / 1000 })));
  // Counted items: the most common count unit wins (normally the only one).
  const unitCounts = new Map<string, number>();
  for (const s of sessions) if (s.count != null && s.countUnit) unitCounts.set(s.countUnit, (unitCounts.get(s.countUnit) ?? 0) + 1);
  const countUnit = [...unitCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const counted = countUnit
    ? rateFrom(sessions.filter(s => s.countUnit === countUnit && s.count != null).map(s => ({ minutes: s.minutes, amount: s.count! })))
    : { rate: null, used: 0, trimmed: 0, spread: null };
  const useWeight = weighed.used >= counted.used && weighed.rate != null;
  const rate: ItemRate = {
    minutesPerKg: weighed.rate,
    minutesPerCount: counted.rate,
    countUnit: counted.rate != null ? countUnit : null,
    rateSessions: useWeight ? weighed.used : counted.used,
    trimmed: useWeight ? weighed.trimmed : counted.trimmed,
    rateSpread: useWeight ? weighed.spread : counted.spread,
  };
  // Trust is judged on the per-kg (or per-piece) rate when there is one —
  // minutes per session swing with how much was made, a rate shouldn't.
  const confidence = confidenceFor(sessions.length, rate.rateSpread ?? minutes);
  return {
    itemKey,
    sessions: sessions.length,
    minutes,
    rate,
    confidence,
    quickCompletions,
    unopenedCompletions,
    days: new Set(sessions.map(s => dayOf(s.completedAt))).size,
    people: new Set(sessions.map(s => s.userId).filter(u => u != null)).size,
    lastAt: Math.max(...sessions.map(s => s.completedAt)),
  };
}
