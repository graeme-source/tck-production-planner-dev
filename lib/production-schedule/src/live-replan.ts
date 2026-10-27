// The live, adapting day schedule (Graeme, 27 Oct 2026): "it gives us
// basically a predicted schedule for the day, but if we're going faster or
// slower, we need to adapt to that. We want the times to adapt and change
// based on that, and always show a timing schedule against each recipe, so
// that the mixing prep's got an accurate understanding of when we think the
// builders will be ready for the next mix."
//
// The morning plan is computeDaySchedule over every planned batch from the
// building start time. This re-plans from NOW:
//   - recipes the builders have finished drop out;
//   - the recipe in hand keeps only its batches still to build;
//   - every remaining batch is timed at the pace the builders are ACTUALLY
//     going today against plan (measurePace), not the standard;
//   - breaks not yet taken are still ahead; one being taken now holds the
//     clock until it ends;
// and the same engine (computeDaySchedule) re-times the rest, so the meat
// "in the oven by" times move with the builders.
//
// Each recipe carries both times — planned ("was") and live — so the screen
// can say "Godfather mix needed ~10:40 (was 10:55 — builders are ahead)".
//
// THE ORDER BUILT, NOT THE ORDER PLANNED: builders swap recipes on the day
// ("the pork's not quite cooked"). The recipe with the latest batch is the
// one in hand, whatever its planned slot; anything already started and
// paused goes back in the queue at its planned place.
//
// HOT vs COLD (from data, never names): a recipe whose ingredients include a
// raw meat for the prep oven is HOT — its meat gets an exact "in the oven by"
// time. Everything else (cold meats, veg) is COLD: mixed early, chilled, taken
// whenever the builders want — so it gets "mix any time before HH:MM"
// (coldMixBufferMinutes ahead of the builders: learned from how early the
// builders have arrived against the prediction), never a tight time.
//
// FOOD SAFETY (meat-safety.ts): out of the prep oven → that recipe's last
// batch built, baked and chilled to 8 °C must be ≤ 240 min, so the meat may be
// out at most maxSpanMinutes (240 − chill − bake) before the last batch is
// built. A meat not yet in the oven gets a WAVE plan when one cook can't cover
// the build; a meat already out gets safetyBreachComing when the live
// finish is past its limit.
//
// Wall-clock minutes since London midnight throughout, like the rest of this
// package.

import {
  computeDaySchedule,
  type ScheduleRecipeInput, type ScheduleOptions, type ScheduleBreakInput, type ScheduledBreak,
} from "./index";
import { planMeatWaves, type MeatWave } from "./meat-safety";

export interface LiveItemProgress {
  planItemId: number;
  /** Batches built so far across every building table. */
  built: number;
  /** The builders marked this item finished for the day. */
  markedComplete: boolean;
}

/** One building-station batch completion. */
export interface BuildTick {
  atMinutes: number;
  planItemId: number;
}

export interface PaceRules {
  /** Gaps shorter than this are a double tap, not a batch. */
  minGapMinutes: number;
  /** Longer gaps span a break or a stoppage — not building pace. */
  maxGapMinutes: number;
  /** Judge pace on the most recent this-many gaps. */
  recentGaps: number;
  /** Fewer usable gaps → no pace reading; the plan's pace stands. */
  minGaps: number;
  /** The reading is held inside these bounds so a freak spell can't wreck the day. */
  minFactor: number;
  maxFactor: number;
}

export const PACE_RULES: Readonly<PaceRules> = {
  minGapMinutes: 0.2,
  maxGapMinutes: 25,
  recentGaps: 30,
  minGaps: 6,
  minFactor: 0.6,
  maxFactor: 1.8,
};

export interface PaceReading {
  /** Actual ÷ planned minutes per batch. Above 1 = slower than plan. */
  factor: number;
  gapsUsed: number;
  /** Planned and actual minutes per batch for the whole line (both tables). */
  plannedMinutesPerBatch: number;
  actualMinutesPerBatch: number;
}

/**
 * How fast the line is building against plan. Every gap between consecutive
 * completions ON THE SAME RECIPE (any table) is one batch for the line; its
 * planned length is that recipe's minutes per batch ÷ builders. Changeovers
 * (recipe changes) and long gaps (breaks) are left out — they're timed
 * separately by the engine.
 */
export function measurePace(
  ticks: BuildTick[],
  minutesPerBatchByItem: Map<number, number>,
  buildersCount: number,
  rules: PaceRules = PACE_RULES,
): PaceReading | null {
  const builders = Math.max(1, buildersCount);
  const sorted = [...ticks].sort((a, b) => a.atMinutes - b.atMinutes);
  const gaps: Array<{ actual: number; planned: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.planItemId !== cur.planItemId) continue;
    const mpb = minutesPerBatchByItem.get(cur.planItemId);
    if (!mpb || mpb <= 0) continue;
    const actual = cur.atMinutes - prev.atMinutes;
    if (actual < rules.minGapMinutes || actual > rules.maxGapMinutes) continue;
    gaps.push({ actual, planned: mpb / builders });
  }
  const recent = gaps.slice(-rules.recentGaps);
  if (recent.length < rules.minGaps) return null;
  const actual = recent.reduce((s, g) => s + g.actual, 0);
  const planned = recent.reduce((s, g) => s + g.planned, 0);
  if (!(planned > 0)) return null;
  const factor = Math.min(rules.maxFactor, Math.max(rules.minFactor, actual / planned));
  return {
    factor,
    gapsUsed: recent.length,
    plannedMinutesPerBatch: planned / recent.length,
    actualMinutesPerBatch: actual / recent.length,
  };
}

export interface LiveMeat {
  rawMeatIngredientId: number;
  rawMeatName: string;
  /** cook + processing + buffer, minutes. */
  leadMinutes: number;
  cookMinutes: number | null;
  bufferMinutes: number | null;
  /** Out of the oven by (first wave), when the cook time is known. */
  outMinutes: number | null;
  missing: "cook" | "process" | null;
  plannedCookStartMinutes: number;
  liveCookStartMinutes: number;
  /** A tray of this meat for this recipe is already in (or out of) the oven. */
  started: boolean;
  /** Not started and the live start time has already passed. */
  overdue: boolean;
  /**
   * Not yet in: the cooks needed to stay inside the 4-hour rule (one wave
   * when the build is short enough). Empty without a cook time, or once in.
   */
  waves: MeatWave[];
  /** Even waves can't comply (processing + buffer alone use up the limit). */
  safetyImpossible: boolean;
  /** Already out: the live finish is past its limit — a breach is coming. */
  safetyBreachComing: boolean;
  /** …by this many minutes. */
  safetyOverMinutes: number | null;
}

export type Drift = "ahead" | "behind" | "on_time";

export interface LiveRecipe {
  planItemId: number;
  recipeId: number;
  name: string;
  state: "done" | "building" | "waiting";
  batches: number;
  built: number;
  remaining: number;
  plannedStartMinutes: number;
  plannedFinishMinutes: number;
  /** When the builders reach (reached) this recipe. */
  liveStartMinutes: number;
  liveFinishMinutes: number;
  /** live − planned: negative = the builders are ahead. */
  driftMinutes: number;
  drift: Drift;
  meats: LiveMeat[];
  /** For a recipe not yet done: the builders move on to this next. */
  nextFlavour: { planItemId: number; name: string; atMinutes: number; wasMinutes: number } | null;
  buildTimeGuessed: boolean;
  /** Hot = a prep-oven raw meat goes in it (exact times); cold = chilled mix (any time before). */
  kind: "hot" | "cold";
  /** The mix must be ready by this time (builders' start − the mix margin). */
  mixByMinutes: number;
}

export interface LiveSchedule {
  nowMinutes: number;
  /** Building has started today. */
  started: boolean;
  pace: PaceReading | null;
  plannedEndMinutes: number;
  liveEndMinutes: number;
  recipes: LiveRecipe[];
  /** Breaks still ahead, as placed by the live re-plan. */
  breaks: ScheduledBreak[];
}

export interface LiveReplanInput {
  /** Full-day engine inputs in build order (the morning plan). */
  recipes: ScheduleRecipeInput[];
  options: ScheduleOptions;
  progress: LiveItemProgress[];
  ticks: BuildTick[];
  nowMinutes: number;
  pace: PaceReading | null;
  /** `${recipeId}:${rawMeatIngredientId}` for meats with a tray already in the oven. */
  meatsStarted?: Set<string>;
  /** Same key → when that meat first came out cooked (probe or tap). */
  meatsOutAt?: Map<string, number>;
  /** 4-hour rule: longest the meat may be out before the last batch is built. */
  maxSpanMinutes: number;
  /** Drift smaller than this reads as "on time". */
  onTimeMinutes?: number;
  /** Cold mixes ready this long before the builders need them (learned, default 5). */
  coldMixBufferMinutes?: number;
}

/** A gap at least this long with no building means the line is stopped. */
const STOPPED_MINUTES = 10;
/** A stop this close to a break's slot counts as that break. */
const BREAK_WINDOW_BEFORE = 45;

export function meatKey(recipeId: number, ingredientId: number): string {
  return `${recipeId}:${ingredientId}`;
}

function driftOf(minutes: number, onTime: number): Drift {
  if (minutes <= -onTime) return "ahead";
  if (minutes >= onTime) return "behind";
  return "on_time";
}

/**
 * Which breaks are still ahead, and whether one is being taken right now.
 * A break was TAKEN when building stopped (a gap ≥ ~60% of its length, at
 * least STOPPED_MINUTES) at or after BREAK_WINDOW_BEFORE minutes before its
 * slot. A break being taken now holds the clock to its end. A break whose
 * slot has passed but hasn't been taken is still coming — next, after the
 * recipe in hand.
 */
export function pendingBreaks(
  breaks: ScheduleBreakInput[],
  ticks: BuildTick[],
  nowMinutes: number,
): { pending: ScheduleBreakInput[]; resumeAtMinutes: number } {
  const times = ticks.map(t => t.atMinutes).sort((a, b) => a - b);
  const gaps: Array<{ from: number; to: number }> = [];
  for (let i = 1; i < times.length; i++) gaps.push({ from: times[i - 1], to: times[i] });
  const last = times.length ? times[times.length - 1] : null;
  let resumeAt = nowMinutes;
  const pending: ScheduleBreakInput[] = [];
  const used = new Set<number>();
  for (const br of [...breaks].sort((a, b) => a.anchorMinutes - b.anchorMinutes)) {
    const minStop = Math.max(STOPPED_MINUTES, br.minutes * 0.6);
    const gapIdx = gaps.findIndex((g, i) => !used.has(i) && g.from >= br.anchorMinutes - BREAK_WINDOW_BEFORE && g.to - g.from >= minStop);
    if (gapIdx >= 0) { used.add(gapIdx); continue; } // taken
    if (last != null && last >= br.anchorMinutes - BREAK_WINDOW_BEFORE && nowMinutes - last >= STOPPED_MINUTES && nowMinutes < last + br.minutes + 30) {
      // On it now: the line stopped near the slot. Resume when it ends.
      resumeAt = Math.max(resumeAt, last + br.minutes);
      continue;
    }
    if (br.anchorMinutes <= nowMinutes && last != null) {
      // Overdue and not taken: still coming, straight after the recipe in hand.
      pending.push({ ...br, anchorMinutes: nowMinutes + 1 });
      continue;
    }
    pending.push(br);
  }
  return { pending, resumeAtMinutes: resumeAt };
}

export function replanLive(input: LiveReplanInput): LiveSchedule {
  const onTime = input.onTimeMinutes ?? 3;
  const mixMargin = input.coldMixBufferMinutes ?? 5;
  const outAt = input.meatsOutAt ?? new Map<string, number>();
  const planned = computeDaySchedule(input.recipes, input.options);
  const plannedById = new Map(planned.recipes.map(r => [r.planItemId, r]));
  const progressById = new Map(input.progress.map(p => [p.planItemId, p]));
  const startedMeats = input.meatsStarted ?? new Set<string>();
  const factor = input.pace?.factor ?? 1;

  const firstTickById = new Map<number, number>();
  for (const t of input.ticks) {
    const cur = firstTickById.get(t.planItemId);
    if (cur == null || t.atMinutes < cur) firstTickById.set(t.planItemId, t.atMinutes);
  }

  const isDone = (r: ScheduleRecipeInput) => {
    const p = progressById.get(r.planItemId);
    if (!p) return false;
    return p.markedComplete || (r.batches > 0 && p.built >= r.batches);
  };
  const builtOf = (id: number) => Math.max(0, progressById.get(id)?.built ?? 0);

  const started = input.ticks.length > 0 || input.progress.some(p => p.built > 0);
  // Follow the order actually being built: the item with the latest batch is
  // in hand now (even if the builders jumped ahead of the plan); the rest keep
  // their planned order.
  let inHand: number | null = null;
  let latest = -Infinity;
  for (const t of input.ticks) if (t.atMinutes >= latest) { latest = t.atMinutes; inHand = t.planItemId; }
  const notDone = input.recipes.filter(r => !isDone(r));
  const remaining = inHand != null && notDone.some(r => r.planItemId === inHand)
    ? [notDone.find(r => r.planItemId === inHand)!, ...notDone.filter(r => r.planItemId !== inHand)]
    : notDone;

  // Before the day has started, the morning plan IS the forecast — unless the
  // start time has passed with nothing built, when everything slides to now.
  let clock: number;
  let breaksAhead: ScheduleBreakInput[];
  if (!started) {
    clock = Math.max(input.options.startMinutes, input.nowMinutes);
    breaksAhead = input.options.breaks.map(b => ({ ...b }));
  } else {
    const pb = pendingBreaks(input.options.breaks, input.ticks, input.nowMinutes);
    clock = Math.max(input.nowMinutes, pb.resumeAtMinutes);
    breaksAhead = pb.pending;
  }

  const live = computeDaySchedule(
    remaining.map(r => ({
      ...r,
      batches: Math.max(0, r.batches - builtOf(r.planItemId)),
      minutesPerBatch: r.minutesPerBatch * factor,
    })),
    { ...input.options, startMinutes: clock, breaks: breaksAhead },
  );
  const liveById = new Map(live.recipes.map(r => [r.planItemId, r]));

  const recipes: LiveRecipe[] = input.recipes.map(r => {
    const p = plannedById.get(r.planItemId)!;
    const l = liveById.get(r.planItemId);
    const built = builtOf(r.planItemId);
    const done = isDone(r);
    // "Building" is only the one in hand; a recipe started then paused (the
    // builders switched away from it) is waiting again, at its queue slot.
    const isInHand = inHand != null ? r.planItemId === inHand : built > 0;
    const state: LiveRecipe["state"] = done ? "done" : built > 0 && isInHand ? "building" : "waiting";
    const liveStart = state === "building"
      ? (firstTickById.get(r.planItemId) ?? l?.startMinutes ?? p.startMinutes)
      : (l?.startMinutes ?? p.startMinutes);
    const liveFinish = done ? p.finishMinutes : (l?.finishMinutes ?? p.finishMinutes);
    const driftMinutes = Math.round(state === "building" ? liveFinish - p.finishMinutes : liveStart - p.startMinutes);

    const meats: LiveMeat[] = p.meats.map((pm, i) => {
      const lm = l?.meats[i];
      const liveCookStart = lm?.cookStartMinutes ?? pm.cookStartMinutes;
      const key = meatKey(r.recipeId, pm.rawMeatIngredientId);
      const isStarted = startedMeats.has(key);
      const consider = state === "waiting" && !isStarted;
      const buffer = pm.bufferMinutes ?? 0;
      const processing = pm.cookMinutes != null ? Math.max(0, pm.processMinutes - pm.cookMinutes - buffer) : null;
      let waves: MeatWave[] = [];
      let impossible = false;
      if (consider && pm.cookMinutes != null && processing != null) {
        const plan = planMeatWaves({
          startMinutes: liveStart,
          finishMinutes: liveFinish,
          batches: Math.max(0, r.batches - built),
          cookMinutes: pm.cookMinutes,
          processMinutes: processing,
          bufferMinutes: buffer,
          maxSpanMinutes: input.maxSpanMinutes,
        });
        waves = plan.waves;
        impossible = plan.impossible;
      }
      // Already out: does the live finish break its limit?
      const out = outAt.get(key);
      const over = out != null && state !== "done" ? Math.round(liveFinish - (out + input.maxSpanMinutes)) : null;
      return {
        rawMeatIngredientId: pm.rawMeatIngredientId,
        rawMeatName: pm.rawMeatName,
        leadMinutes: pm.processMinutes,
        cookMinutes: pm.cookMinutes,
        bufferMinutes: pm.bufferMinutes,
        outMinutes: pm.cookMinutes != null ? liveCookStart + pm.cookMinutes : null,
        missing: pm.missing,
        plannedCookStartMinutes: pm.cookStartMinutes,
        liveCookStartMinutes: liveCookStart,
        started: isStarted,
        overdue: consider && liveCookStart < input.nowMinutes,
        waves,
        safetyImpossible: impossible,
        safetyBreachComing: over != null && over > 0,
        safetyOverMinutes: over != null && over > 0 ? over : null,
      };
    });

    return {
      planItemId: r.planItemId,
      recipeId: r.recipeId,
      name: r.name,
      state,
      batches: r.batches,
      built,
      remaining: done ? 0 : Math.max(0, r.batches - built),
      plannedStartMinutes: p.startMinutes,
      plannedFinishMinutes: p.finishMinutes,
      liveStartMinutes: liveStart,
      liveFinishMinutes: liveFinish,
      driftMinutes,
      drift: driftOf(driftMinutes, onTime),
      meats,
      nextFlavour: null,
      buildTimeGuessed: r.buildTimeGuessed ?? false,
      kind: (r.meats?.length ?? 0) > 0 || (r.untimedMeats?.length ?? 0) > 0 ? "hot" : "cold",
      mixByMinutes: liveStart - mixMargin,
    };
  });

  // Live order: done first (as built), then the in-hand recipe, then the queue.
  const rank = new Map(remaining.map((r, i) => [r.planItemId, i]));
  const firstTick = (id: number) => firstTickById.get(id) ?? Infinity;
  recipes.sort((a, b) => {
    const ad = a.state === "done" ? 0 : 1;
    const bd = b.state === "done" ? 0 : 1;
    if (ad !== bd) return ad - bd;
    if (ad === 0) return firstTick(a.planItemId) - firstTick(b.planItemId) || a.plannedStartMinutes - b.plannedStartMinutes;
    return (rank.get(a.planItemId) ?? 0) - (rank.get(b.planItemId) ?? 0);
  });

  // Next flavour: the next recipe in the order the builders still have to do.
  const open = recipes.filter(r => r.state !== "done");
  for (let i = 0; i < open.length - 1; i++) {
    const nx = open[i + 1];
    open[i].nextFlavour = { planItemId: nx.planItemId, name: nx.name, atMinutes: nx.liveStartMinutes, wasMinutes: nx.plannedStartMinutes };
  }

  return {
    nowMinutes: input.nowMinutes,
    started,
    pace: input.pace,
    plannedEndMinutes: planned.endMinutes,
    liveEndMinutes: remaining.length ? live.endMinutes : Math.max(...recipes.map(r => r.liveFinishMinutes), planned.startMinutes),
    recipes,
    breaks: live.breaks,
  };
}
