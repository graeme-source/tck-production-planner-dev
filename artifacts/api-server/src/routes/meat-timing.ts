/**
 * Self-correcting prep-oven timings (Graeme, 2026-10-27).
 *
 *   GET  /meat-timing                    every raw meat: configured vs learned,
 *                                        the spread, what would change, + the log.
 *                                        Anyone signed in — the people doing the
 *                                        work read it from the Mixing station
 *                                        menu (Graeme, 28 Oct 2026); changing
 *                                        anything stays manager/admin.
 *   POST /meat-timing/run                apply what's learned now (manager)
 *   POST /meat-timing/adjustments/:id/revert   put a change back (manager);
 *                                        pauses learning for that meat
 *   PUT  /meat-timing/ingredients/:id    set processing / buffer / learning on-off
 *                                        by hand (manager), logged
 *   PUT  /meat-timing/settings           wait weight, buffer cap, learning
 *                                        switch, ask-why threshold (admin)
 *   POST /meat-timing/review-now         run the daily review now (manager)
 *   GET  /meat-timing/pending-reasons?planId=  off-time put-ins on this plan
 *                                        with no "why?" yet (station)
 *   POST /meat-timing/put-ins/:id/reason quick-pick reason (station)
 *
 * The maths: @workspace/production-schedule meat-timing-learning.ts (pure,
 * tested). The database side: lib/meat-timing-learner.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LEARNING_RULES, PUT_IN_REASONS } from "@workspace/production-schedule";
import { pendingReasons, saveReason, reasonThresholdMinutes, REASON_THRESHOLD_SETTING } from "../lib/meat-put-in";
import { backfillPutInRecords, reviewDueRecords, weeklyReasonSummary, headlineNumbers } from "../lib/meat-daily-review-job";
import { validate } from "../middleware/validate";
import { requireAdmin, requireManagerOrAdmin } from "../middleware/roles";
import {
  buildMeatTimingReport, applyLearnedTimings, listAdjustments, revertAdjustment, setMeatTiming,
  loadMeatTimingSettings, saveSetting,
  LEARNING_ENABLED_SETTING, WAIT_WEIGHT_SETTING, BUFFER_MAX_SETTING,
} from "../lib/meat-timing-learner";

const router: IRouter = Router();

async function actorOf(req: Request): Promise<{ userId: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { userId: id, name: u?.name ?? "Someone" };
}

router.get("/", async (_req: Request, res: Response) => {
  const [meats, adjustments, settings, weekly, reasonMinutes, headline] = await Promise.all([
    buildMeatTimingReport(), listAdjustments(), loadMeatTimingSettings(), weeklyReasonSummary(), reasonThresholdMinutes(),
    headlineNumbers(14),
  ]);
  res.json({ headline, meats, adjustments, weekly, reasons: PUT_IN_REASONS, rules: LEARNING_RULES, settings: { ...settings, reasonMinutes } });
});

router.post("/review-now", requireManagerOrAdmin, validate(z.object({})), async (_req: Request, res: Response) => {
  const backfilled = await backfillPutInRecords();
  const reviewed = await reviewDueRecords(true);
  res.json({ backfilled, reviewed });
});

// Station side — any signed-in user (the prep person).
router.get("/pending-reasons", async (req: Request, res: Response) => {
  const planId = Number(req.query.planId);
  if (!Number.isInteger(planId) || planId <= 0) { res.status(400).json({ error: "planId required" }); return; }
  res.json({ pending: await pendingReasons(planId), reasons: PUT_IN_REASONS });
});

const ReasonBody = z.object({
  code: z.enum(PUT_IN_REASONS.map(r => r.code) as [string, ...string[]]),
  note: z.string().trim().max(500).optional(),
});

router.post("/put-ins/:id/reason", validate(ReasonBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  const b = req.body as z.infer<typeof ReasonBody>;
  if (b.code === "other" && !b.note) { res.status(400).json({ error: "Say what happened" }); return; }
  const actor = await actorOf(req);
  const ok = await saveReason(id, b.code, b.note ?? null, actor.name);
  if (!ok) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

router.post("/run", requireManagerOrAdmin, validate(z.object({})), async (req: Request, res: Response) => {
  const applied = await applyLearnedTimings(await actorOf(req));
  res.json({ applied });
});

router.post("/adjustments/:id/revert", requireManagerOrAdmin, validate(z.object({})), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  const result = await revertAdjustment(id, await actorOf(req));
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json({ ok: true });
});

const IngredientBody = z.object({
  processMinutes: z.number().int().min(0).max(LEARNING_RULES.processMax).optional(),
  // Same bounds by hand as learned.
  bufferMinutes: z.number().int().min(0).max(60).optional(),
  autoLearn: z.boolean().optional(),
});

router.put("/ingredients/:id", requireManagerOrAdmin, validate(IngredientBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Bad id" }); return; }
  const ok = await setMeatTiming(id, req.body as z.infer<typeof IngredientBody>, await actorOf(req));
  if (!ok) { res.status(404).json({ error: "Ingredient not found" }); return; }
  res.json({ ok: true });
});

const SettingsBody = z.object({
  learningEnabled: z.boolean().optional(),
  // Put in further than this from the suggested time → ask why.
  reasonMinutes: z.number().int().min(3).max(60).optional(),
  // A minute of builder wait costs this many of sitting.
  waitWeight: z.number().min(1).max(20).optional(),
  bufferMaxMinutes: z.number().int().min(2).max(60).optional(),
});

router.put("/settings", requireAdmin, validate(SettingsBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof SettingsBody>;
  if (b.learningEnabled !== undefined) await saveSetting(LEARNING_ENABLED_SETTING, b.learningEnabled ? "true" : "false");
  if (b.reasonMinutes !== undefined) await saveSetting(REASON_THRESHOLD_SETTING, String(b.reasonMinutes));
  if (b.waitWeight !== undefined) await saveSetting(WAIT_WEIGHT_SETTING, String(b.waitWeight));
  if (b.bufferMaxMinutes !== undefined) await saveSetting(BUFFER_MAX_SETTING, String(b.bufferMaxMinutes));
  res.json({ settings: await loadMeatTimingSettings() });
});

export default router;
