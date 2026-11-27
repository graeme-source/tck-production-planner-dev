/**
 * Pure rules for queued 8-pack bag orders (services/queued-bags.ts; Graeme,
 * 22 Nov 2026). Applying a queued order is all or nothing: every recipe must
 * be on the plan, or nothing is added and it stays queued with the reason —
 * the same rule Process has ("we NEVER add a recipe to a plan").
 */
export interface QueuedLine { recipeId: number; recipeName: string; bags: number }

export type ApplyOutcome =
  | { ok: true; adds: Array<{ recipeId: number; recipeName: string; bags: number }> }
  | { ok: false; problem: string };

/** What to add to the plan, recipe by recipe (duplicate lines summed). */
export function bagsToAdd(lines: readonly QueuedLine[], planRecipeIds: ReadonlySet<number> | null, planDateLabel: string): ApplyOutcome {
  if (planRecipeIds == null) return { ok: false, problem: `No production plan for ${planDateLabel} yet` };
  const byRecipe = new Map<number, { recipeId: number; recipeName: string; bags: number }>();
  for (const l of lines) {
    if (!(l.bags > 0)) continue;
    const cur = byRecipe.get(l.recipeId) ?? { recipeId: l.recipeId, recipeName: l.recipeName, bags: 0 };
    cur.bags += l.bags;
    byRecipe.set(l.recipeId, cur);
  }
  const missing = [...byRecipe.values()].filter(r => !planRecipeIds.has(r.recipeId)).map(r => r.recipeName);
  if (missing.length) return { ok: false, problem: `Not on the ${planDateLabel} plan: ${[...new Set(missing)].join(", ")} — add it to the plan and the bags go on automatically` };
  return { ok: true, adds: [...byRecipe.values()] };
}

/** Is a queued order past its make-day without its bags on a plan? Loud on the dashboard. */
export function isOverdue(row: { status: string; productionDate: string; planId: number | null }, today: string): boolean {
  const waiting = row.status === "queued" || (row.status === "applied" && row.planId == null);
  return waiting && row.productionDate <= today;
}

/** Bags still waiting (not on a plan), per recipe, for Create Plan's maths. */
export function waitingBagsByRecipe(rows: ReadonlyArray<{ status: string; planId: number | null; lines: readonly QueuedLine[] }>): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    const waiting = r.status === "queued" || (r.status === "applied" && r.planId == null);
    if (!waiting) continue;
    for (const l of r.lines) if (l.bags > 0) out.set(l.recipeId, (out.get(l.recipeId) ?? 0) + l.bags);
  }
  return out;
}

/** How long a new plan waits before queued 8-pack bags go on it (Graeme,
 *  27 Nov 2026: a plan is often deleted and made again in the first 30–35
 *  minutes, so the bags wait an hour). */
export const QUEUED_BAGS_WAIT_MINUTES = 60;

/** When the bags can go on a plan made at `createdAt`, and whether that's
 *  now. Pure — tested. */
export function planReadyForQueuedBags(createdAt: Date | string, now: Date, waitMinutes = QUEUED_BAGS_WAIT_MINUTES): { ready: boolean; readyAt: Date } {
  const readyAt = new Date(new Date(createdAt).getTime() + waitMinutes * 60_000);
  return { ready: now.getTime() >= readyAt.getTime(), readyAt };
}
