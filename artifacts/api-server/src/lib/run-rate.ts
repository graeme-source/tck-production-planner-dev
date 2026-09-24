/**
 * THE TCK run rate — calzone batches per hour of production time. Every
 * surface that shows it (the building station, the dashboard, the morning
 * and end-of-day meetings, Analytics) goes through computeBatchesPerHour so
 * they can never disagree. (Called "builder batches per hour" until
 * 2026-09-24; renamed because it measures the factory's throughput, not
 * individual builders.)
 *
 * The method (agreed 2026-07-15, breaks reworked 2026-09-24):
 *   - Calzone building completions only. Mac cheese is ignored entirely.
 *     Callers filter before passing timestamps in.
 *   - Window = first completion → end, where end is the "Mark building
 *     finished" press, else the last completion (or now, live).
 *   - Standard deductions, never whatever anyone tapped:
 *       MORNING SNACK — happens every day around 09:15 (production always
 *       spans it): deducted when the window starts before 09:15 and runs
 *       past the snack's end. Deducts snack minutes + the restart
 *       allowance (15 + 7 = 22).
 *       LUNCH — detected from production itself, not the clock (Graeme,
 *       2026-09-24: we were charged 35 minutes on a day we built through to
 *       12:45 and never took lunch). Lunch was taken if there's a stop of
 *       at least LUNCH_GAP_MINUTES between batches (or between the last
 *       batch and a later "finished" press). Deducts lunch minutes + the
 *       allowance (35 + 7 = 42), never more than the stop itself.
 *       40 minutes, not 30, because real morning snack stops run 21-34
 *       minutes and real lunch stops 44-55 (40 production days to
 *       2026-09-23): 30 would mistake a long snack for lunch ~1 day in 6.
 *       A stop that spans the 09:15 snack is the snack (or a breakdown),
 *       never lunch.
 *   - The restart allowance (Settings → "Run rate restart allowance", default
 *     7) is the standard time to get back up and running after a break. Time
 *     beyond it still counts: getting going again is part of throughput.
 *   - Live view: while production is paused (no batch for PAUSE_FREEZE
 *     minutes) the window stops at the last batch, so the number holds
 *     steady through a break instead of sagging, then settles on the rule
 *     above once building restarts.
 */
import { DEFAULT_BREAKS } from "@workspace/production-schedule";
import { londonMinuteOfDay } from "./london-time";

export interface StandardBreak {
  /** Scheduled start, minutes since London midnight. */
  anchorMinutes: number;
  /** Standard length, minutes (Settings → Break / Lunch minutes). */
  minutes: number;
}

export interface StandardBreakConfig {
  morning: StandardBreak;
  lunch: StandardBreak;
  /** Standard restart allowance added to each deducted break, minutes. */
  allowanceMinutes: number;
  /** A stop at least this long between batches means lunch was taken. */
  lunchGapMinutes: number;
}

export const DEFAULT_RESTART_ALLOWANCE_MINUTES = 7;
export const LUNCH_GAP_MINUTES = 40;
/** Live view: no batch for this long = paused; hold the number. */
const PAUSE_FREEZE_MINUTES = 15;
export const RESTART_ALLOWANCE_SETTING = "run_rate_restart_allowance_minutes";

export const MORNING_ANCHOR = DEFAULT_BREAKS.find(b => b.id === "morning")?.anchorMinutes ?? 9 * 60 + 15;
export const LUNCH_ANCHOR = DEFAULT_BREAKS.find(b => b.id === "lunch")?.anchorMinutes ?? 12 * 60 + 15;

export interface BphResult {
  batches: number;
  windowStartAt: Date | null;
  windowEndAt: Date | null;
  wallClockMinutes: number;
  morningBreakDeducted: boolean;
  lunchBreakDeducted: boolean;
  /** When the detected lunch stop began (last batch before it), if any. */
  lunchDetectedAt: Date | null;
  breakMinutesDeducted: number;
  activeMinutes: number;
  /** null when there's no measurable window (0-1 completions). */
  batchesPerHour: number | null;
}

const EMPTY: BphResult = {
  batches: 0,
  windowStartAt: null,
  windowEndAt: null,
  wallClockMinutes: 0,
  morningBreakDeducted: false,
  lunchBreakDeducted: false,
  lunchDetectedAt: null,
  breakMinutesDeducted: 0,
  activeMinutes: 0,
  batchesPerHour: null,
};

/**
 * completedAts must all fall on the same London day (callers group by day
 * first). finishedAt is the "Mark building finished" press — when present
 * it is the end of the window (never before the last completion). liveNow
 * extends the window to now for the in-day view, except while paused.
 */
export function computeBatchesPerHour(
  completedAts: Date[],
  config: StandardBreakConfig,
  opts: { liveNow?: Date; finishedAt?: Date | null } = {},
): BphResult {
  if (completedAts.length === 0) return EMPTY;

  const times = completedAts.map(d => d.getTime()).sort((a, b) => a - b);
  const startMs = times[0];
  const lastCompletionMs = times[times.length - 1];

  let endMs = lastCompletionMs;
  if (opts.finishedAt) {
    endMs = Math.max(lastCompletionMs, opts.finishedAt.getTime());
  } else if (opts.liveNow) {
    const nowMs = opts.liveNow.getTime();
    // Paused (e.g. at a break): hold at the last batch until work resumes.
    endMs = nowMs - lastCompletionMs >= PAUSE_FREEZE_MINUTES * 60_000 ? lastCompletionMs : Math.max(lastCompletionMs, nowMs);
  }

  const windowStartAt = new Date(startMs);
  const windowEndAt = new Date(endMs);
  const wallClockMinutes = (endMs - startMs) / 60_000;
  const startMin = londonMinuteOfDay(windowStartAt);
  const endMin = startMin + wallClockMinutes; // immune to the window crossing midnight in bad data
  const minuteOf = (ms: number) => startMin + (ms - startMs) / 60_000;

  // Morning snack — every day, by the clock.
  const snack = config.morning;
  const morningDeduction = startMin < snack.anchorMinutes && endMin >= snack.anchorMinutes + snack.minutes
    ? Math.min(snack.minutes + config.allowanceMinutes, endMin - snack.anchorMinutes)
    : 0;

  // Lunch — detected from a real stop in production.
  const stops: Array<{ fromMs: number; toMs: number }> = [];
  for (let i = 1; i < times.length; i++) stops.push({ fromMs: times[i - 1], toMs: times[i] });
  if (endMs > lastCompletionMs) stops.push({ fromMs: lastCompletionMs, toMs: endMs });
  let lunchStop: { fromMs: number; toMs: number } | null = null;
  for (const st of stops) {
    const minutes = (st.toMs - st.fromMs) / 60_000;
    if (minutes < config.lunchGapMinutes) continue;
    // A stop spanning the morning snack is the snack (or a breakdown), not lunch.
    if (minuteOf(st.fromMs) <= snack.anchorMinutes && minuteOf(st.toMs) >= snack.anchorMinutes) continue;
    if (!lunchStop || st.toMs - st.fromMs > lunchStop.toMs - lunchStop.fromMs) lunchStop = st;
  }
  const lunchDeduction = lunchStop
    ? Math.min(config.lunch.minutes + config.allowanceMinutes, (lunchStop.toMs - lunchStop.fromMs) / 60_000)
    : 0;

  const breakMinutesDeducted = morningDeduction + lunchDeduction;
  const activeMinutes = Math.max(0, wallClockMinutes - breakMinutesDeducted);

  return {
    batches: completedAts.length,
    windowStartAt,
    windowEndAt,
    wallClockMinutes: Math.round(wallClockMinutes),
    morningBreakDeducted: morningDeduction > 0,
    lunchBreakDeducted: lunchDeduction > 0,
    lunchDetectedAt: lunchStop ? new Date(lunchStop.fromMs) : null,
    breakMinutesDeducted: Math.round(breakMinutesDeducted),
    activeMinutes: Math.round(activeMinutes),
    batchesPerHour: activeMinutes >= 1
      ? Math.round((completedAts.length / (activeMinutes / 60)) * 10) / 10
      : null,
  };
}

/** Sum day/builder results into one rate: total batches ÷ total active hours. */
export function aggregateBph(results: BphResult[]): {
  totalBatches: number;
  totalActiveMinutes: number;
  batchesPerHour: number | null;
} {
  let totalBatches = 0;
  let totalActiveMinutes = 0;
  for (const r of results) {
    totalBatches += r.batches;
    totalActiveMinutes += r.activeMinutes;
  }
  return {
    totalBatches,
    totalActiveMinutes,
    batchesPerHour: totalActiveMinutes >= 1
      ? Math.round((totalBatches / (totalActiveMinutes / 60)) * 10) / 10
      : null,
  };
}
