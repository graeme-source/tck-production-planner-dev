/**
 * When the plan screens advise more or fewer batches (Graeme, 16 Oct 2026).
 * Objective C — never run out, never freeze — and Objective I — with a full
 * team in the building, under-producing costs money too.
 *
 * Replaces the legacy "1,000-pack ceiling" that capped the suggested total
 * (it once suggested 5 batches). Graeme's words:
 *
 *   "I put in 100 batches and it predicts 1,058 — that's not unacceptable.
 *    We get a warning at 1,250. Ideally we don't go over 1,000, but we must
 *    not produce too few batches, especially with lots of people in the
 *    building. If sales don't pick up and stock keeps building, then advise
 *    it's time to pull back." … "We'll make a minimum of about 80 batches."
 *
 * The rules (levels from FactoryThresholds, all editable under Change levels):
 *
 *   predicted ≥ warning (1,250)      → fewer, to land at/under the target top
 *                                      (1,000); "freeze" at/over 1,500
 *   target top < predicted < warning → nothing ("above target", calm) —
 *                                      unless stock has been above the target
 *                                      top for 3+ plan days and rising →
 *                                      fewer ("time to pull back")
 *   target (800–1,000)               → nothing
 *   predicted < target bottom (800)  → more, toward 800, up to capacity;
 *                                      "too-low" under 500
 *
 * and no suggested total is ever below the fewest batches a day (80) or
 * above the day's capacity (the rota cap, 110 / 80).
 */
import type { FactoryThresholds } from "./factory-forecast";

// ── Time to pull back ───────────────────────────────────────────────────────

export interface FactoryHistoryDay {
  /** A past plan day (YYYY-MM-DD). */
  date: string;
  /** Calzone packs in the fridge at the end of that day (from the fridge
   *  change log). */
  packs: number;
}

export interface PullBackAdvice {
  /** Consecutive most-recent plan days above the target top. */
  days: number;
  /** End-of-day figure on the latest of those days. */
  latest: number;
  /** Packs gained across the run (latest − first day of the run). */
  rise: number;
}

/** Plan days in a row above the target top before "time to pull back". */
export const PULL_BACK_MIN_DAYS = 3;

/**
 * "Stock has been above 1,000 for N days and rising." Counts the most recent
 * plan days in a row whose end-of-day figure was above targetHigh; needs at
 * least PULL_BACK_MIN_DAYS of them and the latest higher than the first of
 * the run (stock building, not coming down). Otherwise null.
 */
export function pullBackAdvice(
  history: readonly FactoryHistoryDay[],
  t: Pick<FactoryThresholds, "targetHigh">,
  minDays = PULL_BACK_MIN_DAYS,
): PullBackAdvice | null {
  const days = [...history].filter(d => Number.isFinite(d.packs)).sort((a, b) => a.date.localeCompare(b.date));
  let run = 0;
  for (let i = days.length - 1; i >= 0 && days[i].packs > t.targetHigh; i--) run++;
  if (run < minDays) return null;
  const first = days[days.length - run].packs;
  const latest = days[days.length - 1].packs;
  if (!(latest > first)) return null;
  return { days: run, latest: Math.round(latest), rise: Math.round(latest - first) };
}

// ── More, fewer, or leave it ────────────────────────────────────────────────

export type FactoryAdviceReason = "warning" | "freeze" | "pull-back" | "under" | "too-low";

export interface FactoryAdvice {
  direction: "fewer" | "more" | null;
  reason: FactoryAdviceReason | null;
  /** The factory number to aim for (targetHigh for fewer, targetLow for more). */
  aim: number | null;
}

export function factoryAdvice(
  predicted: number,
  t: FactoryThresholds,
  pullBack?: PullBackAdvice | null,
): FactoryAdvice {
  if (predicted >= t.warnAt) return { direction: "fewer", reason: predicted >= t.maxAt ? "freeze" : "warning", aim: t.targetHigh };
  if (predicted > t.targetHigh && pullBack) return { direction: "fewer", reason: "pull-back", aim: t.targetHigh };
  if (predicted < t.targetLow) return { direction: "more", reason: predicted < t.lowRed ? "too-low" : "under", aim: t.targetLow };
  return { direction: null, reason: null, aim: null };
}

// ── The suggested total in the left column ──────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The floor never exceeds the day's cap (a no-Dough-Prep day caps at 80). */
export function batchRange(cap: number, minBatchesPerDay: number): { floor: number; cap: number } {
  const c = Math.max(0, Math.round(cap));
  return { floor: Math.min(c, Math.max(0, Math.round(minBatchesPerDay))), cap: c };
}

/**
 * The total to suggest for the batches the screen has now: the current total
 * when the levels are happy with it, or the current total moved by the
 * forecast's own recommendation (`change`: −12 for "12 fewer"), always kept
 * within [fewest a day, cap].
 */
export function suggestedBatchTotal(input: {
  currentTotal: number;
  cap: number;
  minBatchesPerDay: number;
  /** Signed batches the recommendation would move (0 when none). */
  change: number;
}): number {
  const { floor, cap } = batchRange(input.cap, input.minBatchesPerDay);
  return clamp(Math.round(input.currentTotal + input.change), floor, cap);
}

/**
 * The total Create Plan starts on, from the rota: the day's capacity, so a
 * full team is used — unless the capacity would land the fridge at/over the
 * warning (or over the target top while stock has been building), then the
 * total that lands near the target top. Never below the fewest a day.
 *
 * `predicted` is the forecast at `currentTotal`; each batch adds about
 * `packsPerBatch` packs (the screen re-runs the full forecast afterwards).
 */
export function initialBatchTotal(input: {
  cap: number;
  minBatchesPerDay: number;
  currentTotal: number;
  predicted: number;
  packsPerBatch: number;
  thresholds: FactoryThresholds;
  pullBack?: PullBackAdvice | null;
}): number {
  const { floor, cap } = batchRange(input.cap, input.minBatchesPerDay);
  const ppb = input.packsPerBatch > 0 ? input.packsPerBatch : 5;
  const atCap = input.predicted + (cap - input.currentTotal) * ppb;
  const advice = factoryAdvice(atCap, input.thresholds, input.pullBack);
  if (advice.direction !== "fewer") return cap;
  const fewer = Math.ceil((atCap - input.thresholds.targetHigh) / ppb);
  return clamp(cap - fewer, floor, cap);
}
