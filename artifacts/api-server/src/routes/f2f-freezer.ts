/**
 * Freezer moves → F2F stock in Shopify (Graeme, 25 Nov 2026): the switch,
 * the confirm preview, and the failed-push list with Retry. Objective C.
 * Rules: lib/f2f-freezer-push-rules.ts; ledger: lib/f2f-freezer-push.ts.
 *
 *   GET  /f2f-freezer/status               { enabled } — anyone signed in (the
 *                                          stations ask before a freezer move)
 *   POST /f2f-freezer/preview              { source, items: [{ recipeId, packs, planItemId? }] }
 *                                          → what would go to Shopify and what
 *                                          wouldn't (reads only) — anyone signed in
 *   GET  /f2f-freezer/setting              switch + gate (why it can't go on) — managers/admins
 *   PUT  /f2f-freezer/setting              { enabled } — admins; turning ON is
 *                                          refused (409, with the reasons) while
 *                                          any core recipe has no F2F product
 *   GET  /f2f-freezer/pushes               failed / skipped / stuck pushes + the latest — managers/admins
 *   POST /f2f-freezer/pushes/:id/retry     a failed push (or an untracked skip) — managers/admins
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdmin, requireManagerOrAdmin } from "../middleware/roles";
import {
  f2fPushGateNow, getF2fPushEnabled, listF2fPushes, planF2fMove, retryF2fPush, setF2fPushEnabled, userName,
} from "../lib/f2f-freezer-push";
import { shopifyWritesBlocked } from "../services/shopify";

const router: IRouter = Router();

router.get("/f2f-freezer/status", async (_req: Request, res: Response) => {
  res.json({ enabled: await getF2fPushEnabled() });
});

const PreviewBody = z.object({
  source: z.enum(["wrap_freezer", "wonky", "closing_check"]),
  items: z.array(z.object({
    recipeId: z.number().int().positive(),
    packs: z.number().int().min(1).max(10_000),
    planItemId: z.number().int().positive().nullish(),
  })).max(200),
});

router.post("/f2f-freezer/preview", validate(PreviewBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof PreviewBody>;
  try {
    res.json(await planF2fMove(b.source, b.items));
  } catch (err) {
    console.error("[f2f-freezer] preview failed:", err);
    res.status(500).json({ error: "Couldn't check what goes to Shopify" });
  }
});

router.get("/f2f-freezer/setting", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  try {
    const [enabled, gate] = await Promise.all([getF2fPushEnabled(), f2fPushGateNow()]);
    res.json({ enabled, canTurnOn: gate.canTurnOn, reasons: gate.reasons, unlinkedCore: gate.unlinkedCore, writesBlocked: shopifyWritesBlocked() });
  } catch (err) {
    console.error("[f2f-freezer] setting read failed:", err);
    res.status(500).json({ error: "Couldn't load the switch" });
  }
});

const SettingBody = z.object({ enabled: z.boolean() });

router.put("/f2f-freezer/setting", requireAdmin, validate(SettingBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof SettingBody>;
  const id = req.session.userId!;
  const out = await setF2fPushEnabled(b.enabled, { id, name: (await userName(id)) ?? "Someone" });
  if (!out.ok) { res.status(409).json({ error: `Can't switch it on yet. ${out.reasons.join(" ")}`, reasons: out.reasons }); return; }
  res.json({ enabled: out.enabled });
});

router.get("/f2f-freezer/pushes", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  try {
    res.json(await listF2fPushes());
  } catch (err) {
    console.error("[f2f-freezer] list failed:", err);
    res.status(500).json({ error: "Couldn't load the Shopify updates" });
  }
});

const PushParams = z.object({ id: z.coerce.number().int().positive() });
const RetryBody = z.object({}).passthrough();

router.post("/f2f-freezer/pushes/:id/retry", requireManagerOrAdmin, validate(RetryBody), async (req: Request, res: Response) => {
  const p = PushParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid push id" }); return; }
  const out = await retryF2fPush(p.data.id);
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.json(out.row);
});

export default router;
