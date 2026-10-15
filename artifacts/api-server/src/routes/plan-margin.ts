/**
 * Production safety margin settings (Graeme, 15 Oct 2026). Objective C.
 *
 *   GET /plan-margin   { settings } — the Create / Edit Plan screens size
 *                      their suggestions and warnings from these
 *   PUT /plan-margin   manager+: { smallMarginPacks, largeMarginPacks,
 *                      largeBatchThreshold } (autosaved on the screen)
 *
 * Rule: stock + planned packs ≥ orders + margin; margin = smallMarginPacks
 * (2), or largeMarginPacks (4) when the orders alone need more than
 * largeBatchThreshold (12) batches. See @workspace/plan-margin.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { loadPlanMarginSettings, savePlanMarginSettings } from "../lib/plan-margin-settings";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  res.json({ settings: await loadPlanMarginSettings() });
});

const SettingsBody = z.object({
  smallMarginPacks: z.number().int().min(0).max(100),
  largeMarginPacks: z.number().int().min(0).max(200),
  largeBatchThreshold: z.number().int().min(0).max(500),
});

router.put("/", requireManagerOrAdmin, validate(SettingsBody), async (req, res) => {
  await savePlanMarginSettings(req.body as z.infer<typeof SettingsBody>);
  res.json({ settings: await loadPlanMarginSettings() });
});

export default router;
