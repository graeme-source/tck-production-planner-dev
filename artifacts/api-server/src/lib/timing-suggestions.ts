/**
 * Suggested timing values from what actually happened on the floor — so a
 * recipe with no build time, or a meat with no cook time, can be filled in
 * from evidence instead of a guess (Graeme, 2026-09-25: "we do want to get
 * these build times up to date so that we can get our timing structure for
 * meat cooking accurate").
 *
 * Pure: callers load the rows, this does the arithmetic. Nothing here ever
 * writes a value — a person taps "Use suggested" to save one.
 *
 * BUILD TIME (seconds per batch, ONE builder — the day schedule divides by the
 * builder count itself). batch_completions.started_at is never filled in, so a
 * batch's duration is the gap between consecutive completions in the same
 * stream (same plan item on the same building station). Gaps are dropped when:
 *   - shorter than 20 s (a double-tap or correction, not a batch),
 *   - longer than 25 min (spans a changeover, a break, or the end of a run),
 *   - the builder logged a break on that station inside the gap,
 * then any gap over 3× the median of what's left is dropped as an outlier and
 * the median of the rest is the suggestion. Fewer than 5 usable gaps → no
 * suggestion (not enough evidence to trust).
 *
 * MEAT COOK TIME (minutes). oven_events records oven-in and oven-out per tray.
 * Durations under 3 min are tap-throughs (both taps at once after the fact)
 * and dropped; then the same 3×-median outlier rule and 5-sample minimum.
 * Process time (pull/shred/cool after cooking) has no timestamp anywhere, so
 * it can't be suggested — it has to be entered.
 */

export interface BuildCompletion {
  recipeId: number;
  planId: number;
  planItemId: number;
  stationType: string;
  completedAtMs: number;
}

export interface StationBreakInterval {
  planId: number;
  stationType: string;
  startMs: number;
  /** Null when the break was never ended — counts only for the gap it started in. */
  endMs: number | null;
}

export interface TimingSuggestion {
  /** Suggested value in the unit of the function that produced it. */
  value: number;
  /** How many real batches/trays the value is based on (after exclusions). */
  samples: number;
  /** How many candidate gaps/trays were thrown away as not-a-real-batch or outliers. */
  excluded: number;
}

export interface BuildRules {
  minGapSeconds: number;
  maxGapMinutes: number;
  outlierMultiple: number;
  minSamples: number;
}

export interface CookRules {
  minMinutes: number;
  outlierMultiple: number;
  minSamples: number;
}

export const BUILD_RULES: Readonly<BuildRules> = {
  minGapSeconds: 20,
  maxGapMinutes: 25,
  outlierMultiple: 3,
  minSamples: 5,
};

export const COOK_RULES: Readonly<CookRules> = {
  minMinutes: 3,
  outlierMultiple: 3,
  minSamples: 5,
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median after dropping anything over `multiple` × the first-pass median.
 * Null when fewer than `minSamples` values survive.
 */
export function robustMedian(
  values: number[],
  multiple: number,
  minSamples: number,
): { value: number; kept: number; dropped: number } | null {
  if (values.length === 0) return null;
  const first = median(values);
  const kept = values.filter((v) => v <= first * multiple);
  if (kept.length < minSamples) return null;
  return { value: median(kept), kept: kept.length, dropped: values.length - kept.length };
}

function gapSpansBreak(
  planId: number,
  stationType: string,
  fromMs: number,
  toMs: number,
  breaks: StationBreakInterval[],
): boolean {
  return breaks.some((b) => {
    if (b.planId !== planId || b.stationType !== stationType) return false;
    // A break never ended only counts for the gap it STARTED in — otherwise
    // one forgotten "end break" would wipe every later batch that day.
    if (b.endMs == null) return b.startMs > fromMs && b.startMs < toMs;
    return b.startMs < toMs && b.endMs > fromMs;
  });
}

/**
 * Per-recipe candidate batch durations in seconds (after the not-a-batch
 * filters, before the outlier rule), plus how many gaps were filtered out.
 */
export function buildGapsByRecipe(
  completions: BuildCompletion[],
  breaks: StationBreakInterval[] = [],
  rules: BuildRules = BUILD_RULES,
): Map<number, { gaps: number[]; filtered: number }> {
  const streams = new Map<string, BuildCompletion[]>();
  for (const c of completions) {
    const key = `${c.planItemId}:${c.stationType}`;
    const list = streams.get(key) ?? [];
    list.push(c);
    streams.set(key, list);
  }
  const out = new Map<number, { gaps: number[]; filtered: number }>();
  for (const list of streams.values()) {
    list.sort((a, b) => a.completedAtMs - b.completedAtMs);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const entry = out.get(cur.recipeId) ?? { gaps: [], filtered: 0 };
      out.set(cur.recipeId, entry);
      const gapSec = (cur.completedAtMs - prev.completedAtMs) / 1000;
      const real =
        gapSec >= rules.minGapSeconds &&
        gapSec <= rules.maxGapMinutes * 60 &&
        !gapSpansBreak(cur.planId, cur.stationType, prev.completedAtMs, cur.completedAtMs, breaks);
      if (real) entry.gaps.push(gapSec);
      else entry.filtered += 1;
    }
  }
  return out;
}

/** Suggested target_build_seconds per recipe (whole seconds). */
export function suggestBuildSeconds(
  completions: BuildCompletion[],
  breaks: StationBreakInterval[] = [],
  rules: BuildRules = BUILD_RULES,
): Map<number, TimingSuggestion> {
  const out = new Map<number, TimingSuggestion>();
  for (const [recipeId, { gaps, filtered }] of buildGapsByRecipe(completions, breaks, rules)) {
    const m = robustMedian(gaps, rules.outlierMultiple, rules.minSamples);
    if (!m) continue;
    out.set(recipeId, { value: Math.round(m.value), samples: m.kept, excluded: filtered + m.dropped });
  }
  return out;
}

/** Suggested estimated_cook_time_min from oven-in → oven-out durations (whole minutes). */
export function suggestCookMinutes(
  durationsMinutes: number[],
  rules: CookRules = COOK_RULES,
): TimingSuggestion | null {
  const real = durationsMinutes.filter((d) => Number.isFinite(d) && d >= rules.minMinutes);
  const m = robustMedian(real, rules.outlierMultiple, rules.minSamples);
  if (!m) return null;
  return {
    value: Math.round(m.value),
    samples: m.kept,
    excluded: durationsMinutes.length - real.length + m.dropped,
  };
}
