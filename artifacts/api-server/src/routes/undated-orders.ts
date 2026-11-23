/**
 * Orders with no delivery date — the managers' dashboard warning (Graeme,
 * 23 Nov 2026). Rules: lib/undated-orders-rules.ts.
 *
 *   GET  /api/undated-orders                    the orders, and the days to pick from
 *   POST /api/undated-orders/:id/mark-fine      doesn't need sending; off the list
 *   POST /api/undated-orders/:id/delivery-date  { deliveryDate } — tags it in Shopify
 *
 * Managers and admins only (guarded where the router is mounted).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { listUndatedOrders, markUndatedOrderFine, setUndatedOrderDeliveryDate, UndatedOrderError } from "../lib/undated-orders";
import { recordWarningAction, userNameOf } from "../lib/warning-log";

const router: IRouter = Router();

const orderIdOf = (req: Request): number | null => {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json(await listUndatedOrders());
  } catch (err) {
    console.error("[undated-orders] read failed:", err);
    res.status(502).json({ error: "Couldn't read the orders from Shopify. Try again in a moment." });
  }
});

router.post("/:id/mark-fine", validate(z.object({})), async (req: Request, res: Response) => {
  const orderId = orderIdOf(req);
  if (orderId == null) { res.status(400).json({ error: "That isn't an order." }); return; }
  try {
    const name = await markUndatedOrderFine(orderId, await userNameOf(req.session.userId));
    await recordWarningAction({
      warning: "undated_order", action: "mark_fine", page: req.get("referer") ?? null, userId: req.session.userId,
      detail: `${name} marked as fine with no delivery date`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[undated-orders] mark fine failed:", err);
    res.status(500).json({ error: "Couldn't mark it as fine. Try again." });
  }
});

const deliveryDateBody = z.object({ deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a delivery day.") });

router.post("/:id/delivery-date", validate(deliveryDateBody), async (req: Request, res: Response) => {
  const orderId = orderIdOf(req);
  if (orderId == null) { res.status(400).json({ error: "That isn't an order." }); return; }
  const { deliveryDate } = req.body as z.infer<typeof deliveryDateBody>;
  try {
    const done = await setUndatedOrderDeliveryDate(orderId, deliveryDate);
    await recordWarningAction({
      warning: "undated_order", action: "set_delivery_date", page: req.get("referer") ?? null, userId: req.session.userId,
      detail: `${done.name} given delivery date ${deliveryDate}${done.previousBookedDate ? ` (customer had booked ${done.previousBookedDate})` : ""}`,
    });
    res.json({ ok: true, name: done.name, deliveryDate });
  } catch (err) {
    if (err instanceof UndatedOrderError) { res.status(err.status).json({ error: err.message }); return; }
    console.error("[undated-orders] set delivery date failed:", err);
    res.status(502).json({ error: "Shopify didn't take the change. Nothing was changed; try again in a moment." });
  }
});

export default router;
