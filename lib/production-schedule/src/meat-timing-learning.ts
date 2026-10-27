// Self-correcting prep-oven lead times (Graeme, 27 Oct 2026): "a system that
// automatically self-corrects and learns how long it takes us to put
// different raw meats in the prep oven to get them cooked in time, to make
// sure that the builders are never waiting, but also that we adhere to
// food-safe instructions."
//
// The day schedule says "start cooking X by HH:MM" = when the builders reach
// the recipe minus the meat's lead time, and the lead time is
//
//     cook + processing + grace          (all per raw-meat ingredient)
//
// What this learns, from what actually happened on the floor:
//
//   one RUN = one raw meat for one recipe on one plan. Its LEAD is
//     first REAL tray into the prep oven  →  first tin of that recipe's
//     filling ticked as mixed on the Mixing station
//   i.e. everything from "meat goes in" to "filling ready for the builders".
//
//   processing = median lead − the configured cook time
//                (everything after the oven: cool, pull, dice, mix the tin)
//   grace      = slow-end lead (90th percentile) − median lead
//                (the spread: the cover that makes the builders not wait on
//                the slower days, without starting every day needlessly early)
//
// So cook + processing + grace = the lead that was enough on 9 days in 10.
//
// FOOD SAFETY — what this will never do:
//   - change the COOK time or any temperature. The cook time is the recipe's
//     food-safety instruction; learning reads it and never writes it. The
//     core-temperature probe check on the station still decides "cooked".
//   - shrink the lead below the cook time (processing and grace are ≥ 0).
//   - set grace above the cap (default 30 min) — grace is time the cooked
//     meat may sit ready before it's needed, so it stays short. The 4-hour
//     rule for the whole build is checked by the live schedule (holdBreach).
//
// SAFE AUTOMATION — a value moves at most `maxStepMinutes` per learning run
// (half that while there are fewer than `fullStepRuns` runs), only on
// `minRuns` clean runs, and only when the change is at least
// `minChangeMinutes`. One odd day can't swing it: the median ignores single
// days, and runs far from the rest (MAD outlier rule) are dropped first.
// RECENT DAYS COUNT MORE: each older run weighs `recencyDecay` × the one
// after it, so a change in production pace is followed within days while a
// single day still can't drag the median.
//
// The daily review (meat-daily-review.ts) can exclude runs where the time
// wasn't followed (human, not the model) or capacity got in the way.
//
// Pure: callers load the rows, this does the arithmetic.

export interface MeatTrayEvent {
  inAtMs: number;
  /** Null while the tray is still in. */
  outAtMs: number | null;
}

export interface MeatRun {
  planId: number;
  recipeId: number;
  /** Plan date, YYYY-MM-DD. Newest runs are used first. */
  planDate: string;
  trays: MeatTrayEvent[];
  /** First tin of this recipe's filling ticked as mixed. Null = never ticked. */
  fillingReadyAtMs: number | null;
}

export interface ConfiguredMeatTiming {
  cookMinutes: number | null;
  processMinutes: number | null;
  graceMinutes: number | null;
}

export interface LearningRules {
  /** Use at most this many of the newest clean runs. */
  windowRuns: number;
  /** Fewer clean runs than this → no learning, configured values stand. */
  minRuns: number;
  /** Below this many runs, steps are halved (converge from little data, carefully). */
  fullStepRuns: number;
  /** Weight of each older run relative to the next newer one. */
  recencyDecay: number;
  /** A tray shorter than this fraction of the cook time was tapped in and out together. */
  trayMinFraction: number;
  /** …and never shorter than this, whatever the cook time. */
  trayMinMinutes: number;
  /** A tray longer than max(cook × this, cook + trayMaxExtraMinutes) was left open by mistake. */
  trayMaxMultiple: number;
  trayMaxExtraMinutes: number;
  /** Filling ticked before cook × this after the meat went in can't be real. */
  leadMinFractionOfCook: number;
  /** A lead longer than cook + this is a day the filling was mixed late on purpose (or ticked late). */
  leadMaxExtraMinutes: number;
  /** Runs further than this many MADs from the median are dropped as one-offs. */
  outlierMads: number;
  /** The slow-end percentile the lead should cover (0.9 = 9 days in 10). */
  gracePercentile: number;
  graceMin: number;
  graceMax: number;
  processMax: number;
  /** Largest change one learning run may make to one value. */
  maxStepMinutes: number;
  /** Smaller changes than this are noise — leave the value alone. */
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
  leadMinFractionOfCook: 0.8,
  leadMaxExtraMinutes: 180,
  outlierMads: 3,
  gracePercentile: 0.9,
  graceMin: 5,
  graceMax: 30,
  processMax: 240,
  maxStepMinutes: 15,
  minChangeMinutes: 3,
};

export type RunDropReason =
  | "no_real_tray"
  | "no_filling_tick"
  | "filling_before_cooked"
  | "too_long"
  | "not_followed"
  | "outlier";

export interface LeadStats {
  median: number;
  /** The slow end (rules.gracePercentile). */
  slow: number;
  min: number;
  max: number;
}

export interface TimingChange {
  field: "process" | "grace";
  from: number | null;
  to: number;
  reason: string;
}

export interface MeatLearning {
  status: "learned" | "not_enough_data" | "no_cook_time";
  runsSeen: number;
  runsUsed: number;
  dropped: Record<RunDropReason, number>;
  /** Lead-time spread over the runs used, minutes. Null without enough data. */
  lead: LeadStats | null;
  /** Where the data points, before the per-run step limit. */
  learned: { processMinutes: number; graceMinutes: number } | null;
  /** What this run would set (step-limited). Null = keep configured. */
  proposed: { processMinutes: number; graceMinutes: number } | null;
  /** The changes worth making now (empty = nothing to do). */
  changes: TimingChange[];
  /** cook + process + grace as configured today (grace null = 0). */
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

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function emptyDrops(): Record<RunDropReason, number> {
  return { no_real_tray: 0, no_filling_tick: 0, filling_before_cooked: 0, too_long: 0, not_followed: 0, outlier: 0 };
}

/**
 * Weighted percentile: values with weights, the value where the running
 * weight first reaches p of the total (interpolating across the step).
 * Equal weights give the same answer as percentile().
 */
export function weightedPercentile(items: Array<{ value: number; weight: number }>, p: number): number {
  const s = items.filter(i => i.weight > 0).sort((a, b) => a.value - b.value);
  if (s.length === 0) return 0;
  if (s.length === 1) return s[0].value;
  // Position of each value on 0..1 at the centre of its weight band, then
  // interpolate — the weighted analogue of the linear percentile.
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

/** Is this tray a real cook, or a tap-through / a tray left open? */
export function isRealTray(tray: MeatTrayEvent, cookMinutes: number, rules: LearningRules = LEARNING_RULES): boolean {
  if (tray.outAtMs == null) return false;
  const minutes = (tray.outAtMs - tray.inAtMs) / 60_000;
  const lo = Math.max(rules.trayMinMinutes, cookMinutes * rules.trayMinFraction);
  const hi = Math.max(cookMinutes * rules.trayMaxMultiple, cookMinutes + rules.trayMaxExtraMinutes);
  return minutes >= lo && minutes <= hi;
}

/**
 * One run's lead in minutes (first real tray in → first tin mixed), or why
 * the run can't be trusted.
 */
export function runLeadMinutes(
  run: MeatRun,
  cookMinutes: number,
  rules: LearningRules = LEARNING_RULES,
): { lead: number } | { drop: Exclude<RunDropReason, "outlier"> } {
  const real = run.trays.filter(t => isRealTray(t, cookMinutes, rules));
  if (real.length === 0) return { drop: "no_real_tray" };
  if (run.fillingReadyAtMs == null) return { drop: "no_filling_tick" };
  const inAt = Math.min(...real.map(t => t.inAtMs));
  const lead = (run.fillingReadyAtMs - inAt) / 60_000;
  if (lead < cookMinutes * rules.leadMinFractionOfCook) return { drop: "filling_before_cooked" };
  if (lead > cookMinutes + rules.leadMaxExtraMinutes) return { drop: "too_long" };
  return { lead };
}

function stepTowards(from: number | null, to: number, maxStep: number): number {
  if (from == null) return to;
  return from + clamp(to - from, -maxStep, maxStep);
}

export function configuredLead(c: ConfiguredMeatTiming): number | null {
  if (c.cookMinutes == null && c.processMinutes == null) return null;
  return (c.cookMinutes ?? 0) + (c.processMinutes ?? 0) + (c.graceMinutes ?? 0);
}

/** Learn one raw meat's processing + grace from its history. */
export function learnMeatTiming(
  runs: MeatRun[],
  configured: ConfiguredMeatTiming,
  rules: LearningRules = LEARNING_RULES,
  /** `${planId}:${recipeId}` runs the daily review says to leave out. */
  exclude: Set<string> = new Set(),
): MeatLearning {
  const dropped = emptyDrops();
  const base = {
    runsSeen: runs.length,
    configuredLeadMinutes: configuredLead(configured),
  };
  const cook = configured.cookMinutes;
  if (cook == null || !Number.isFinite(cook) || cook <= 0) {
    // Without the cook time we can't tell cooking from processing, and the
    // cook time is a food-safety value a person sets — never a guess.
    return { ...base, status: "no_cook_time", runsUsed: 0, dropped, lead: null, learned: null, proposed: null, changes: [] };
  }

  // Newest first, so the window is the most recent clean runs.
  const ordered = [...runs].sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0));
  const leads: number[] = [];
  for (const run of ordered) {
    if (exclude.has(`${run.planId}:${run.recipeId}`)) { dropped.not_followed += 1; continue; }
    const r = runLeadMinutes(run, cook, rules);
    if ("drop" in r) { dropped[r.drop] += 1; continue; }
    if (leads.length < rules.windowRuns) leads.push(r.lead);
  }

  // One-off days (a breakdown, a forgotten tick) by distance from the median.
  let kept = leads;
  if (leads.length >= 3) {
    const m = median(leads);
    const mad = Math.max(MIN_MAD, median(leads.map(v => Math.abs(v - m))));
    kept = leads.filter(v => Math.abs(v - m) <= rules.outlierMads * mad);
    dropped.outlier = leads.length - kept.length;
  }

  if (kept.length < rules.minRuns) {
    return { ...base, status: "not_enough_data", runsUsed: kept.length, dropped, lead: null, learned: null, proposed: null, changes: [] };
  }

  // `kept` is newest first: weight 1, decay, decay², …
  const weighted = kept.map((value, i) => ({ value, weight: Math.pow(rules.recencyDecay, i) }));
  const lead: LeadStats = {
    median: weightedPercentile(weighted, 0.5),
    slow: weightedPercentile(weighted, rules.gracePercentile),
    min: Math.min(...kept),
    max: Math.max(...kept),
  };
  const learned = {
    processMinutes: Math.round(clamp(lead.median - cook, 0, rules.processMax)),
    graceMinutes: Math.round(clamp(lead.slow - lead.median, rules.graceMin, rules.graceMax)),
  };
  const step = kept.length < rules.fullStepRuns ? Math.max(1, Math.floor(rules.maxStepMinutes / 2)) : rules.maxStepMinutes;
  const proposed = {
    processMinutes: Math.round(clamp(stepTowards(configured.processMinutes, learned.processMinutes, step), 0, rules.processMax)),
    graceMinutes: Math.round(clamp(stepTowards(configured.graceMinutes, learned.graceMinutes, step), rules.graceMin, rules.graceMax)),
  };

  const changes: TimingChange[] = [];
  const n = kept.length;
  const med = Math.round(lead.median);
  const slow = Math.round(lead.slow);
  const worth = (from: number | null, to: number) => from == null || Math.abs(to - from) >= rules.minChangeMinutes;
  if (worth(configured.processMinutes, proposed.processMinutes) && proposed.processMinutes !== configured.processMinutes) {
    const capped = proposed.processMinutes !== learned.processMinutes ? ` (moving ${step} min at a time towards ${learned.processMinutes})` : "";
    changes.push({
      field: "process",
      from: configured.processMinutes,
      to: proposed.processMinutes,
      reason: `Last ${n} runs (recent days count most): in the oven → first tin mixed took ${med} min (typical). Cook is set at ${cook} min, so processing is about ${learned.processMinutes} min${capped}.`,
    });
  }
  if (worth(configured.graceMinutes, proposed.graceMinutes) && proposed.graceMinutes !== configured.graceMinutes) {
    const capped = proposed.graceMinutes !== learned.graceMinutes ? ` (moving ${step} min at a time towards ${learned.graceMinutes})` : "";
    changes.push({
      field: "grace",
      from: configured.graceMinutes,
      to: proposed.graceMinutes,
      reason: `Slow days take ${slow} min against a typical ${med} min (last ${n} runs), so ${learned.graceMinutes} min of grace keeps the builders from waiting 9 days in 10${capped}.`,
    });
  }

  return { ...base, status: "learned", runsUsed: n, dropped, lead, learned, proposed, changes };
}
