/**
 * Friday dispatch check (Graeme, 11 Nov 2026). Objective C. Mounted under
 * /api/fulfilment.
 *
 *   GET  /friday-check?dispatchDate=YYYY-MM-DD        the check (read-only)
 *   GET  /friday-check/orders/:orderId/email?dispatchDate=   the exact email
 *   POST /friday-check/orders/:orderId/email          reschedule + email (confirmed in the UI)
 *
 * "Reschedule & email" (Graeme, 11 Nov 2026): one press moves the order to
 * the Tuesday after (Monday's dispatch) exactly as the packing screen's
 * reschedule does — date tag, weekday tag, dispatch tag off, Zapiet
 * Delivery-Date, any old APC booking retired — then emails the customer that
 * it HAS moved, with a link to the website assistant to choose a sooner day
 * themselves. Orders holding test production or 8-pack bags are never moved
 * from here (lib/date-locked-products-rules.ts): those are changed by hand.
 *
 * Reading follows the packing screen (requireFulfilmentAccess), as the
 * booking-issues report does. The email follows the courier-actions
 * permission (Book APC labels / "Fix APC booking problems"), as the
 * booking-issues emails and rescheduling do. The only writes — the order's
 * tags and delivery date, and the customer email — come from one confirmed
 * button press. Nothing books with APC.
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
import { firstNameOf, greetingNameOf, friendlyDate, rescheduleTags, withDeliveryDate } from "../lib/order-reschedule";
import { rescheduledWithLinkEmail, CUSTOMER_EMAIL_BCC } from "../lib/apc-issue-emails";
import { lockedLines, lockedReason, safeToMoveCandidates } from "../lib/date-locked-products-rules";
import { clearDateLockedProductsCache, loadDateLockedProducts, loadSafeToMoveProducts } from "../lib/date-locked-products";
import { rescheduleLinkFor } from "../lib/cs-agent-links";
import { supersedeOrderConsignments } from "../lib/apc-consignment-ledger";
import { londonDayStartUtc } from "../lib/london-time";
import { firstDeliveryAfterWeekend } from "../lib/next-delivery-after-weekend";
import { loadDeliveryCalendar } from "../lib/next-delivery-calendar";
import { loadPostcodeContext } from "../lib/apc-postcode-context";
import { lookupPostcodeService, POSTINFO_SOURCE } from "../services/apc-postinfo";
import { getOrdersByTagIncludingCancelled, getOrderById, getOrderForReschedule, shopifyAdminOrderBase, updateOrderTagsAndAttributes } from "../services/shopify";
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
  const { dates, calendarChecked } = await datesFor(dispatchDate);

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
    const [context, refusals, actions, canCourier, locked, safeProducts] = await Promise.all([
      loadPostcodeContext(),
      loadRecentSaturdayRefusals(dispatchDate),
      loadFridayActions(dispatchDate),
      viewerCanCourier(req),
      loadDateLockedProducts(),
      loadSafeToMoveProducts(),
    ]);
    const lockedById = new Map(shopifyOrders.map(o => {
      const lines = lockedLines(o.line_items, locked);
      return [o.id, { reason: lockedReason(lines), safeCandidates: safeToMoveCandidates(lines, locked) }];
    }));
    const now = new Date();
    const { results, summary } = runFridayCheck({
      dispatchDate,
      dates,
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
      results: results.map(r => ({
        ...r,
        lockedReason: lockedById.get(r.orderId)?.reason ?? null,
        safeCandidates: lockedById.get(r.orderId)?.safeCandidates ?? [],
        done: done.get(r.orderId) ?? null,
      })),
      safeProducts,
      moved,
      canCourier,
      adminOrderBase: shopifyAdminOrderBase(),
      refusalsConsidered: refusals.length,
      refusalDays: DEPOT_REFUSAL_DAYS,
      calendarChecked,
      source: POSTINFO_SOURCE,
    });
  } catch (err) {
    console.error("[friday-check] failed:", err);
    res.status(500).json({ error: `Couldn't run the Friday check: ${errMsg(err)}` });
  }
});

/** The Friday's dates, with "next week" = the first delivery day after that
 *  weekend the calendar allows (bank holidays, Zapiet blackouts) — normally
 *  Tuesday (Monday's dispatch), Graeme 11 Nov 2026. */
async function datesFor(dispatchDate: string): Promise<{ dates: ReturnType<typeof fridayDates>; calendarChecked: boolean }> {
  const base = fridayDates(dispatchDate);
  const { calendar, zapiet } = await loadDeliveryCalendar();
  const next = firstDeliveryAfterWeekend(base.deliveryDate, calendar);
  return {
    dates: next ? { ...base, nextWeekDispatch: next.dispatch, nextWeekDelivery: next.delivery } : base,
    calendarChecked: zapiet,
  };
}

/** Links stop working at 1:45pm on the new dispatch day. */
function linkExpiry(dates: ReturnType<typeof fridayDates>): string {
  return new Date(londonDayStartUtc(dates.nextWeekDispatch).getTime() + (13 * 60 + 45) * 60_000).toISOString();
}

/** The email for one order, built from Shopify as it is now and the check
 *  re-run for that order — never from what the browser last saw. */
async function emailPlan(req: Request, res: Response, dispatchDate: string) {
  const orderId = Number(req.params["orderId"]);
  if (!Number.isInteger(orderId) || orderId <= 0) { res.status(400).json({ error: "Invalid order" }); return null; }
  const { dates } = await datesFor(dispatchDate);
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
  if (!result.nextWeek.possible) {
    res.status(409).json({ error: `${order.name} can't go on ${friendlyDate(dates.nextWeekDelivery)} either — change it by hand.` });
    return null;
  }
  // Test production / 8-pack bags: made for this date — never moved from here.
  const full = await getOrderById(orderId);
  if (!full) { res.status(502).json({ error: "Couldn't read that order's products from Shopify — nothing was changed." }); return null; }
  const locked = lockedReason(lockedLines(full.line_items, await loadDateLockedProducts()));
  if (locked) { res.status(409).json({ error: `${order.name}: ${locked}`, locked: true }); return null; }
  const sender = await userName(req);
  const who = {
    customerFirstName: greetingNameOf({ first: order.customerFirstName, last: order.customerLastName, full: order.shippingName }, "there"),
    senderFirstName: firstNameOf(sender, "The Calzone Kitchen"),
    orderName: order.name,
    saturdayDelivery: dates.deliveryDate,
    newDelivery: dates.nextWeekDelivery,
  };
  return {
    order, result, sender, dates, who,
    // The preview shows where the link goes; the real one is made on send.
    email: rescheduledWithLinkEmail({ ...who, link: "[a link for them to choose another day — made when you press the button]" }),
    done: doneStateByOrder(actions).get(orderId) ?? null,
  };
}

const emailQuery = z.object({ dispatchDate: fridayDate });

// GET — the exact email, for the confirm step. Sends nothing.
// "Safe to move" (Graeme, 12 Nov 2026: "the mayo is not an issue. We always
// have stock of that … add the garlic mayo to the safe list"). Marks a
// product so it never locks an order's date — here and in the website
// assistant, which reads the same list. Same permission as rescheduling.
const safeSchema = z.object({ recipeId: z.number().int().positive(), safe: z.boolean() });
router.post("/friday-check/date-change-safe", requireCourier, validate(safeSchema), async (req: Request, res: Response) => {
  const { recipeId, safe } = req.body as z.infer<typeof safeSchema>;
  try {
    const r = await db.execute<{ id: number; name: string }>(
      sql`UPDATE recipes SET date_change_safe = ${safe} WHERE id = ${recipeId} RETURNING id, name`,
    );
    if (r.rows.length === 0) { res.status(404).json({ error: "Product not found" }); return; }
    clearDateLockedProductsCache();
    console.log(`[friday-check] ${await userName(req)} marked ${r.rows[0].name} (recipe ${recipeId}) ${safe ? "safe to move" : "not safe to move"}`);
    res.json({ recipeId, name: r.rows[0].name, safe });
  } catch (err) {
    console.error("[friday-check] safe-to-move failed:", errMsg(err));
    res.status(500).json({ error: "Couldn't save that" });
  }
});

router.get("/friday-check/orders/:orderId/email", requireCourier, validateQuery(emailQuery), async (req: Request, res: Response) => {
  const { dispatchDate } = res.locals["query"] as z.infer<typeof emailQuery>;
  try {
    const plan = await emailPlan(req, res, dispatchDate);
    if (!plan) return;
    // A real link in the preview (Graeme, 11 Nov 2026), so it can be tried
    // before sending. Making one changes nothing; the send makes its own.
    const link = await rescheduleLinkFor({ orderId: plan.order.id, orderName: plan.order.name, expiresAt: linkExpiry(plan.dates) });
    const email = rescheduledWithLinkEmail({ ...plan.who, link: link.url });
    res.json({
      orderName: plan.order.name,
      customerName: plan.order.shippingName,
      to: plan.order.email,
      subject: email.subject,
      body: email.body,
      link: link.url,
      linkError: link.error,
      offerThursday: plan.result.canOfferThursday,
      newDelivery: plan.dates.nextWeekDelivery,
      newDeliveryLabel: friendlyDate(plan.dates.nextWeekDelivery),
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
    if (!plan.order.email) { res.status(409).json({ error: "No email address on this order — change it by hand." }); return; }
    const fromDate = plan.dates.deliveryDate;
    const toDate = plan.dates.nextWeekDelivery;

    // 1. Move it — the same pieces the packing screen's reschedule uses.
    const tagChange = rescheduleTags(plan.order.tags, fromDate, toDate);
    const attrChange = withDeliveryDate(plan.order.noteAttributes, toDate);
    try {
      await updateOrderTagsAndAttributes(plan.order.id, tagChange.after, attrChange.attributes);
    } catch (err) {
      console.error(`[friday-check] reschedule failed for ${plan.order.name}:`, errMsg(err));
      res.status(502).json({ error: `Couldn't move ${plan.order.name} in Shopify — nothing was changed or sent: ${errMsg(err)}` });
      return;
    }
    console.log(`[friday-check] ${plan.order.name} rescheduled ${fromDate} → ${toDate} by ${plan.sender}`);
    try {
      await supersedeOrderConsignments(plan.order.id, `rescheduled ${fromDate} → ${toDate} by ${plan.sender} (Friday check)`);
    } catch (err) {
      console.error(`[friday-check] could not retire ${plan.order.name}'s old consignment:`, errMsg(err));
    }
    try {
      await recordFridayAction({
        dispatchDate, orderId: plan.order.id, orderName: plan.order.name, kind: "moved",
        detail: toDate, byUserId: req.session.userId ?? null, byName: plan.sender,
      });
    } catch (logErr) {
      console.warn(`[friday-check] move of ${plan.order.name} not recorded:`, errMsg(logErr));
    }

    // 2. The link, good until 1:45pm on the new dispatch day.
    const link = await rescheduleLinkFor({ orderId: plan.order.id, orderName: plan.order.name, expiresAt: linkExpiry(plan.dates) });
    if (!link.url) console.warn(`[friday-check] no link for ${plan.order.name}: ${link.error}`);

    // 3. Tell them. The order has moved either way; a failed email is reported, not undone.
    const email = rescheduledWithLinkEmail({ ...plan.who, link: link.url });
    let emailError: string | null = null;
    try {
      await sendEmail({ to: plan.order.email, bcc: [CUSTOMER_EMAIL_BCC], subject: email.subject, text: email.body, html: email.html });
      try {
        await recordFridayAction({
          dispatchDate, orderId: plan.order.id, orderName: plan.order.name, kind: "emailed",
          detail: plan.order.email, byUserId: req.session.userId ?? null, byName: plan.sender,
        });
      } catch (logErr) {
        console.warn(`[friday-check] email to ${plan.order.name} sent but not recorded:`, errMsg(logErr));
      }
    } catch (err) {
      emailError = errMsg(err);
      console.error(`[friday-check] email failed for ${plan.order.name}:`, emailError);
    }
    res.json({
      ok: true,
      to: plan.order.email,
      movedTo: toDate,
      emailed: emailError == null,
      emailError,
      linkIncluded: !!link.url,
      linkError: link.error,
    });
  } catch (err) {
    console.error("[friday-check] email send failed:", errMsg(err));
    res.status(500).json({ error: `Couldn't send the email: ${errMsg(err)}` });
  }
});

export default router;
