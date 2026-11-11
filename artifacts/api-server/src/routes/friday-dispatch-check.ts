/**
 * Friday dispatch check (Graeme, 11 Nov 2026). Objective C. Mounted under
 * /api/fulfilment.
 *
 *   GET  /friday-check?dispatchDate=YYYY-MM-DD        the check (read-only)
 *   GET  /friday-check/orders/:orderId/email?dispatchDate=   the exact email
 *   POST /friday-check/orders/:orderId/email          send it (confirmed in the UI)
 *
 * Moving an order is the existing reschedule route (POST
 * /orders/:orderId/reschedule in routes/fulfilment.ts), which records the
 * move here when the Friday check passes its dispatch date.
 *
 * Reading follows the packing screen (requireFulfilmentAccess), as the
 * booking-issues report does. The email follows the courier-actions
 * permission (Book APC labels / "Fix APC booking problems"), as the
 * booking-issues emails and rescheduling do. Nothing here writes to
 * Shopify or books with APC; the only side effect is a customer email,
 * and only from a confirmed button press.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import { requireFeature, userCan } from "../lib/feature-access";
import { requireFulfilmentAccess, resolveRole } from "../lib/fulfilment-access";
import { londonDateString } from "../lib/london-time";
import { sendEmail } from "../lib/email";
import { firstNameOf, greetingNameOf, friendlyDate } from "../lib/order-reschedule";
import { noSaturdayThisWeekEmail, CUSTOMER_EMAIL_BCC } from "../lib/apc-issue-emails";
import { loadPostcodeContext } from "../lib/apc-postcode-context";
import { lookupPostcodeService, POSTINFO_SOURCE } from "../services/apc-postinfo";
import { getOrdersByTagIncludingCancelled, getOrderForReschedule, shopifyAdminOrderBase } from "../services/shopify";
import {
  apcOrdersForCheck, checkOrder, comingFriday, doneStateByOrder, fridayDates, isFridayDate, runFridayCheck, DEPOT_REFUSAL_DAYS,
} from "../lib/friday-dispatch-check";
import { loadFridayActions, loadRecentSaturdayRefusals, recordFridayAction } from "../lib/friday-dispatch-check-db";

const router: IRouter = Router();
const requireCourier = requireFeature("ability.book_apc_labels");

async function viewerCanCourier(req: Request): Promise<boolean> {
  const role = await resolveRole(req);
  return !!role && (await userCan(req.session.userId, role, "ability.book_apc_labels"));
}

async function userName(req: Request): Promise<string> {
  if (!req.session.userId) return "unknown";
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  return r.rows[0]?.name ?? `user ${req.session.userId}`;
}

const fridayDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dispatchDate must be YYYY-MM-DD")
  .refine(isFridayDate, "dispatchDate must be a Friday");

const checkQuery = z.object({ dispatchDate: fridayDate.optional() });

/** The error in one readable line — Shopify's token errors carry a whole
 *  HTML page after the first sentence. */
function errMsg(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const plain = msg.split("<")[0].trim().replace(/:$/, "");
  return (plain || msg).slice(0, 300);
}

// GET /friday-check — every APC order due out on the Friday, judged.
router.get("/friday-check", requireFulfilmentAccess, validateQuery(checkQuery), async (req: Request, res: Response) => {
  const today = londonDateString();
  const { dispatchDate: asked } = res.locals["query"] as z.infer<typeof checkQuery>;
  const dispatchDate = asked ?? comingFriday(today);
  const dates = fridayDates(dispatchDate);

  // Shopify first, and on its own: a failed read must say so, never show
  // an empty Friday that reads as "all fine".
  let shopifyOrders;
  try {
    shopifyOrders = await getOrdersByTagIncludingCancelled(dates.deliveryDate);
  } catch (err) {
    console.error("[friday-check] Shopify read failed:", errMsg(err));
    res.status(502).json({ error: `Couldn't read the orders tagged ${dates.deliveryDate} from Shopify, so nothing was checked: ${errMsg(err)}` });
    return;
  }

  try {
    const [context, refusals, actions, canCourier] = await Promise.all([
      loadPostcodeContext(),
      loadRecentSaturdayRefusals(dispatchDate),
      loadFridayActions(dispatchDate),
      viewerCanCourier(req),
    ]);
    const now = new Date();
    const { results, summary } = runFridayCheck({
      dispatchDate,
      today,
      orders: apcOrdersForCheck(shopifyOrders),
      serviceFor: pc => lookupPostcodeService(pc, undefined, context.overrides, now),
      refusals,
    });
    const done = doneStateByOrder(actions);
    const listed = new Set(results.map(r => r.orderId));
    // Moved from here, so no longer on the Saturday tag — listed apart so
    // the move is visible rather than the order simply vanishing.
    const moved = [...done.entries()]
      .filter(([id, s]) => s.movedTo && !listed.has(id))
      .map(([id, s]) => ({ orderId: id, orderName: actions.find(a => a.orderId === id)?.orderName ?? String(id), ...s }));

    res.json({
      today,
      dispatchDate,
      dates: {
        ...dates,
        dispatchLabel: friendlyDate(dates.dispatchDate),
        deliveryLabel: friendlyDate(dates.deliveryDate),
        replyByLabel: friendlyDate(dates.replyBy),
      },
      summary: { ...summary, moved: moved.length },
      results: results.map(r => ({ ...r, done: done.get(r.orderId) ?? null })),
      moved,
      canCourier,
      adminOrderBase: shopifyAdminOrderBase(),
      refusalsConsidered: refusals.length,
      refusalDays: DEPOT_REFUSAL_DAYS,
      source: POSTINFO_SOURCE,
    });
  } catch (err) {
    console.error("[friday-check] failed:", err);
    res.status(500).json({ error: `Couldn't run the Friday check: ${errMsg(err)}` });
  }
});

/** The email for one order, built from Shopify as it is now and the check
 *  re-run for that order — never from what the browser last saw. */
async function emailPlan(req: Request, res: Response, dispatchDate: string) {
  const orderId = Number(req.params["orderId"]);
  if (!Number.isInteger(orderId) || orderId <= 0) { res.status(400).json({ error: "Invalid order" }); return null; }
  const dates = fridayDates(dispatchDate);
  const order = await getOrderForReschedule(orderId);
  if (!order) { res.status(502).json({ error: "Couldn't read that order from Shopify — nothing was sent." }); return null; }
  const tags = order.tags.split(",").map(t => t.trim());
  if (!tags.includes(dates.deliveryDate)) {
    res.status(409).json({ error: `${order.name} isn't tagged ${dates.deliveryDate} any more — its date has already changed.` });
    return null;
  }
  const [context, refusals, actions] = await Promise.all([
    loadPostcodeContext(), loadRecentSaturdayRefusals(dispatchDate), loadFridayActions(dispatchDate),
  ]);
  const service = lookupPostcodeService(order.shippingPostcode, undefined, context.overrides, new Date());
  const result = checkOrder(
    { orderId, orderName: order.name, customerName: order.shippingName ?? "", postcode: order.shippingPostcode },
    service, refusals, dates, londonDateString(),
  );
  if (!result.canEmail) {
    res.status(409).json({ error: result.status === "ok" ? `${order.name} should get its Saturday delivery — no email needed.` : (result.emailNote ?? "That email isn't offered for this order.") });
    return null;
  }
  const sender = await userName(req);
  const email = noSaturdayThisWeekEmail({
    customerFirstName: greetingNameOf({ first: order.customerFirstName, last: order.customerLastName, full: order.shippingName }, "there"),
    senderFirstName: firstNameOf(sender, "The Calzone Kitchen"),
    orderName: order.name,
    dates,
    offerThursday: result.canOfferThursday,
  });
  return { order, result, sender, email, done: doneStateByOrder(actions).get(orderId) ?? null };
}

const emailQuery = z.object({ dispatchDate: fridayDate });

// GET — the exact email, for the confirm step. Sends nothing.
router.get("/friday-check/orders/:orderId/email", requireCourier, validateQuery(emailQuery), async (req: Request, res: Response) => {
  const { dispatchDate } = res.locals["query"] as z.infer<typeof emailQuery>;
  try {
    const plan = await emailPlan(req, res, dispatchDate);
    if (!plan) return;
    res.json({
      orderName: plan.order.name,
      customerName: plan.order.shippingName,
      to: plan.order.email,
      subject: plan.email.subject,
      body: plan.email.body,
      offerThursday: plan.result.canOfferThursday,
      alreadyEmailedAt: plan.done?.emailedAt ?? null,
      alreadyEmailedBy: plan.done?.emailedBy ?? null,
    });
  } catch (err) {
    console.error("[friday-check] email preview failed:", errMsg(err));
    res.status(500).json({ error: `Couldn't build the email: ${errMsg(err)}` });
  }
});

const sendSchema = z.object({
  dispatchDate: fridayDate,
  /** The order number the person confirmed on screen — must match, so a
   *  stale or mis-tapped confirm can't email the wrong customer. */
  confirmOrderName: z.string().trim().min(1).max(40),
});

// POST — send it. Only ever from a confirmed button press.
router.post("/friday-check/orders/:orderId/email", requireCourier, validate(sendSchema), async (req: Request, res: Response) => {
  const { dispatchDate, confirmOrderName } = req.body as z.infer<typeof sendSchema>;
  try {
    const plan = await emailPlan(req, res, dispatchDate);
    if (!plan) return;
    if (confirmOrderName !== plan.order.name) {
      res.status(409).json({ error: `This is ${plan.order.name}, not ${confirmOrderName} — nothing was sent.` });
      return;
    }
    if (!plan.order.email) { res.status(409).json({ error: "No email address on this order." }); return; }
    try {
      await sendEmail({ to: plan.order.email, bcc: [CUSTOMER_EMAIL_BCC], subject: plan.email.subject, text: plan.email.body, html: plan.email.html });
    } catch (err) {
      console.error(`[friday-check] email failed for ${plan.order.name}:`, errMsg(err));
      res.status(502).json({ error: `The email didn't send: ${errMsg(err)}` });
      return;
    }
    // Sent. A hiccup recording it must not read as a failed send.
    try {
      await recordFridayAction({
        dispatchDate, orderId: plan.order.id, orderName: plan.order.name, kind: "emailed",
        detail: plan.order.email, byUserId: req.session.userId ?? null, byName: plan.sender,
      });
    } catch (logErr) {
      console.warn(`[friday-check] email to ${plan.order.name} sent but not recorded:`, errMsg(logErr));
    }
    console.log(`[friday-check] no-Saturday email sent for ${plan.order.name} by ${plan.sender}`);
    res.json({ ok: true, to: plan.order.email });
  } catch (err) {
    console.error("[friday-check] email send failed:", errMsg(err));
    res.status(500).json({ error: `Couldn't send the email: ${errMsg(err)}` });
  }
});

export default router;
