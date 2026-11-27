/**
 * The TCK run rate through ONE production day, in 15-minute steps (Graeme,
 * 26 Nov 2026: "when we look at just today and click on the trend, … show
 * the progress throughout the day and how this changed … whether there were
 * any sharp jumps or drops, to see whether we're calculating correctly or
 * how much lunch is having an effect … over 15-minute intervals").
 *
 * Each step is the number as it stood at the END of that 15 minutes — the
 * same computeBatchesPerHour the building station shows live, given only
 * the batches finished by then and "now" = that moment (so a break holds
 * the number steady, exactly as it did on the station). Once "Mark building
 * finished" has been pressed the step uses the finished day's rule. Beside
 * it, how many batches were built in those 15 minutes — the pace on the
 * floor, which is where lunch and restarts show up.
 *
 * Improvement time (27 Nov 2026, lib/improvement-kpi-credit.ts): each step
 * takes off the credit for improvements done by then; the finished day and
 * the final number take off the whole day's.
 *
 * Pure: no database, no clock. Objective G.
 */
import { computeBatchesPerHour, type StandardBreakConfig } from "./run-rate";
import { londonMinuteOfDay } from "./london-time";

export const STEP_MINUTES = 15;

export interface RunRateStep {
  /** End of the 15 minutes, ISO. */
  at: string;
  /** London clock for the start of the step, "09:15". */
  label: string;
  /** The run rate as it stood at `at`; null before there's a measurable window. */
  runRate: number | null;
  /** Calzone batches finished in this 15 minutes. */
  batches: number;
  /** Batches finished by `at`. */
  batchesSoFar: number;
  /** No batch for 15+ minutes at `at` and not finished: the number is being held. */
  held: boolean;
}

export interface RunRateDay {
  steps: RunRateStep[];
  /** The day's own number now (finished rule, or live at `now`). */
  final: number | null;
  batches: number;
  /** The morning snack, London minutes of the day. */
  snack: { fromMinute: number; toMinute: number };
  /** The stop the rule read as lunch, London minutes of the day (null = none). */
  lunch: { fromMinute: number; toMinute: number } | null;
  breakMinutesDeducted: number;
  finished: boolean;
  /** Improvement minutes taken off production time in `final`. */
  improvementMinutesCredited: number;
  /** `final` without the improvement credit. */
  finalBeforeCredit: number | null;
}

const clock = (minuteOfDay: number) => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * @param completedAts calzone building completions for the day (any order)
 * @param opts.finishedAt the "Mark building finished" press, if any
 * @param opts.now        for today: the live end; past days pass null
 * @param opts.improvementCredits the day's improvement credit, each with when it was done
 */
export function runRateThroughDay(
  completedAts: Date[],
  config: StandardBreakConfig,
  opts: { finishedAt?: Date | null; now?: Date | null; improvementCredits?: ReadonlyArray<{ at: string; minutes: number }> } = {},
): RunRateDay {
  const times = completedAts.map(d => d.getTime()).sort((a, b) => a - b);
  const snack = { fromMinute: config.morning.anchorMinutes, toMinute: config.morning.anchorMinutes + config.morning.minutes };
  if (times.length === 0) {
    return { steps: [], final: null, batches: 0, snack, lunch: null, breakMinutesDeducted: 0, finished: !!opts.finishedAt, improvementMinutesCredited: 0, finalBeforeCredit: null };
  }
  const credits = (opts.improvementCredits ?? []).map(c => ({ ms: new Date(c.at).getTime(), minutes: c.minutes }));
  const creditBy = (ms: number) => credits.reduce((n, c) => (c.ms <= ms ? n + c.minutes : n), 0);
  const allCredit = credits.reduce((n, c) => n + c.minutes, 0);
  const finMs = opts.finishedAt && opts.finishedAt.getTime() >= times[0] ? opts.finishedAt.getTime() : null;
  const dates = times.map(t => new Date(t));
  const whole = finMs != null
    ? computeBatchesPerHour(dates, config, { finishedAt: new Date(finMs), improvementMinutes: allCredit })
    : computeBatchesPerHour(dates, config, opts.now ? { liveNow: opts.now, improvementMinutes: allCredit } : { improvementMinutes: allCredit });

  // Steps on the quarter hours, from the one holding the first batch to the end of the day's window.
  const step = STEP_MINUTES * 60_000;
  const firstMin = londonMinuteOfDay(new Date(times[0]));
  const startMs = times[0] - (firstMin % STEP_MINUTES) * 60_000 - (times[0] % 60_000);
  const lastBatch = times[times.length - 1];
  const endMs = finMs ?? (opts.now ? Math.max(opts.now.getTime(), lastBatch) : lastBatch);

  const steps: RunRateStep[] = [];
  let i = 0;
  for (let from = startMs; from < endMs; from += step) {
    const to = Math.min(from + step, endMs);
    let inSlot = 0;
    while (i < times.length && times[i] <= to && (times[i] > from || from === startMs)) { inSlot++; i++; }
    // Batches recorded after a finish press count at the finish (run-rate.ts).
    if (to === endMs) while (i < times.length) { inSlot++; i++; }
    const soFar = dates.slice(0, i);
    const finishedBy = finMs != null && to >= finMs;
    const r = soFar.length === 0
      ? null
      : finishedBy
        ? computeBatchesPerHour(dates, config, { finishedAt: new Date(finMs), improvementMinutes: allCredit })
        : computeBatchesPerHour(soFar, config, { liveNow: new Date(to), improvementMinutes: creditBy(to) });
    const lastSoFar = soFar.length ? soFar[soFar.length - 1].getTime() : null;
    steps.push({
      at: new Date(to).toISOString(),
      label: clock(londonMinuteOfDay(new Date(from))),
      runRate: r?.batchesPerHour ?? null,
      batches: inSlot,
      batchesSoFar: i,
      held: !finishedBy && lastSoFar != null && to - lastSoFar >= STEP_MINUTES * 60_000,
    });
  }

  let lunch: RunRateDay["lunch"] = null;
  if (whole.lunchDetectedAt) {
    const fromMs = whole.lunchDetectedAt.getTime();
    const resume = times.find(t => t > fromMs) ?? endMs;
    lunch = { fromMinute: londonMinuteOfDay(new Date(fromMs)), toMinute: londonMinuteOfDay(new Date(fromMs)) + (resume - fromMs) / 60_000 };
  }

  return {
    steps,
    final: whole.batchesPerHour,
    batches: times.length,
    snack,
    lunch,
    breakMinutesDeducted: whole.breakMinutesDeducted,
    finished: finMs != null,
    improvementMinutesCredited: whole.improvementMinutesCredited,
    finalBeforeCredit: whole.batchesPerHourBeforeCredit,
  };
}
