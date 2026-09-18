/**
 * Meta ad-spend sync — status and manual refresh.
 *
 * Founder-only, same gate as the rest of the Numbers page. Kept in its own
 * router rather than bolted onto founder-focus.ts, which is already long.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireFounder } from "../middleware/founder-access";
import { getMetaAdsStatus, runMetaAdSpendSync } from "../lib/meta-ads";

const router: IRouter = Router();
router.use(requireFounder);

/**
 * Is Meta connected, and what did the last sync do?
 *
 * Always 200, even with no credentials — "not connected" is a state to show,
 * not an error. Never returns a token or any part of one.
 */
router.get("/status", async (_req: Request, res: Response) => {
  res.json(await getMetaAdsStatus());
});

// The refresh button sends nothing today; the schema exists so the endpoint
// validates like every other, and so a future option (a wider backfill, say)
// can't arrive unvalidated.
const RefreshBody = z.object({}).strict().optional();

/**
 * "Refresh from Meta". Runs the same sync the daily schedule runs, and
 * returns what it did, so the panel can say something true either way.
 */
router.post("/refresh", validate(RefreshBody), async (_req: Request, res: Response) => {
  const result = await runMetaAdSpendSync("manual");
  // The sync never throws; an unreachable Meta is ok:false with a message.
  // 200 regardless, so the client reads the body rather than guessing.
  res.json(result);
});

export default router;
