/**
 * Booking issues today — the stored report of today's failed APC bookings
 * (Graeme, 2026-10-09). Mounted under /api/fulfilment.
 *
 *   GET  /booking-issues/today                 the report (no APC call)
 *   GET  /booking-issues/today/count           for the packing-screen button
 *   GET  /booking-issues/:id/cant-deliver-email   the exact email, to preview
 *   POST /booking-issues/:id/cant-deliver-email   send it (confirmed in the UI)
 *   POST /booking-issues/:id/escalate          team message to the managers
 *   POST /booking-issues/:id/refund            tick: refund done in Shopify
 *   POST /booking-issues/:id/dealt-with        mark the card done / reopen
 *
 * Reading is open to anyone who can use the packing screen. Customer emails,
 * the refund tick and "dealt with" follow the courier-actions permission
 * (Book APC labels — manager, or a grant), as rescheduling already does.
 * Escalating only sends a team message, so anyone on packing can.
 *
 * Nothing here books with APC, writes to Shopify, or refunds anything.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFeature, userCan } from "../lib/feature-access";
import { requireFulfilmentAccess, resolveRole } from "../lib/fulfilment-access";
import { londonDateString } from "../lib/london-time";
import { sendEmail } from "../lib/email";
import { firstNameOf } from "../lib/order-reschedule";
import { cantDeliverEmail, CUSTOMER_EMAIL_BCC } from "../lib/apc-issue-emails";
import { escalationMessage, type IssueAction } from "../lib/apc-booking-issues";
import { loadTodayReport, todayOpenCount, issueById, toApiIssue, appendIssueAction, setDealtWith, type IssueRow } from "../lib/apc-booking-issues-db";
import { loadPostcodeContext } from "../lib/apc-postcode-context";
import { loadViewer, sendMessage, notifyByPush } from "../lib/team-messages";
import { normaliseAudience, audienceProblem } from "@workspace/messages";

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

/** Managers a card is escalated to: active managers and admins, not the
 *  bookkeeper-only accounts. */
async function escalationRecipients(): Promise<Array<{ id: number; name: string }>> {
  const r = await db.execute<{ id: number; name: string }>(sql`
    SELECT id, name FROM app_users
    WHERE is_active AND role IN ('manager', 'admin') AND NOT COALESCE(is_bookkeeper, FALSE)
    ORDER BY name
  `);
  return r.rows.map(x => ({ id: Number(x.id), name: x.name }));
}

/** Load a card for an action: it must exist and be today's. */
async function todaysCard(req: Request, res: Response): Promise<IssueRow | null> {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid issue" }); return null; }
  const row = await issueById(id);
  if (!row) { res.status(404).json({ error: "That booking issue isn't there any more" }); return null; }
  if (row.report_date !== londonDateString()) {
    res.status(409).json({ error: "That issue is from an earlier day's report — it can't be changed now." });
    return null;
  }
  return row;
}

function actionBy(req: Request, name: string, kind: IssueAction["kind"], detail?: string | null): IssueAction {
  return { kind, at: new Date().toISOString(), byUserId: req.session.userId ?? null, byName: name, detail: detail ?? null };
}

// GET /booking-issues/today — today's stored report. Never calls APC.
router.get("/booking-issues/today", requireFulfilmentAccess, async (req: Request, res: Response) => {
  try {
    const [report, managers] = await Promise.all([
      loadTodayReport(await viewerCanCourier(req)),
      escalationRecipients(),
    ]);
    res.json({ ...report, escalateTo: managers.filter(m => m.id !== req.session.userId).map(m => m.name) });
  } catch (err) {
    console.error("[booking-issues] today failed:", err);
    res.status(500).json({ error: "Couldn't load today's booking issues" });
  }
});

router.get("/booking-issues/today/count", requireFulfilmentAccess, async (_req: Request, res: Response) => {
  try {
    res.json(await todayOpenCount());
  } catch (err) {
    console.error("[booking-issues] count failed:", err);
    res.status(500).json({ error: "Couldn't count today's booking issues" });
  }
});

async function cantDeliverPlan(req: Request, row: IssueRow) {
  const sender = await userName(req);
  const email = cantDeliverEmail({
    customerFirstName: firstNameOf(row.customer_first_name ?? row.customer_name, "there"),
    senderFirstName: firstNameOf(sender, "The Calzone Kitchen"),
    orderName: row.order_name,
  });
  return { sender, to: row.customer_email, ...email };
}

async function liveScenario(row: IssueRow, canCourier: boolean) {
  return toApiIssue(row, await loadPostcodeContext(), canCourier, new Date());
}

// GET — the exact "can't deliver" email, for the confirm step.
router.get("/booking-issues/:id/cant-deliver-email", requireCourier, async (req: Request, res: Response) => {
  const row = await todaysCard(req, res);
  if (!row) return;
  const issue = await liveScenario(row, true);
  if (issue.scenario !== "cant_deliver") {
    res.status(409).json({ error: "This order isn't a \"can't deliver\" case — that email isn't offered for it." });
    return;
  }
  const plan = await cantDeliverPlan(req, row);
  res.json({ orderName: row.order_name, customerName: row.customer_name, to: plan.to, subject: plan.subject, body: plan.body });
});

const sendSchema = z.object({
  /** The order number the person confirmed on screen — must match the card,
   *  so a stale or mis-tapped confirm can't email the wrong customer. */
  confirmOrderName: z.string().trim().min(1).max(40),
});

// POST — send it. Only ever from a confirmed button press.
router.post("/booking-issues/:id/cant-deliver-email", requireCourier, validate(sendSchema), async (req: Request, res: Response) => {
  const row = await todaysCard(req, res);
  if (!row) return;
  const { confirmOrderName } = req.body as z.infer<typeof sendSchema>;
  if (confirmOrderName !== row.order_name) {
    res.status(409).json({ error: `This card is ${row.order_name}, not ${confirmOrderName} — nothing was sent.` });
    return;
  }
  const issue = await liveScenario(row, true);
  if (!issue.actions.emailCantDeliver.enabled) {
    res.status(409).json({ error: issue.actions.emailCantDeliver.reason ?? "That email isn't offered for this order." });
    return;
  }
  const plan = await cantDeliverPlan(req, row);
  if (!plan.to) { res.status(409).json({ error: "No email address on this order." }); return; }
  try {
    await sendEmail({ to: plan.to, bcc: [CUSTOMER_EMAIL_BCC], subject: plan.subject, text: plan.body, html: plan.html });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[booking-issues] can't-deliver email failed for ${row.order_name}:`, msg);
    res.status(502).json({ error: `The email didn't send: ${msg}` });
    return;
  }
  await appendIssueAction(Number(row.id), actionBy(req, plan.sender, "email_sent", `${plan.to} (can't deliver)`));
  console.log(`[booking-issues] can't-deliver email sent for ${row.order_name} by ${plan.sender}`);
  res.json({ ok: true, to: plan.to });
});

const escalateSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

// POST — tell the managers, as a team message they must confirm.
router.post("/booking-issues/:id/escalate", requireFulfilmentAccess, validate(escalateSchema), async (req: Request, res: Response) => {
  const row = await todaysCard(req, res);
  if (!row) return;
  const issue = await liveScenario(row, false);
  if (!issue.actions.escalate.enabled) {
    res.status(409).json({ error: issue.actions.escalate.reason ?? "Already escalated." });
    return;
  }
  const v = await loadViewer(req, []);
  if (!v) { res.status(401).json({ error: "Sign in again" }); return; }
  const managers = (await escalationRecipients()).filter(m => m.id !== v.userId);
  if (managers.length === 0) { res.status(409).json({ error: "There's no other manager to send this to." }); return; }
  const audience = normaliseAudience({ everyone: false, stations: [], userIds: managers.map(m => m.id) }, v.userId);
  const problem = audienceProblem(audience, v.userId);
  if (problem) { res.status(409).json({ error: problem }); return; }
  const { note } = req.body as z.infer<typeof escalateSchema>;
  const body = escalationMessage({ ...issue, note });
  const sent = await sendMessage(v, { audience, body, requiresAck: true, parent: null });
  await appendIssueAction(Number(row.id), actionBy(req, v.name ?? "someone", "escalated", managers.map(m => m.name).join(", ")));
  res.json({ ok: true, to: managers.map(m => m.name), conversationKey: sent.key });
  void notifyByPush(v, audience, sent.mentionIds, sent.key, body);
});

const toggleSchema = z.object({ done: z.boolean() });

// POST — the refund was done (or undone) in Shopify. Records only.
router.post("/booking-issues/:id/refund", requireCourier, validate(toggleSchema), async (req: Request, res: Response) => {
  const row = await todaysCard(req, res);
  if (!row) return;
  const issue = await liveScenario(row, true);
  if (!issue.actions.refund.show) { res.status(409).json({ error: "A refund isn't part of this order's issue." }); return; }
  const { done } = req.body as z.infer<typeof toggleSchema>;
  await appendIssueAction(Number(row.id), actionBy(req, await userName(req), done ? "refund_done" : "refund_undone"));
  res.json({ ok: true });
});

// POST — mark the card dealt with by hand, or reopen it.
router.post("/booking-issues/:id/dealt-with", requireCourier, validate(toggleSchema), async (req: Request, res: Response) => {
  const row = await todaysCard(req, res);
  if (!row) return;
  const { done } = req.body as z.infer<typeof toggleSchema>;
  await setDealtWith(Number(row.id), done, actionBy(req, await userName(req), done ? "dealt_with" : "dealt_with_undone"));
  res.json({ ok: true });
});

export default router;
