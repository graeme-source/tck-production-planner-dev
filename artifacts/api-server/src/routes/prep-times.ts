/**
 * Prep times and batch profit — a founder-only READ endpoint, no screen
 * (Graeme, 27 Oct 2026: "Let's not show anything to the users in the
 * frontend. I just want to get actual timing on those things."; Objectives
 * C and I).
 *
 *   GET /api/prep-times/report → services/prep-times-report.ts: how much
 *     timing data there is; prep items by median minutes; and per recipe
 *     batch: prep minutes, line minutes, gross £, line labour £, prep
 *     labour £, profit after both, profit per line-minute.
 *
 * The labour settings it uses are app_settings rows (keys in
 * lib/prep-batch-cost.ts LABOUR_SETTING_KEYS — £17.05/hour, prep crew 1,
 * line crew 4, 2 builders when unset), changed through the existing
 * admin-only PUT /api/app-settings/:key. The report says which it used.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireFounder } from "../middleware/founder-access";
import { buildPrepTimesReport } from "../services/prep-times-report";

const router: IRouter = Router();

router.get("/report", requireFounder, async (_req: Request, res: Response) => {
  try {
    res.json(await buildPrepTimesReport());
  } catch (err) {
    console.error("[prep-times] report failed:", err);
    res.status(500).json({ error: "Couldn't build the prep times report" });
  }
});

export default router;
