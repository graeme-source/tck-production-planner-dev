/**
 * Dough Prep mix progress — the per-mix ingredient ticks and "Mix N
 * complete", saved so a reload or a second iPad shows the same thing
 * (Graeme, 2026-10-12: all 110 balls recorded but the page said 0 / 2 mixes).
 *
 *   GET /dough-mix-progress/:planId
 *       → { planId, mixes: [{ mixNo, ticked: [{ ingredientKey, at, byUserId, byName }],
 *                             completedAt, completedBy }] }
 *   PUT /dough-mix-progress/:planId
 *       body: one change (lib/dough-mix-progress.ts, zod):
 *         { action: "tick", mixNo, ingredientKey, ticked }
 *         { action: "complete", mixNo, completed }
 *       → the same shape as GET, after the change.
 *
 * :planId is the plan the dough is FOR (the station's trackingPlanId), the
 * same plan the balls are recorded against. Each change is one atomic jsonb
 * edit, so concurrent iPads never overwrite each other's ticks. Any signed-in
 * user (the station runs as station accounts); the write is attributed, so
 * it sits in the server PIN lock (lib/pin-enforce.ts).
 */
import { Router, type IRouter } from "express";
import { db, doughMixProgressTable, productionPlansTable, usersTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import {
  DoughMixProgressChange,
  DoughMixProgressParams,
  shapeMixes,
} from "../lib/dough-mix-progress";

const router: IRouter = Router();

async function readProgress(planId: number) {
  const rows = await db
    .select()
    .from(doughMixProgressTable)
    .where(eq(doughMixProgressTable.planId, planId));
  const userIds = new Set<number>();
  for (const r of rows) {
    if (r.completedByUserId != null) userIds.add(r.completedByUserId);
    for (const t of Object.values(r.ticks ?? {})) if (t?.by != null) userIds.add(t.by);
  }
  const names = new Map<number, string>();
  if (userIds.size > 0) {
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, [...userIds]));
    for (const u of users) names.set(u.id, u.name);
  }
  return { planId, mixes: shapeMixes(rows, names) };
}

function planIdOf(params: unknown): number | null {
  const parsed = DoughMixProgressParams.safeParse(params);
  return parsed.success ? parsed.data.planId : null;
}

router.get("/:planId", async (req, res) => {
  const planId = planIdOf(req.params);
  if (planId == null) { res.status(400).json({ error: "Invalid plan id" }); return; }
  res.json(await readProgress(planId));
});

router.put(
  "/:planId",
  validate(DoughMixProgressChange),
  async (req, res) => {
    const planId = planIdOf(req.params);
    if (planId == null) { res.status(400).json({ error: "Invalid plan id" }); return; }
    const change = req.body as DoughMixProgressChange;
    const userId = req.session.userId ?? null;

    const [plan] = await db
      .select({ id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.id, planId));
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const base = { planId, mixNo: change.mixNo, updatedAt: new Date(), updatedByUserId: userId };
    if (change.action === "tick") {
      const tick = { [change.ingredientKey]: { at: new Date().toISOString(), by: userId } };
      const ticks = change.ticked
        ? sql`${doughMixProgressTable.ticks} || ${JSON.stringify(tick)}::jsonb`
        : sql`${doughMixProgressTable.ticks} - ${change.ingredientKey}::text`;
      await db
        .insert(doughMixProgressTable)
        .values({ ...base, ticks: change.ticked ? tick : {} })
        .onConflictDoUpdate({
          target: [doughMixProgressTable.planId, doughMixProgressTable.mixNo],
          set: { ticks, updatedAt: base.updatedAt, updatedByUserId: userId },
        });
    } else {
      const completedAt = change.completed ? new Date() : null;
      const completedByUserId = change.completed ? userId : null;
      await db
        .insert(doughMixProgressTable)
        .values({ ...base, completedAt, completedByUserId })
        .onConflictDoUpdate({
          target: [doughMixProgressTable.planId, doughMixProgressTable.mixNo],
          set: { completedAt, completedByUserId, updatedAt: base.updatedAt, updatedByUserId: userId },
        });
    }

    res.json(await readProgress(planId));
  },
);

export default router;
