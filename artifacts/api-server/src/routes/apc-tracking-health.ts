/**
 * GET /api/fulfilment/apc-tracking-health (issue #339).
 *
 * Polled by the packing screen's pick list. Two jobs:
 *   - kicks the background re-read of today's consignments' APC tracking
 *     (throttled, fire-and-forget, read-only at APC) so opening an order uses
 *     a cached answer instead of waiting on APC;
 *   - says whether APC tracking has been slow several times in a row, so the
 *     pick list shows ONE banner rather than a warning on every order.
 * No request body.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireFulfilmentAccess } from "../lib/fulfilment-access";
import { apcBaseFromSettings, apcTrackingSlowNow, refreshTodaysTrackingInBackground } from "../lib/apc-consignment-ledger";
import { SLOW_BANNER_TEXT } from "../lib/apc-tracking-cache";

const router: IRouter = Router();

router.get("/apc-tracking-health", requireFulfilmentAccess, async (_req: Request, res: Response) => {
  try {
    refreshTodaysTrackingInBackground(await apcBaseFromSettings());
  } catch (err) {
    console.warn("[apc-tracking-health] could not start the background re-check:", err instanceof Error ? err.message : err);
  }
  const slow = apcTrackingSlowNow();
  res.json({ slow, message: slow ? SLOW_BANNER_TEXT : null });
});

export default router;
