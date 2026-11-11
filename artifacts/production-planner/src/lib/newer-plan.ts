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
  /** The day its prep happens (usually the day before production). */
  prepDate?: string | null;
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

const prepDay = (p: PlanLike) => (p.prepDate ?? p.planDate).slice(0, 10);

/**
 * The plan today's orders are for (Graeme, 11 Nov 2026): the earliest active
 * plan whose prep hasn't started — its ingredients have to arrive before
 * then. A plan whose prep is today or past already has its stock in, so its
 * suggestions have moved on: on 11 Nov Thursday's plan (prepped that day)
 * showed no diced chicken while Friday's needed 2 packs, and the page had
 * stayed on Thursday's. With nothing ahead, the latest active plan.
 */
export function orderingPlan<T extends PlanLike>(plans: readonly T[], today: string): T | null {
  const active = plans.filter(p => p.status === "active");
  let best: T | null = null;
  for (const p of active) {
    if (prepDay(p) <= today) continue;
    if (!best || prepDay(p) < prepDay(best) || (prepDay(p) === prepDay(best) && p.planDate < best.planDate)) best = p;
  }
  if (best) return best;
  let latest: T | null = null;
  for (const p of active) if (!latest || p.planDate > latest.planDate || (p.planDate === latest.planDate && p.id > latest.id)) latest = p;
  return latest;
}

/** The selected plan's ordering day has gone (its prep is today or past)
 *  and a later plan is the one to order for: the plan to switch to, else null. */
export function staleOrderingPlan<T extends PlanLike>(plans: readonly T[], selectedId: number | null, today: string): T | null {
  const selected = plans.find(p => p.id === selectedId);
  if (!selected || selected.status !== "active") return null;
  if (prepDay(selected) > today) return null;
  const target = orderingPlan(plans, today);
  return target && target.id !== selected.id && target.planDate > selected.planDate ? target : null;
}

/** The remembered plan choice is kept for the day it was made on only, so a
 *  tab left on yesterday's choice opens on the plan today's orders are for. */
export function rememberedPlanId(raw: string | null, today: string): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: unknown; on?: unknown };
    if (v && typeof v === "object" && typeof v.id === "number" && v.on === today) return v.id;
  } catch { /* an old bare id from before 11 Nov 2026 — not kept */ }
  return null;
}
