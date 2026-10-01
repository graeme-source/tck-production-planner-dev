// Builders' target finish time — when the day's calzone building should be
// done if the whole building (both tables together) runs at the standard rate.
//
// Rule (Graeme, 2026-10-01):
//   finish = building start + (batches planned ÷ rate) hours
//            + each standard break that starts before that finish.
// A break's standard deduction is the same one the TCK run rate uses
// (api-server lib/run-rate.ts): its Settings length plus the restart
// allowance — morning snack 15 + 7 = 22, lunch 35 + 7 = 42.
//
// Wall-clock minutes since London midnight, like the rest of this package —
// no Date objects, so there's nothing timezone-y to get wrong here.

/** Standard building rate for BOTH tables together, batches per hour. */
export const BUILDING_TARGET_BATCHES_PER_HOUR = 20;

export interface TargetFinishBreak {
  id: string;
  /** Scheduled start, minutes since midnight (the plan's break anchor). */
  anchorMinutes: number;
  /** Total minutes this break costs: its length + the restart allowance. */
  minutes: number;
}

export interface TargetFinishInput {
  /** Calzone batches planned for building today. */
  batches: number;
  /** Building start, minutes since midnight (07:30 = 450). */
  startMinutes: number;
  ratePerHour?: number;
  breaks: TargetFinishBreak[];
}

export interface TargetFinishResult {
  /** Target finish, minutes since midnight (whole minutes). */
  finishMinutes: number;
  /** Building time alone, before breaks (whole minutes). */
  buildMinutes: number;
  /** Ids of the breaks that fell before the finish and were added. */
  breaksAdded: string[];
}

/** Null when there's nothing to build or the rate is unusable. */
export function computeTargetFinish(input: TargetFinishInput): TargetFinishResult | null {
  const rate = input.ratePerHour ?? BUILDING_TARGET_BATCHES_PER_HOUR;
  if (!(input.batches > 0) || !(rate > 0)) return null;

  const buildMinutes = (input.batches / rate) * 60;
  let finish = input.startMinutes + buildMinutes;
  const breaksAdded: string[] = [];
  // Earliest first: an earlier break pushes the finish later, which can pull
  // a later break (lunch) inside the day.
  const ordered = [...input.breaks].sort((a, b) => a.anchorMinutes - b.anchorMinutes);
  for (const br of ordered) {
    if (br.anchorMinutes >= input.startMinutes && br.anchorMinutes < finish && br.minutes > 0) {
      finish += br.minutes;
      breaksAdded.push(br.id);
    }
  }
  return { finishMinutes: Math.round(finish), buildMinutes: Math.round(buildMinutes), breaksAdded };
}

/**
 * Applies a plan's saved break anchors (app_settings
 * schedule_break_anchors_<planId> = {"morning":555,"lunch":735}) over the
 * defaults. Malformed JSON or values keep the default.
 */
export function applySavedBreakAnchors<T extends { id: string; anchorMinutes: number }>(
  breaks: T[],
  saved: string | null | undefined,
): T[] {
  if (!saved) return breaks;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(saved) as Record<string, unknown>;
  } catch {
    return breaks;
  }
  if (!parsed || typeof parsed !== "object") return breaks;
  return breaks.map(b => {
    const v = parsed[b.id];
    return typeof v === "number" && Number.isFinite(v) ? { ...b, anchorMinutes: v } : b;
  });
}
