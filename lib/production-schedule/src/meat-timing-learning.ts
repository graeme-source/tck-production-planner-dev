// Self-correcting prep-oven timings, learned per meat (Graeme, 27 Oct 2026):
// "It depends on the hot meat... there isn't a set time something needs to be
// cooked by. It depends on how long it takes to process it... Learn from the
// historical cooking times and temperature records (when it came out at
// temperature) and the mixing tins marked complete... The number keeps
// changing, so build in flexibility for fast/slow production."
//
// The schedule works backwards from when the builders will need the recipe:
//
//     OUT of the oven at = builders need it − PROCESSING − BUFFER
//     IN the oven at     = out − COOK
//
//   COOK        configured on the ingredient. The food-safety instruction —
//               read here, NEVER changed.
//   PROCESSING  learned: out of the oven (the core-temperature probe reading
//               at temperature when there is one — objective — else the "out"
//               tap) → the first mixing tin of that recipe ticked complete.
//               Cool, pull, dice, mix. A late tin tick can only make a run
//               look LONGER (the mix waited), never shorter, so the estimate
//               is the 40th percentile, not the median.
//   BUFFER      learned: the smallest cover that keeps builder waits rare.
//               What goes wrong on the day is (a) processing taking longer
//               than the estimate and (b) the builders arriving earlier than
//               the live schedule predicted when the meat went in. Each run's
//               required cover = (its processing − the estimate) + (predicted
//               need − actual need). The buffer is the quantile of that which
//               minimises sat-minutes + waitWeight × wait-minutes: with waits
//               counting 4× sitting, the 80th percentile. Starts at 5 min with
//               little data; capped (default 25).
//
// SAFE AUTOMATION — each value moves at most `maxStepMinutes` per learning
// run (half while there are fewer than `fullStepRuns` runs), needs `minRuns`
// clean runs, and ignores changes under `minChangeMinutes`. Recent runs weigh
// more (`recencyDecay` per run) so the times follow today's production; a
// MAD outlier rule drops one-off days. The daily review can exclude runs that
// weren't followed (meat-daily-review.ts).
//
// Pure: callers load the rows, this does the arithmetic.

export interface MeatTrayEvent {
  inAtMs: number;
  /** The "out" tap. Null while the tray is still in. */
  outAtMs: number | null;
  /** Core-temperature probe reading at temperature — preferred over the tap. */
  probeAtMs?: number | null;
}

export interface MeatRun {
  planId: number;
  recipeId: number;
  /** Plan date, YYYY-MM-DD. Newest runs are used first. */
  planDate: string;
  trays: MeatTrayEvent[];
  /** First tin of this recipe's filling ticked complete. Null = never ticked. */
  fillingReadyAtMs: number | null;
  /**
   * Predicted − actual "builders need it" minutes (+ = builders came EARLIER
   * than predicted when the meat went in). Null when unknown.
   */
  needErrorMinutes?: number | null;
}

export interface ConfiguredMeatTiming {
  cookMinutes: number | null;
  processMinutes: number | null;
  bufferMinutes: number | null;
}

export interface LearningRules {
  windowRuns: number;
  minRuns: number;
  fullStepRuns: number;
  recencyDecay: number;
  /** A tapped tray shorter than this fraction of the cook time was tapped in and out together. */
  trayMinFraction: number;
  trayMinMinutes: number;
  trayMaxMultiple: number;
  trayMaxExtraMinutes: number;
  /** Processing longer than this is a day the mix was done late on purpose. */
  processMax: number;
  outlierMads: number;
  /** Processing estimate percentile (below the median: a late tin tick only ever adds). */
  processPercentile: number;
  /** A minute of builder wait costs this many minutes of sitting. Buffer quantile = w / (w + 1). */
  waitWeight: number;
  bufferStart: number;
  bufferMin: number;
  bufferMax: number;
  /** Runs needed before the buffer is learned rather than bufferStart. */
  bufferMinRuns: number;
  maxStepMinutes: number;
  minChangeMinutes: number;
}

export const LEARNING_RULES: Readonly<LearningRules> = {
  windowRuns: 20,
  minRuns: 3,
  fullStepRuns: 8,
  recencyDecay: 0.9,
  trayMinFraction: 0.5,
  trayMinMinutes: 3,
  trayMaxMultiple: 3,
  trayMaxExtraMinutes: 120,
  processMax: 240,
  outlierMads: 3,
  processPercentile: 0.4,
  waitWeight: 4,
  bufferStart: 5,
  bufferMin: 2,
  bufferMax: 25,
  bufferMinRuns: 5,
  maxStepMinutes: 15,
  minChangeMinutes: 2,
};

export type RunDropReason =
  | "no_cooked_time"
  | "no_filling_tick"
  | "filling_before_cooked"
  | "too_long"
  | "not_followed"
  | "outlier";

export interface Spread {
  /** The estimate used (processing: 40th percentile). */
  estimate: number;
  median: number;
  slow: number;
  min: number;
  max: number;
}

export interface TimingChange {
  field: "process" | "buffer";
  from: number | null;
  to: number;
  reason: string;
}

export interface MeatLearning {
  status: "learned" | "not_enough_data" | "no_cook_time";
  runsSeen: number;
  runsUsed: number;
  dropped: Record<RunDropReason, number>;
  /** Processing minutes over the runs used. Null without enough data. */
  processing: Spread | null;
  /** Runs that knew how wrong the builders' predicted time was. */
  needErrorRuns: number;
  /** Where the data points, before the step limit. */
  learned: { processMinutes: number; bufferMinutes: number } | null;
  /** What this run would set (step-limited). Null = keep configured. */
  proposed: { processMinutes: number; bufferMinutes: number } | null;
  changes: TimingChange[];
  /** cook + process + buffer as configured today (buffer unset = bufferStart). */
  configuredLeadMinutes: number | null;
}

const MIN_MAD = 2;

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(1, Math.max(0, p)) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Weighted percentile: each value sits at the centre of its weight band on
 * 0..1 and we interpolate between them. Equal weights = percentile().
 */
export function weightedPercentile(items: Array<{ value: number; weight: number }>, p: number): number {
  const s = items.filter(i => i.weight > 0).sort((a, b) => a.value - b.value);
  if (s.length === 0) return 0;
  if (s.length === 1) return s[0].value;
  const total = s.reduce((t, i) => t + i.weight, 0);
  let acc = 0;
  const pos = s.map(i => { const c = (acc + i.weight / 2) / total; acc += i.weight; return c; });
  const target = Math.min(1, Math.max(0, p));
  if (target <= pos[0]) return s[0].value;
  if (target >= pos[pos.length - 1]) return s[s.length - 1].value;
  for (let k = 1; k < s.length; k++) {
    if (target <= pos[k]) {
      const f = (target - pos[k - 1]) / (pos[k] - pos[k - 1]);
      return s[k - 1].value + (s[k].value - s[k - 1].value) * f;
    }
  }
  return s[s.length - 1].value;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function emptyDrops(): Record<RunDropReason, number> {
  return { no_cooked_time: 0, no_filling_tick: 0, filling_before_cooked: 0, too_long: 0, not_followed: 0, outlier: 0 };
}

/**
 * When this tray came out cooked: the probe reading if there is one (an
 * objective signal, whatever the taps say), else the "out" tap when the tray's
 * tapped duration is believable (not a tap-through, not left open). Null =
 * no trustworthy time.
 */
export function trayCookedAtMs(tray: MeatTrayEvent, cookMinutes: number, rules: LearningRules = LEARNING_RULES): number | null {
  if (tray.probeAtMs != null && tray.probeAtMs >= tray.inAtMs) return tray.probeAtMs;
  if (tray.outAtMs == null) return null;
  const minutes = (tray.outAtMs - tray.inAtMs) / 60_000;
  const lo = Math.max(rules.trayMinMinutes, cookMinutes * rules.trayMinFraction);
  const hi = Math.max(cookMinutes * rules.trayMaxMultiple, cookMinutes + rules.trayMaxExtraMinutes);
  return minutes >= lo && minutes <= hi ? tray.outAtMs : null;
}

/**
 * One run's processing minutes: the meat that went into the first tin came
 * out of the oven at the LATEST cooked time at or before that tin — trays
 * still cooking when the tin was mixed weren't in it.
 */
export function runProcessMinutes(
  run: MeatRun,
  cookMinutes: number,
  rules: LearningRules = LEARNING_RULES,
): { process: number } | { drop: Exclude<RunDropReason, "outlier" | "not_followed"> } {
  const cooked = run.trays.map(t => trayCookedAtMs(t, cookMinutes, rules)).filter((v): v is number => v != null);
  if (cooked.length === 0) return { drop: "no_cooked_time" };
  if (run.fillingReadyAtMs == null) return { drop: "no_filling_tick" };
  const before = cooked.filter(c => c <= run.fillingReadyAtMs!);
  if (before.length === 0) return { drop: "filling_before_cooked" };
  const process = (run.fillingReadyAtMs - Math.max(...before)) / 60_000;
  if (process > rules.processMax) return { drop: "too_long" };
  return { process };
}

function stepTowards(from: number | null, to: number, maxStep: number): number {
  if (from == null) return to;
  return from + clamp(to - from, -maxStep, maxStep);
}

export function configuredLead(c: ConfiguredMeatTiming, rules: LearningRules = LEARNING_RULES): number | null {
  if (c.cookMinutes == null && c.processMinutes == null) return null;
  return (c.cookMinutes ?? 0) + (c.processMinutes ?? 0) + (c.bufferMinutes ?? rules.bufferStart);
}

/** Learn one raw meat's processing and buffer from its history. */
export function learnMeatTiming(
  runs: MeatRun[],
  configured: ConfiguredMeatTiming,
  rules: LearningRules = LEARNING_RULES,
  /** `${planId}:${recipeId}` runs the daily review says to leave out. */
  exclude: Set<string> = new Set(),
): MeatLearning {
  const dropped = emptyDrops();
  const base = { runsSeen: runs.length, configuredLeadMinutes: configuredLead(configured, rules) };
  const cook = configured.cookMinutes;
  if (cook == null || !Number.isFinite(cook) || cook <= 0) {
    // Without a cook time the put-in time can't be worked out, and the cook
    // time is a food-safety value a person sets — never a guess.
    return { ...base, status: "no_cook_time", runsUsed: 0, dropped, processing: null, needErrorRuns: 0, learned: null, proposed: null, changes: [] };
  }

  const ordered = [...runs].sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0));
  const samples: Array<{ process: number; needError: number | null }> = [];
  for (const run of ordered) {
    if (exclude.has(`${run.planId}:${run.recipeId}`)) { dropped.not_followed += 1; continue; }
    const r = runProcessMinutes(run, cook, rules);
    if ("drop" in r) { dropped[r.drop] += 1; continue; }
    if (samples.length < rules.windowRuns) {
      samples.push({ process: r.process, needError: run.needErrorMinutes != null && Number.isFinite(run.needErrorMinutes) ? run.needErrorMinutes : null });
    }
  }

  // One-off days by distance from the median processing.
  let kept = samples;
  if (samples.length >= 3) {
    const m = median(samples.map(s => s.process));
    const mad = Math.max(MIN_MAD, median(samples.map(s => Math.abs(s.process - m))));
    kept = samples.filter(s => Math.abs(s.process - m) <= rules.outlierMads * mad);
    dropped.outlier = samples.length - kept.length;
  }

  if (kept.length < rules.minRuns) {
    return { ...base, status: "not_enough_data", runsUsed: kept.length, dropped, processing: null, needErrorRuns: 0, learned: null, proposed: null, changes: [] };
  }

  // Newest first: weight 1, decay, decay², …
  const w = (i: number) => Math.pow(rules.recencyDecay, i);
  const procW = kept.map((s, i) => ({ value: s.process, weight: w(i) }));
  const processing: Spread = {
    estimate: weightedPercentile(procW, rules.processPercentile),
    median: weightedPercentile(procW, 0.5),
    slow: weightedPercentile(procW, 0.9),
    min: Math.min(...kept.map(s => s.process)),
    max: Math.max(...kept.map(s => s.process)),
  };

  // Required cover per run = processing overrun + builders arriving early.
  const required = kept.map((s, i) => ({ value: (s.process - processing.estimate) + (s.needError ?? 0), weight: w(i) }));
  const needErrorRuns = kept.filter(s => s.needError != null).length;
  const quantile = rules.waitWeight / (rules.waitWeight + 1);
  const learnedBuffer = kept.length < rules.bufferMinRuns
    ? rules.bufferStart
    : clamp(weightedPercentile(required, quantile), rules.bufferMin, rules.bufferMax);

  const learned = {
    processMinutes: Math.round(clamp(processing.estimate, 0, rules.processMax)),
    bufferMinutes: Math.round(learnedBuffer),
  };
  const step = kept.length < rules.fullStepRuns ? Math.max(1, Math.floor(rules.maxStepMinutes / 2)) : rules.maxStepMinutes;
  const proposed = {
    processMinutes: Math.round(clamp(stepTowards(configured.processMinutes, learned.processMinutes, step), 0, rules.processMax)),
    bufferMinutes: Math.round(clamp(stepTowards(configured.bufferMinutes, learned.bufferMinutes, step), rules.bufferMin, rules.bufferMax)),
  };

  const changes: TimingChange[] = [];
  const n = kept.length;
  const worth = (from: number | null, to: number) => from == null || Math.abs(to - from) >= rules.minChangeMinutes;
  const capped = (p: number, l: number) => (p !== l ? ` (moving ${step} min at a time towards ${l})` : "");
  if (worth(configured.processMinutes, proposed.processMinutes) && proposed.processMinutes !== configured.processMinutes) {
    changes.push({
      field: "process",
      from: configured.processMinutes,
      to: proposed.processMinutes,
      reason: `Last ${n} runs (recent days count most): out of the oven → first tin mixed took ${Math.round(processing.estimate)} min (typical ${Math.round(processing.median)}, slow days ${Math.round(processing.slow)})${capped(proposed.processMinutes, learned.processMinutes)}.`,
    });
  }
  if (worth(configured.bufferMinutes, proposed.bufferMinutes) && proposed.bufferMinutes !== configured.bufferMinutes) {
    const why = n < rules.bufferMinRuns
      ? `Only ${n} runs so far — starting small at ${rules.bufferStart} min.`
      : `The smallest cover that keeps builder waits rare (waits counted ${rules.waitWeight}× sitting) over the last ${n} runs, from processing overruns${needErrorRuns ? ` and ${needErrorRuns} days of builders arriving earlier or later than predicted` : ""}.`;
    changes.push({
      field: "buffer",
      from: configured.bufferMinutes,
      to: proposed.bufferMinutes,
      reason: `${why}${capped(proposed.bufferMinutes, learned.bufferMinutes)}`,
    });
  }

  return { ...base, status: "learned", runsUsed: n, dropped, processing, needErrorRuns, learned, proposed, changes };
}
