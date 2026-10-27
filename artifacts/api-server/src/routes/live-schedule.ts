/**
 * GET /api/production-plans/:id/live-schedule — the day schedule re-planned
 * from the builders' real progress (Graeme, 2026-10-27): batches built so far
 * and the pace against plan move every recipe's "builders reach it at" time
 * and every meat's "in the oven by" time. Feeds the Mixing station timeline.
 * Each meat carries its trust signal from the daily review.
 *
 * Mounted under /production-plans AHEAD of the frozen production-plans router
 * (charter rule 4). Read-only. Logic: lib/live-schedule.ts and
 * @workspace/production-schedule live-replan.ts (pure, tested).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { buildLiveSchedule } from "../lib/live-schedule";
import { trustByIngredient } from "../lib/meat-daily-review-job";

const router: IRouter = Router();

router.get("/:id/live-schedule", async (req: Request, res: Response) => {
  const planId = Number(req.params.id);
  if (!Number.isInteger(planId) || planId <= 0) { res.status(400).json({ error: "Bad plan id" }); return; }
  const live = await buildLiveSchedule(planId);
  if (!live) { res.status(404).json({ error: "Plan not found" }); return; }
  const ids = [...new Set(live.recipes.flatMap(r => r.meats.map(m => m.rawMeatIngredientId)))];
  const trust = await trustByIngredient(ids);
  res.json({ ...live, trust: Object.fromEntries(trust) });
});

export default router;
