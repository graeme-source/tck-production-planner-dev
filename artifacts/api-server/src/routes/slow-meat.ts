/**
 * Slow-meat tray limit (Graeme, 2026-10-01): the kitchen can only cook a set
 * number of trays of slow meat (cook time ≥ a threshold — the pork for pulled
 * pork and the slow-cooked beefs today) for one production plan.
 *
 *   GET /slow-meat/profile    settings + per-recipe slow-meat kg per batch;
 *                             the Create Plan screen counts trays live and
 *                             caps its suggestions from this
 *   PUT /slow-meat/settings   admin: { minCookMinutes, trayLimit }
 *
 * slowMeatPlanGuard is mounted under /production-plans AHEAD of the frozen
 * production-plans router (charter rule 4 — no new code in that file), and
 * checks the two saves the Create Plan screen makes:
 *   POST /production-plans       new plan  → 409 when over the limit
 *   PUT  /production-plans/:id   items     → 409 when over the limit AND the
 *                                            edit adds slow-meat trays (an
 *                                            existing over-limit plan can still
 *                                            be edited or trimmed)
 * The maths is @workspace/slow-meat (tested); the weights come from
 * lib/slow-meat-profile.ts (the Raw Meat station's own tray weights).
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import * as z from "zod";
import { countSlowMeatTrays, checkSlowMeatSave, type PlanLine } from "@workspace/slow-meat";
import { validate } from "../middleware/validate";
import { requireAdmin } from "../middleware/roles";
import { loadSlowMeatSettings, saveSlowMeatSettings, loadSlowMeatProfiles, loadPlanLines } from "../lib/slow-meat-profile";

const router: IRouter = Router();

router.get("/profile", async (_req, res) => {
  const settings = await loadSlowMeatSettings();
  const profiles = await loadSlowMeatProfiles(settings);
  res.json({ settings, profiles });
});

const SettingsBody = z.object({
  minCookMinutes: z.number().int().min(1).max(24 * 60),
  trayLimit: z.number().int().min(0).max(500),
});

router.put("/settings", requireAdmin, validate(SettingsBody), async (req, res) => {
  const body = req.body as z.infer<typeof SettingsBody>;
  await saveSlowMeatSettings(body);
  res.json({ settings: await loadSlowMeatSettings() });
});

export default router;

// ── Save guard for the frozen production-plans router ──────────────────────

// Loose on purpose: the real validation (CreatePlanBody / UpdatePlanBody)
// runs after this. Anything that doesn't look like plan items is passed on
// untouched for that validator to answer.
const ItemsBody = z.object({
  items: z.array(z.object({
    recipeId: z.number().int(),
    batchesTarget: z.number().nullish(),
  }).passthrough()),
}).passthrough();

async function guard(req: Request, res: Response, next: NextFunction, planId: number | null): Promise<void> {
  const parsed = ItemsBody.safeParse(req.body);
  if (!parsed.success || parsed.data.items.length === 0) { next(); return; }
  try {
    const after: PlanLine[] = parsed.data.items.map(i => ({ recipeId: i.recipeId, batches: Number(i.batchesTarget) || 0 }));
    const beforeLines = planId != null ? await loadPlanLines(planId) : null;
    const recipeIds = [...new Set([...after, ...(beforeLines ?? [])].map(l => l.recipeId))];
    const settings = await loadSlowMeatSettings();
    const profiles = await loadSlowMeatProfiles(settings, recipeIds);
    const afterCount = countSlowMeatTrays(profiles, after, settings);
    const beforeCount = beforeLines ? countSlowMeatTrays(profiles, beforeLines, settings) : null;
    const verdict = checkSlowMeatSave({ after: afterCount, before: beforeCount });
    if (!verdict.ok) {
      res.status(409).json({ error: verdict.message, code: "SLOW_MEAT_LIMIT", slowMeat: afterCount });
      return;
    }
  } catch (err) {
    // Never let a fault in this check stop the kitchen saving a plan — the
    // Create Plan screen enforces the same limit before it ever sends.
    console.error("[slow-meat] plan save check failed; allowing the save:", err);
  }
  next();
}

export const slowMeatPlanGuard: IRouter = Router();

slowMeatPlanGuard.post("/", (req, res, next) => guard(req, res, next, null));

slowMeatPlanGuard.put("/:id", (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { next(); return; }
  return guard(req, res, next, id);
});
