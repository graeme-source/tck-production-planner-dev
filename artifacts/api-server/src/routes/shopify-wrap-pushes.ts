/**
 * Wrap-to-Shopify ledger endpoints (lib/shopify-wrap-push.ts). Mounted at the
 * /api root with full paths, ahead of the frozen production-plans router.
 *
 *   GET  /production-plans/:id/shopify-wrap-pushes   every push on a plan +
 *        each item's on-screen state (sent ✓ / failed — retry / off here)
 *   POST /shopify-wrap-pushes/:pushId/retry          a FAILED push only
 *   GET  /shopify-wrap-pushes/settings               pinned location, whether
 *        this server may write, and (manager+) the store's locations — READ
 *   PUT  /shopify-wrap-pushes/settings               admin: pin the location
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireAdmin, requireManagerOrAdmin } from "../middleware/roles";
import { getWrapLocationSetting, listWrapPushes, retryWrapPush, setWrapLocationSetting } from "../lib/shopify-wrap-push";
import { locationGid } from "../lib/shopify-wrap-push-rules";
import { getShopifyLocations, shopifyWritesBlocked } from "../services/shopify";

const router: IRouter = Router();

const PlanParams = z.object({ id: z.coerce.number().int().positive() });
const PushParams = z.object({ pushId: z.coerce.number().int().positive() });

router.get("/production-plans/:id/shopify-wrap-pushes", async (req: Request, res: Response) => {
  const p = PlanParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid plan id" }); return; }
  res.json(await listWrapPushes(p.data.id));
});

const RetryBody = z.object({}).passthrough();

router.post("/shopify-wrap-pushes/:pushId/retry", validate(RetryBody), async (req: Request, res: Response) => {
  const p = PushParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid push id" }); return; }
  const out = await retryWrapPush(p.data.pushId);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.json(out.row);
});

router.get("/shopify-wrap-pushes/settings", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  const locationId = await getWrapLocationSetting();
  let locations: Array<{ id: string; name: string; isActive: boolean }> | null = null;
  let locationsError: string | null = null;
  try {
    locations = await getShopifyLocations();
  } catch (err) {
    locationsError = err instanceof Error ? err.message : String(err);
  }
  res.json({ locationId, writesBlocked: shopifyWritesBlocked(), locations, locationsError });
});

const SettingsBody = z.object({
  locationId: z.string().trim().max(80).nullable(),
});

router.put("/shopify-wrap-pushes/settings", requireAdmin, validate(SettingsBody), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof SettingsBody>;
  if (body.locationId === null || body.locationId === "") {
    await setWrapLocationSetting(null);
    res.json({ locationId: null });
    return;
  }
  const gid = locationGid(body.locationId);
  if (!gid) { res.status(400).json({ error: "That isn't a Shopify location id" }); return; }
  await setWrapLocationSetting(gid);
  res.json({ locationId: gid });
});

export default router;
