/**
 * Which plan the Orders page should warn about (Graeme, 6 Nov 2026). The page
 * remembers the plan you last had open, so creating Tuesday's plan elsewhere
 * left it on Monday: AB Fruits order 769 was placed on Monday's plan and
 * Tuesday's items never came up. Objective B.
 */

export type PlanLike = {
  id: number;
  planDate: string;
  status: string;
};

/** The latest active plan dated after the selected one, or null if there is none. */
export function newerPlanThan<T extends PlanLike>(plans: readonly T[], selectedId: number | null): T | null {
  const active = plans.filter(p => p.status === "active");
  const selected = active.find(p => p.id === selectedId);
  if (!selected) return null;
  let newest: T | null = null;
  for (const p of active) {
    if (p.planDate <= selected.planDate) continue;
    if (!newest || p.planDate > newest.planDate || (p.planDate === newest.planDate && p.id > newest.id)) newest = p;
  }
  return newest;
}
