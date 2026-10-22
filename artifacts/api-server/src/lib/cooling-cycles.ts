/**
 * Cooling, recorded one way for everything (issues #85 and #244, Objective D).
 *
 * A cooling cycle is: went into the blast chiller (start) → chilling
 * finished (end), with who and where. Two things are cooled today:
 *
 *   calzone recipes  the last oven batch's weigh-in starts the clock and
 *                    "Mark as Chilled" (ovens / wrapping) stops it
 *                    (batch_weight_records, #85)
 *   cooked sub-recipes  "Into blast chiller" starts it and "Chilling
 *                    finished" (wrapping / prep) stops it
 *                    (cook_chill_records, #244)
 *
 * Both are turned into the same CoolingCycle here, so the duration rule and
 * the HACCP cooling log have one copy. Pure: no DB.
 */

export type CoolingSource = "calzone" | "sub_recipe";

export interface CoolingCycle {
  source: CoolingSource;
  /** The record it came from (batch_weight_records.id / cook_chill_records.id). */
  recordId: number;
  name: string;
  startAt: string;
  endAt: string | null;
  /** Whole minutes from start to end; null while still chilling or if the
   *  times are impossible (end not after start). */
  durationMinutes: number | null;
  startedByName: string | null;
  finishedByName: string | null;
  via: string | null;
}

function ms(t: Date | string | null | undefined): number | null {
  if (t == null) return null;
  const n = (t instanceof Date ? t : new Date(t)).getTime();
  return Number.isFinite(n) ? n : null;
}

/** Minutes from going in to chilling finished; null when not finished or
 *  the end isn't after the start. */
export function coolingMinutes(start: Date | string | null | undefined, end: Date | string | null | undefined): number | null {
  const s = ms(start);
  const e = ms(end);
  if (s == null || e == null || e <= s) return null;
  return Math.round((e - s) / 60000);
}

function iso(t: Date | string): string {
  return (t instanceof Date ? t : new Date(t)).toISOString();
}

/** A calzone recipe's chill (its last oven batch's weigh-in → Mark as Chilled). */
export function calzoneCoolingCycle(r: {
  id: number; recipeName: string | null; recordedAt: Date | string;
  chillEndAt: Date | string | null; chilledVia: string | null;
  weighedByName: string | null; chilledByName: string | null;
}): CoolingCycle {
  return {
    source: "calzone",
    recordId: r.id,
    name: r.recipeName ?? "Recipe",
    startAt: iso(r.recordedAt),
    endAt: r.chillEndAt ? iso(r.chillEndAt) : null,
    durationMinutes: coolingMinutes(r.recordedAt, r.chillEndAt),
    startedByName: r.weighedByName,
    finishedByName: r.chilledByName,
    via: r.chilledVia,
  };
}

/** A cooked sub-recipe's chill. null until it has gone into the chiller. */
export function subRecipeCoolingCycle(r: {
  id: number; subRecipeName: string; chillStartAt: Date | string | null;
  chillEndAt: Date | string | null; chilledVia: string | null;
  chillStartByName: string | null; chillEndByName: string | null;
}): CoolingCycle | null {
  if (!r.chillStartAt) return null;
  return {
    source: "sub_recipe",
    recordId: r.id,
    name: r.subRecipeName,
    startAt: iso(r.chillStartAt),
    endAt: r.chillEndAt ? iso(r.chillEndAt) : null,
    durationMinutes: coolingMinutes(r.chillStartAt, r.chillEndAt),
    startedByName: r.chillStartByName,
    finishedByName: r.chillEndByName,
    via: r.chilledVia,
  };
}

/** Every cooling cycle, newest start first. */
export function coolingLog(cycles: ReadonlyArray<CoolingCycle | null>): CoolingCycle[] {
  return cycles
    .filter((c): c is CoolingCycle => c != null)
    .sort((a, b) => b.startAt.localeCompare(a.startAt) || a.name.localeCompare(b.name));
}

// ─── Cook-and-chill steps (#244) ─────────────────────────────────────────

export type CookChillStage = "cooked" | "chilling" | "chilled";

export function cookChillStage(r: { chillStartAt: unknown; chillEndAt: unknown }): CookChillStage {
  if (r.chillEndAt) return "chilled";
  if (r.chillStartAt) return "chilling";
  return "cooked";
}

export type StepVerdict = { ok: true } | { ok: false; already: boolean; error: string };

/** "Into blast chiller": only once, and only after the cook was recorded
 *  (every record starts cooked, so only a repeat is refused). */
export function canStartChill(r: { chillStartAt: unknown; chillEndAt: unknown }): StepVerdict {
  if (r.chillStartAt) return { ok: false, already: true, error: "Already in the blast chiller" };
  return { ok: true };
}

/** "Chilling finished": only after it went in, and only once. */
export function canFinishChill(r: { chillStartAt: unknown; chillEndAt: unknown }): StepVerdict {
  if (r.chillEndAt) return { ok: false, already: true, error: "Chilling already marked finished" };
  if (!r.chillStartAt) return { ok: false, already: false, error: "Mark it into the blast chiller first" };
  return { ok: true };
}

/** Which records the Prep and Wrapping cards show: everything not yet
 *  finished that was cooked in the last `openHours`, plus anything finished
 *  since `finishedSince` (so today's finished ones stay visible as done). */
export function onCookChillBoard(
  r: { cookedAt: Date | string; chillEndAt: Date | string | null },
  now: Date,
  finishedSince: Date,
  openHours = 72,
): boolean {
  const cooked = ms(r.cookedAt);
  const ended = ms(r.chillEndAt);
  if (ended != null) return ended >= finishedSince.getTime();
  return cooked != null && cooked >= now.getTime() - openHours * 3_600_000;
}
