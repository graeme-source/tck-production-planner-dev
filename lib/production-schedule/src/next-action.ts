// The Mixing prep person's ONE next thing to do (Graeme, 27 Oct 2026: "the
// primary objective of making it as easy to understand and use in the
// frontend as possible"). From the live schedule:
//
//   1. the hot meat with the earliest "in the oven at" that isn't in yet →
//      "Put BEEF MINCE in the oven at 08:15"
//   2. otherwise the next recipe still to be mixed →
//      "Mix GODFATHER — builders need it ~10:40" (cold mixes: "any time before")
//
// Status for the big card: later ("in 12 min"), due ("Put it in now" — from
// the time until `overdueAfterMinutes` past it), overdue (red).
//
// Wall-clock minutes since London midnight; pure.

import type { LiveSchedule } from "./live-replan";

export interface NextAction {
  kind: "put_in" | "mix";
  planItemId: number;
  recipeId: number;
  recipeName: string;
  /** For put_in. */
  ingredientId: number | null;
  ingredientName: string | null;
  /** When to do it. */
  atMinutes: number;
  /** For put_in: when it should come out. */
  outMinutes: number | null;
  /** at − now, whole minutes (negative = late). */
  minutesUntil: number;
  status: "later" | "due" | "overdue";
  /** Cold mixes can be made any time before `atMinutes`. */
  anyTimeBefore: boolean;
}

export function nextAction(
  live: Pick<LiveSchedule, "recipes">,
  nowMinutes: number,
  opts: { mixedPlanItemIds?: Set<number>; overdueAfterMinutes?: number } = {},
): NextAction | null {
  const overdueAfter = opts.overdueAfterMinutes ?? 5;
  const mixed = opts.mixedPlanItemIds ?? new Set<number>();
  const status = (until: number): NextAction["status"] =>
    until > 0 ? "later" : until >= -overdueAfter ? "due" : "overdue";
  const open = live.recipes.filter(r => r.state !== "done");

  let best: NextAction | null = null;
  for (const r of open) {
    for (const m of r.meats) {
      if (m.started) continue;
      if (best && m.liveCookStartMinutes >= best.atMinutes) continue;
      const until = Math.round(m.liveCookStartMinutes - nowMinutes);
      best = {
        kind: "put_in",
        planItemId: r.planItemId,
        recipeId: r.recipeId,
        recipeName: r.name,
        ingredientId: m.rawMeatIngredientId,
        ingredientName: m.rawMeatName,
        atMinutes: m.liveCookStartMinutes,
        outMinutes: m.outMinutes,
        minutesUntil: until,
        status: status(until),
        anyTimeBefore: false,
      };
    }
  }
  if (best) return best;

  // Nothing left to put in: the next mix, in the order the builders need them.
  const toMix = open.find(r => r.state === "waiting" && !mixed.has(r.planItemId));
  if (!toMix) return null;
  const at = toMix.kind === "cold" ? toMix.mixByMinutes : toMix.liveStartMinutes;
  const until = Math.round(at - nowMinutes);
  return {
    kind: "mix",
    planItemId: toMix.planItemId,
    recipeId: toMix.recipeId,
    recipeName: toMix.name,
    ingredientId: null,
    ingredientName: null,
    atMinutes: at,
    outMinutes: null,
    minutesUntil: until,
    status: toMix.kind === "cold" ? (until < 0 ? "overdue" : "later") : status(until),
    anyTimeBefore: toMix.kind === "cold",
  };
}

/** "in 12 min", "in 1 h 5 min", "now", "8 min late". */
export function countdownText(minutesUntil: number): string {
  if (minutesUntil === 0) return "now";
  const abs = Math.abs(minutesUntil);
  const text = abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return minutesUntil > 0 ? `in ${text}` : `${text} late`;
}
