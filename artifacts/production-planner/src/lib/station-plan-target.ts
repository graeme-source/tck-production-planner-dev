/**
 * Which production plan does a station screen belong to?
 *
 * Core business rule: dough mixing and main prep happen the DAY BEFORE
 * production, so those two stations work from the next active plan.
 * Everything else — sheeting included — happens on the production day and
 * works from today's plan. Sheeting is the one people get wrong, because it
 * is a dough job and sits next to dough prep in the flow: it was pointed at
 * the next dough plan on the dashboard and sent builders to tomorrow's sheet
 * (Graeme, 2026-09-17).
 *
 * The production-plan page's own Enter Station buttons have always simply
 * opened the plan you were looking at. The dashboard has to resolve the plan
 * itself, so this is where the rule lives for it — one list, not a guess per
 * card.
 */
export type PlanTarget = "today" | "next-dough" | "next-prep";

/** The only two stations that work ahead of production day. */
const LOOKS_AHEAD: Record<string, PlanTarget> = {
  dough_prep: "next-dough",
  prep: "next-prep",
  main_prep: "next-prep",
};

export function planTargetForStation(stationKey: string): PlanTarget {
  return LOOKS_AHEAD[stationKey] ?? "today";
}

/** Does the dashboard pin the plan (direct=1), stopping the station from
 *  re-running its own next-active routing? Only the look-ahead stations:
 *  pinning a today-station hides the station's own correction. */
export function pinsPlan(stationKey: string): boolean {
  return planTargetForStation(stationKey) !== "today";
}
