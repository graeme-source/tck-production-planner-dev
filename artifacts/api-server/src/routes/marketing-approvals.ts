/**
 * Approving Klaviyo emails (Graeme, 2026-10-20), mounted at
 * /api/marketing-calendar/approvals. Objectives I (nothing goes to
 * customers the founder hasn't seen) and F (every approve / undo recorded
 * with who and when).
 *
 * Emails are only built in Klaviyo. As soon as one is drafted it needs
 * approving; the approver marks it Approved on the calendar. ONE approval
 * per Klaviyo campaign, keyed 'klaviyo:<campaign id>'. The approval keeps
 * the subject line, preview text and send time as they were; if any of
 * them changes in Klaviyo it is "Needs approval" again (rules:
 * @workspace/marketing-calendar email-approvals.ts).
 *
 * Who can SEE: anyone with Sales & Marketing (founder.sales).
 * Who can APPROVE: the founder, or someone he granted the founder-only
 * feature "marketing.approve_emails" — checked on every request.
 *
 * Klaviyo stays READ-ONLY: approving reads the campaign as it is right now
 * (one GET) and never writes back. Older 'plan:<id>' rows (planned emails,
 * retired 2026-10-20) are left in the table, unused.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, marketingEmailApprovalsTable, marketingEmailApprovalHistoryTable, usersTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { FOUNDER_FEATURES } from "@workspace/feature-registry";
import { addDays, klaviyoApprovalKey } from "@workspace/marketing-calendar";
import { validate, validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { userCan } from "../lib/feature-access";
import { klaviyoCampaignById, klaviyoEmailsForRange, klaviyoUndatedDrafts } from "../lib/klaviyo-campaign-calendar";
import { withApprovals } from "../lib/marketing-klaviyo-emails";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

export async function canApproveEmails(req: Request): Promise<boolean> {
  return userCan(req.session.userId, "viewer", FOUNDER_FEATURES.approveEmails);
}

// ── What waits for approval (the nav badge + the calendar's list) ──────────
// Drafts and scheduled emails from today to a year ahead, plus drafts with
// no date yet, that aren't approved (or changed since).
router.get("/needed", async (req: Request, res: Response) => {
  const today = londonToday();
  let klaviyoError: string | null = null;
  let items: Awaited<ReturnType<typeof withApprovals>> = [];
  try {
    const [ranged, undated] = await Promise.all([klaviyoEmailsForRange(today, addDays(today, 365)), klaviyoUndatedDrafts()]);
    items = (await withApprovals([...ranged.emails, ...(undated ?? [])], today)).filter(e => e.approval.awaits);
  } catch (err) {
    console.error("[marketing-approvals] Klaviyo read failed:", err instanceof Error ? err.message : String(err));
    klaviyoError = "Couldn't reach Klaviyo just now — the count may be short";
  }
  res.json({
    today,
    canApprove: await canApproveEmails(req),
    count: items.length,
    klaviyoError,
    // Soonest first; drafts with no date at the end.
    items: items.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.sendAt ?? "").localeCompare(b.sendAt ?? "")),
  });
});

// ── One email's approval history (its panel shows it) ──────────────────────
const HistoryQuery = z.object({ campaignId: z.string().trim().min(1).max(100) });

router.get("/history", validateQuery(HistoryQuery), async (_req: Request, res: Response) => {
  const { campaignId } = res.locals["query"] as z.infer<typeof HistoryQuery>;
  const [row] = await db.select().from(marketingEmailApprovalsTable).where(eq(marketingEmailApprovalsTable.targetKey, klaviyoApprovalKey(campaignId)));
  if (!row) { res.json({ history: [] }); return; }
  const hist = await db.select().from(marketingEmailApprovalHistoryTable)
    .where(eq(marketingEmailApprovalHistoryTable.approvalId, row.id))
    .orderBy(desc(marketingEmailApprovalHistoryTable.createdAt), desc(marketingEmailApprovalHistoryTable.id));
  res.json({ history: hist.map(h => ({ id: h.id, action: h.action, summary: h.summary, userName: h.userName, at: h.createdAt.toISOString() })) });
});

// ── Approve / undo ─────────────────────────────────────────────────────────
const TargetBody = z.object({ klaviyoCampaignId: z.string().trim().min(1).max(100) });

router.post("/approve", requireFounderArea(FOUNDER_FEATURES.approveEmails), validate(TargetBody), async (req: Request, res: Response) => {
  const { klaviyoCampaignId: cid } = req.body as z.infer<typeof TargetBody>;
  const user = await sessionUser(req);
  // What gets approved is the email as Klaviyo has it RIGHT NOW (not a cache).
  let k: Awaited<ReturnType<typeof klaviyoCampaignById>>;
  try {
    k = await klaviyoCampaignById(cid);
  } catch (err) {
    console.error("[marketing-approvals] Klaviyo lookup failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Couldn't read this email from Klaviyo just now — try again in a minute." });
    return;
  }
  if (!k) { res.status(409).json({ error: "Klaviyo isn't connected, so the email can't be checked." }); return; }
  if (k === "deleted") { res.status(409).json({ error: "This email has been deleted in Klaviyo." }); return; }

  const key = klaviyoApprovalKey(cid);
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailApprovalsTable)
      .where(eq(marketingEmailApprovalsTable.targetKey, key)).for("update");
    const now = new Date();
    const values = {
      klaviyoCampaignId: cid,
      approved: true,
      subject: k.subject,
      previewText: k.previewText,
      sendAt: k.sendAt ? new Date(k.sendAt) : null,
      snapshotFull: true,
      klaviyoCampaignName: k.name,
      sendDate: k.date,
      approvedById: user.id, approvedByName: user.name, approvedAt: now,
      updatedAt: now,
    };
    const [after] = before
      ? await tx.update(marketingEmailApprovalsTable).set(values).where(eq(marketingEmailApprovalsTable.id, before.id)).returning()
      : await tx.insert(marketingEmailApprovalsTable).values({ targetKey: key, ...values }).returning();
    const again = before?.approved === true;
    const summary = `${again ? "approved it again" : "approved it"} — subject line “${k.subject ?? "(none)"}”`;
    await tx.insert(marketingEmailApprovalHistoryTable).values({ approvalId: after.id, action: "approved", summary, subject: k.subject, userId: user.id, userName: user.name });
    return after;
  });
  res.json({ ok: true, approvedBy: row.approvedByName, approvedAt: row.approvedAt?.toISOString() ?? null });
});

router.post("/unapprove", requireFounderArea(FOUNDER_FEATURES.approveEmails), validate(TargetBody), async (req: Request, res: Response) => {
  const { klaviyoCampaignId: cid } = req.body as z.infer<typeof TargetBody>;
  const user = await sessionUser(req);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailApprovalsTable)
      .where(eq(marketingEmailApprovalsTable.targetKey, klaviyoApprovalKey(cid))).for("update");
    if (!before || !before.approved) return;
    const now = new Date();
    await tx.update(marketingEmailApprovalsTable).set({
      approved: false, unapprovedById: user.id, unapprovedByName: user.name, unapprovedAt: now, updatedAt: now,
    }).where(eq(marketingEmailApprovalsTable.id, before.id));
    await tx.insert(marketingEmailApprovalHistoryTable).values({
      approvalId: before.id, action: "unapproved", summary: "undid the approval", subject: before.subject, userId: user.id, userName: user.name,
    });
  });
  res.json({ ok: true });
});

export default router;
