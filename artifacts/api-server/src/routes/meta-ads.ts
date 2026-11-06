/**
 * Meta ad-spend sync — status and manual refresh.
 *
 * Same gate as the rest of the Numbers page: the founder, or a
 * founder.numbers grantee (the Refresh button is on that page). Kept in its own
 * router rather than bolted onto founder-focus.ts, which is already long.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate, validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { getMetaAdsStatus, runMetaAdSpendSync } from "../lib/meta-ads";
import { getAdsReport } from "../lib/meta-ads-report";

const router: IRouter = Router();
router.use(requireFounderArea("founder.numbers"));

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

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ReportQuery = z
  .object({ from: day, to: day, refresh: z.literal("1").optional() })
  .refine(q => q.from <= q.to, { message: "from must be on or before to" });

/**
 * The Ads page: live campaigns, ad sets and ads with their figures for a
 * period. Read-only. Always 200: "not connected" and "Meta didn't answer" are
 * states to show, and the body says which.
 */
router.get("/report", validateQuery(ReportQuery), async (_req: Request, res: Response) => {
  const { from, to, refresh } = res.locals["query"] as z.infer<typeof ReportQuery>;
  res.json(await getAdsReport(from, to, refresh === "1"));
});

export default router;
