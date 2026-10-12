/**
 * Dough Prep mix progress — the per-mix ingredient ticks and "Mix N
 * complete", saved so a reload or a second iPad shows the same thing
 * (Graeme, 2026-10-12: all 110 balls recorded but the page said 0 / 2 mixes).
 *
 *   GET /dough-mix-progress/:planId[?dough=day_before|same_day:<subRecipeId>]
 *       → { planId, dough, ballsRecorded, mixes: [{ mixNo, ticked: [{ ingredientKey, at, byUserId, byName }],
 *                                     completedAt, completedBy }] }
 *   PUT /dough-mix-progress/:planId
 *       body: one change (lib/dough-mix-progress.ts, zod):
 *         { action: "tick", dough?, mixNo, ingredientKey, ticked }
 *         { action: "complete", dough?, mixNo, completed }
 *       → the same shape as GET for that dough, after the change.
 *
 * dough (migration 0177) defaults to 'day_before': the calzone dough, and
 * :planId is the plan it is FOR (the station's trackingPlanId), the same plan
 * the balls are recorded against. 'same_day:<subRecipeId>' is a dough made on
 * the production day (cinnamon bun dough); :planId is the plan it's baked for.
 * Each change is one atomic jsonb edit, so concurrent iPads never overwrite
 * each other's ticks. Any signed-in user (the station runs as station
 * accounts); the write is attributed, so it sits in the server PIN lock
 * (lib/pin-enforce.ts).
 */
import { Router, type IRouter } from "express";
import { db, doughMixProgressTable, productionPlansTable, usersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { validate, validateQuery } from "../middleware/validate";
import {
  DAY_BEFORE_DOUGH,
  DoughMixProgressChange,
  DoughMixProgressParams,
  DoughMixProgressQuery,
  shapeMixes,
} from "../lib/dough-mix-progress";

const router: IRouter = Router();

async function readProgress(planId: number, dough: string) {
  const rows = await db
    .select()
    .from(doughMixProgressTable)
    .where(and(eq(doughMixProgressTable.planId, planId), eq(doughMixProgressTable.doughKey, dough)));
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
  // Balls rolled for this plan (its dough_prep batch completions), so the
  // dashboard tile needs no plan-detail fetch to show balling progress.
  // Balls belong to the day-before dough only.
  let ballsRecorded = 0;
  if (dough === DAY_BEFORE_DOUGH) {
    const balls = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM batch_completions bc
      JOIN production_plan_items pi ON pi.id = bc.plan_item_id
      WHERE pi.plan_id = ${planId} AND bc.station_type = 'dough_prep'
    `);
    ballsRecorded = Number((balls.rows[0] as { n?: number } | undefined)?.n ?? 0);
  }
  return { planId, dough, ballsRecorded, mixes: shapeMixes(rows, names) };
}

function planIdOf(params: unknown): number | null {
  const parsed = DoughMixProgressParams.safeParse(params);
  return parsed.success ? parsed.data.planId : null;
}

router.get("/:planId", validateQuery(DoughMixProgressQuery), async (req, res) => {
  const planId = planIdOf(req.params);
  if (planId == null) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const { dough } = res.locals["query"] as z.infer<typeof DoughMixProgressQuery>;
  res.json(await readProgress(planId, dough ?? DAY_BEFORE_DOUGH));
});

router.put(
  "/:planId",
  validate(DoughMixProgressChange),
  async (req, res) => {
    const planId = planIdOf(req.params);
    if (planId == null) { res.status(400).json({ error: "Invalid plan id" }); return; }
    const change = req.body as DoughMixProgressChange;
    const dough = change.dough ?? DAY_BEFORE_DOUGH;
    const userId = req.session.userId ?? null;

    const [plan] = await db
      .select({ id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.id, planId));
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const target = [doughMixProgressTable.planId, doughMixProgressTable.doughKey, doughMixProgressTable.mixNo];
    const base = { planId, doughKey: dough, mixNo: change.mixNo, updatedAt: new Date(), updatedByUserId: userId };
    if (change.action === "tick") {
      const tick = { [change.ingredientKey]: { at: new Date().toISOString(), by: userId } };
      const ticks = change.ticked
        ? sql`${doughMixProgressTable.ticks} || ${JSON.stringify(tick)}::jsonb`
        : sql`${doughMixProgressTable.ticks} - ${change.ingredientKey}::text`;
      await db
        .insert(doughMixProgressTable)
        .values({ ...base, ticks: change.ticked ? tick : {} })
        .onConflictDoUpdate({
          target,
          set: { ticks, updatedAt: base.updatedAt, updatedByUserId: userId },
        });
    } else {
      const completedAt = change.completed ? new Date() : null;
      const completedByUserId = change.completed ? userId : null;
      await db
        .insert(doughMixProgressTable)
        .values({ ...base, completedAt, completedByUserId })
        .onConflictDoUpdate({
          target,
          set: { completedAt, completedByUserId, updatedAt: base.updatedAt, updatedByUserId: userId },
        });
    }

    res.json(await readProgress(planId, dough));
  },
);

export default router;
