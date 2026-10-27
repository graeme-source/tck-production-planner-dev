// The daily review of the prep oven (Graeme, 27 Oct 2026): "analyses, on a
// daily basis, what time we actually put stuff in and whether we followed the
// timings suggested... the mixing prep person can just reliably trust those
// times every morning: they come in, put it in exactly at the time it says,
// and it's always ready in time, but never too early."
//
// For every hot raw meat × recipe × day:
//   PUT IN   first tray in vs the "in the oven by" time the station was
//            showing at that moment. Followed = within the tolerance, which
//            widens with the trays (loading six trays takes 3-4 minutes).
//   READY    first tin of the filling mixed vs when the builders were free for
//            the recipe. Two numbers, both to be kept small:
//              SAT   minutes ready before the builders needed it
//              WAIT  minutes the builders stood waiting for it
//            and one cost: sat + waitWeight × wait (waits hurt more).
//            Outcome: WAITED when wait > tapNoise (a few minutes is tap noise);
//            TOO EARLY when it sat longer than the meat's buffer +
//            tooEarlyBeyondBufferMinutes; otherwise PERFECT.
//   SAFETY   evidence only (meat-safety.ts): when the chill was MEASURED
//            (probe or a plausible tap), out of the oven → chilled to 8 °C,
//            and whether it was within 240 minutes. Never assumed.
//   CAUSE    a bad outcome when the time WAS followed is the model's fault —
//            the learning must fix it. Not followed = human, or capacity if
//            the reason given is one (oven busy, not defrosted, short-staffed);
//            neither moves the model, unless "didn't follow" is a habit.
//
// Only hot-meat recipes are reviewed: cold and veg mixes are made early and
// chilled on purpose, so early is never a fault for them.
//
// Wall-clock minutes since London midnight; pure.

import { COOKED_TO_CHILLED_LIMIT_MINUTES } from "./meat-safety";

export interface ReviewRules {
  /** Put in within this many minutes of the suggested time = followed. Also the "ask why" threshold. */
  followToleranceMinutes: number;
  /** Loading trays takes time — the tolerance widens by this per tray… */
  loadingMinutesPerTray: number;
  /** …up to this much. */
  maxLoadingMinutes: number;
  /** Taps are never exact: a wait this small is noise, never a fault. */
  tapNoiseMinutes: number;
  /** Sat longer than the buffer + this = too early. */
  tooEarlyBeyondBufferMinutes: number;
  /** A minute of builder wait costs this many minutes of sitting. */
  waitWeight: number;
}

export const REVIEW_RULES: Readonly<ReviewRules> = {
  followToleranceMinutes: 10,
  loadingMinutesPerTray: 0.6,
  maxLoadingMinutes: 10,
  tapNoiseMinutes: 3,
  tooEarlyBeyondBufferMinutes: 15,
  waitWeight: 4,
};

/** How far off the suggested time still counts as "followed" for a meat with this many trays. */
export function putInToleranceMinutes(trayCount: number | null | undefined, rules: ReviewRules = REVIEW_RULES): number {
  const trays = Math.max(0, trayCount ?? 0);
  return rules.followToleranceMinutes + Math.min(rules.maxLoadingMinutes, trays * rules.loadingMinutesPerTray);
}

/** Quick-pick reasons for putting meat in off-time. Category drives the learning. */
export const PUT_IN_REASONS = [
  { code: "oven_busy", label: "Oven busy", category: "capacity" },
  { code: "not_defrosted", label: "Meat not defrosted / not ready", category: "capacity" },
  { code: "short_staffed", label: "Short-staffed", category: "capacity" },
  { code: "builders_ahead", label: "Builders running ahead", category: "pace" },
  { code: "builders_behind", label: "Builders running behind", category: "pace" },
  { code: "other", label: "Other", category: "other" },
] as const;

export type PutInReasonCode = (typeof PUT_IN_REASONS)[number]["code"];

export function reasonCategory(code: string | null | undefined): "capacity" | "pace" | "other" | null {
  if (!code) return null;
  return PUT_IN_REASONS.find(r => r.code === code)?.category ?? "other";
}

/** Deviation in minutes (+ = late, − = early) is past the tolerance (incl. loading time) → ask why. */
export function needsReason(deviationMinutes: number | null, rules: ReviewRules = REVIEW_RULES, trayCount = 0): boolean {
  return deviationMinutes != null && Math.abs(deviationMinutes) > putInToleranceMinutes(trayCount, rules);
}

export interface PutInRunInput {
  /** The "in the oven by" time shown when the first tray went in. Null = none was recorded. */
  suggestedAtMinutes: number | null;
  putInAtMinutes: number;
  /** First tin of the filling mixed. Null = never ticked. */
  readyAtMinutes: number | null;
  /** When the builders were free for this recipe. Null = they never built it. */
  neededAtMinutes: number | null;
  reasonCode?: string | null;
  /** Trays of this meat — widens the put-in tolerance for loading time. */
  trayCount?: number | null;
  /** The meat's buffer at the time (sitting up to buffer + allowance is fine). */
  bufferMinutes?: number | null;
  /** First tray out cooked (probe preferred) — the start of the 4-hour clock. */
  outAtMinutes?: number | null;
  /** When the last batch was MEASURED at 8 °C (probe or a plausible tap). Null = not measured. */
  chilledAtMinutes?: number | null;
}

export type PutInVerdict = "on_time" | "early" | "late" | "unknown";
export type Outcome = "perfect" | "builders_waited" | "too_early" | "unknown";
export type Cause = "none" | "model" | "human" | "capacity" | "unknown";

export interface RunReview {
  /** + = put in late, − = early. Null without a suggestion. */
  deviationMinutes: number | null;
  putIn: PutInVerdict;
  followed: boolean | null;
  outcome: Outcome;
  readyInTime: boolean | null;
  /** Builders idle waiting for the filling, minutes. */
  waitMinutes: number | null;
  /** Filling ready before the builders needed it, minutes. */
  satMinutes: number | null;
  /** sat + waitWeight × wait. */
  costMinutes: number | null;
  cause: Cause;
  /** Out of the oven → last batch chilled to 8 °C, measured. Null = not measured. */
  safetyMinutes: number | null;
  safetyBreach: boolean;
}

export function reviewRun(input: PutInRunInput, rules: ReviewRules = REVIEW_RULES): RunReview {
  const deviation = input.suggestedAtMinutes == null ? null : Math.round(input.putInAtMinutes - input.suggestedAtMinutes);
  const followed = deviation == null ? null : Math.abs(deviation) <= putInToleranceMinutes(input.trayCount, rules);
  const putIn: PutInVerdict = deviation == null ? "unknown" : followed ? "on_time" : deviation < 0 ? "early" : "late";

  let outcome: Outcome = "unknown";
  let wait: number | null = null;
  let sat: number | null = null;
  if (input.readyAtMinutes != null && input.neededAtMinutes != null) {
    const diff = input.readyAtMinutes - input.neededAtMinutes; // + = ready after needed
    wait = Math.max(0, Math.round(diff));
    sat = Math.max(0, Math.round(-diff));
    if (wait > rules.tapNoiseMinutes) outcome = "builders_waited";
    else if (sat > (input.bufferMinutes ?? 0) + rules.tooEarlyBeyondBufferMinutes) outcome = "too_early";
    else outcome = "perfect";
  }
  const readyInTime = outcome === "unknown" ? null : outcome !== "builders_waited";
  const cost = wait == null || sat == null ? null : sat + rules.waitWeight * wait;

  let cause: Cause;
  if (outcome === "perfect") cause = "none";
  else if (outcome === "unknown" || followed == null) cause = "unknown";
  else if (followed) cause = "model";
  else cause = reasonCategory(input.reasonCode) === "capacity" ? "capacity" : "human";

  let safetyMinutes: number | null = null;
  if (input.outAtMinutes != null && input.chilledAtMinutes != null) {
    safetyMinutes = Math.round(input.chilledAtMinutes - input.outAtMinutes);
  }
  // Negative = the taps don't add up (meat "out" after its last batch was
  // built): not measurable, never a pass.
  if (safetyMinutes != null && safetyMinutes < 0) safetyMinutes = null;
  const limit = COOKED_TO_CHILLED_LIMIT_MINUTES;
  const safetyBreach = safetyMinutes != null && safetyMinutes > limit;

  return { deviationMinutes: deviation, putIn, followed, outcome, readyInTime, waitMinutes: wait, satMinutes: sat, costMinutes: cost, cause, safetyMinutes, safetyBreach };
}

export interface ReviewedRun {
  /** Identifies the run for the learner: `${planId}:${recipeId}`. */
  key: string;
  planDate: string;
  followed: boolean | null;
  deviationMinutes: number | null;
  reasonCode: string | null;
}

export interface HabitRules {
  /** Look at this many of the newest reviewed runs. */
  window: number;
  /** This share off-time in the SAME direction makes it a habit. */
  habitShare: number;
}

export const HABIT_RULES: Readonly<HabitRules> = { window: 10, habitShare: 0.6 };

/**
 * Runs the learner should leave out: not followed (human — one-offs shouldn't
 * move the model) and capacity-caused (oven busy etc. says nothing about how
 * long the meat takes). If not following is a HABIT in one direction, those
 * human runs stay in — that's how the kitchen actually works now.
 */
export function runsToExclude(runs: ReviewedRun[], rules: HabitRules = HABIT_RULES): { exclude: Set<string>; habit: "early" | "late" | null } {
  const recent = [...runs]
    .filter(r => r.followed != null)
    .sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0))
    .slice(0, rules.window);
  const early = recent.filter(r => r.followed === false && (r.deviationMinutes ?? 0) < 0 && reasonCategory(r.reasonCode) !== "capacity").length;
  const late = recent.filter(r => r.followed === false && (r.deviationMinutes ?? 0) > 0 && reasonCategory(r.reasonCode) !== "capacity").length;
  const need = Math.max(3, Math.ceil(recent.length * rules.habitShare));
  const habit = early >= need ? "early" : late >= need ? "late" : null;

  const exclude = new Set<string>();
  for (const r of runs) {
    if (r.followed !== false) continue;
    if (reasonCategory(r.reasonCode) === "capacity") { exclude.add(r.key); continue; }
    const dir = (r.deviationMinutes ?? 0) < 0 ? "early" : "late";
    if (habit !== dir) exclude.add(r.key);
  }
  return { exclude, habit };
}

export interface TrustRules {
  window: number;
  /** Each older day counts this much less than the one after it. */
  decay: number;
  minDays: number;
  trustAt: number;
}

export const TRUST_RULES: Readonly<TrustRules> = { window: 10, decay: 0.8, minDays: 5, trustAt: 0.85 };

export interface TrustSignal {
  /** 0–1, recency-weighted share of good days. Null with no reviewed days. */
  score: number | null;
  days: number;
  trusted: boolean;
  /** Newest first: outcome per day, for the trend. */
  recent: Outcome[];
}

/** Confidence from recent days. Days with an unknown outcome don't count either way. */
export function trustSignal(days: Array<{ planDate: string; outcome: Outcome }>, rules: TrustRules = TRUST_RULES): TrustSignal {
  const known = days
    .filter(d => d.outcome !== "unknown")
    .sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0))
    .slice(0, rules.window);
  if (known.length === 0) return { score: null, days: 0, trusted: false, recent: [] };
  let w = 1;
  let total = 0;
  let good = 0;
  for (const d of known) {
    total += w;
    if (d.outcome === "perfect") good += w;
    w *= rules.decay;
  }
  const score = good / total;
  const trusted = known.length >= rules.minDays && score >= rules.trustAt && known[0].outcome !== "builders_waited";
  return { score, days: known.length, trusted, recent: known.map(d => d.outcome) };
}

export interface BuiltItemSpan {
  planItemId: number;
  firstTickMinutes: number;
  lastTickMinutes: number;
}

/**
 * When the builders were free for this item: the last batch of the recipe
 * they built before it (in the order they actually built), or the building
 * start time for the day's first recipe. Never later than this item's own
 * first batch. Null when the item was never built.
 */
export function builderFreeAtMinutes(spans: BuiltItemSpan[], planItemId: number, startMinutes: number): number | null {
  const sorted = [...spans].sort((a, b) => a.firstTickMinutes - b.firstTickMinutes);
  const idx = sorted.findIndex(s => s.planItemId === planItemId);
  if (idx < 0) return null;
  const own = sorted[idx];
  if (idx === 0) return Math.min(startMinutes, own.firstTickMinutes);
  return Math.min(sorted[idx - 1].lastTickMinutes, own.firstTickMinutes);
}
