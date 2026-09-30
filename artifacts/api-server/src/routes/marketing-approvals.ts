/**
 * Approvals for marketing emails (Graeme, 2026-09-30), mounted at
 * /api/marketing-calendar/approvals. Objectives I (nothing goes to
 * customers the founder hasn't seen) and F (every approve / undo recorded
 * with who and when).
 *
 * What can be approved: planned emails, and Klaviyo campaigns (drafts and
 * scheduled) — including campaigns no plan is linked to. ONE approval per
 * thing, keyed by approvalKey() in @workspace/marketing-calendar:
 *   'plan:<id>'          a plan not linked to Klaviyo
 *   'klaviyo:<id>'       a Klaviyo campaign, or the plan linked to it (shared)
 * The approval stores the subject line (and Klaviyo campaign id + name) as
 * they were; if the subject line changes afterwards the screen says
 * "Changed since approval" and it needs approving again.
 *
 * Who can SEE: anyone with Sales & Marketing (founder.sales).
 * Who can APPROVE: the founder, or someone he granted the founder-only
 * feature "marketing.approve_emails" — checked here on every request, so
 * anyone else gets 403 however they call it.
 *
 * Klaviyo stays READ-ONLY: approving a Klaviyo campaign reads its current
 * subject line (one GET) and never writes back.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db, marketingEmailApprovalsTable, marketingEmailApprovalHistoryTable, marketingEmailHistoryTable, marketingEmailsTable, usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { FOUNDER_FEATURES } from "@workspace/feature-registry";
import { addDays, approvalKey, buildApprovalItems, klaviyoKey } from "@workspace/marketing-calendar";
import { validate, validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { userCan } from "../lib/feature-access";
import { klaviyoCampaignById, klaviyoEmailsForRange } from "../lib/klaviyo-campaign-calendar";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

type ApprovalRow = typeof marketingEmailApprovalsTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

async function canApprove(req: Request): Promise<boolean> {
  return userCan(req.session.userId, "viewer", FOUNDER_FEATURES.approveEmails);
}

export function approvalJson(a: ApprovalRow) {
  return {
    key: a.targetKey,
    emailId: a.emailId,
    klaviyoCampaignId: a.klaviyoCampaignId,
    approved: a.approved,
    subject: a.subject,
    klaviyoCampaignName: a.klaviyoCampaignName,
    sendDate: a.sendDate,
    approvedBy: a.approvedByName ? { id: a.approvedById, name: a.approvedByName } : null,
    approvedAt: a.approvedAt?.toISOString() ?? null,
    unapprovedBy: a.unapprovedByName ? { id: a.unapprovedById, name: a.unapprovedByName } : null,
    unapprovedAt: a.unapprovedAt?.toISOString() ?? null,
  };
}

// ── Every approval (small table: one row per approved-at-some-point thing) ─
router.get("/", async (req: Request, res: Response) => {
  const rows = await db.select().from(marketingEmailApprovalsTable).orderBy(asc(marketingEmailApprovalsTable.id));
  res.json({ canApprove: await canApprove(req), approvals: rows.map(approvalJson) });
});

// ── What needs approving (the reminder banner) ──────────────────────────
// Rule: needsApproval() in @workspace/marketing-calendar — sends today or
// later, is a Klaviyo draft or scheduled, and isn't approved (or changed
// since). Looks a year ahead.
router.get("/needed", async (req: Request, res: Response) => {
  const today = londonToday();
  const to = addDays(today, 365);
  const [planned, approvals] = await Promise.all([
    db.select().from(marketingEmailsTable)
      .where(and(isNull(marketingEmailsTable.deletedAt), gte(marketingEmailsTable.sendDate, today), lte(marketingEmailsTable.sendDate, to))),
    db.select().from(marketingEmailApprovalsTable),
  ]);
  let klaviyo: Awaited<ReturnType<typeof klaviyoEmailsForRange>>["emails"] = [];
  let klaviyoError: string | null = null;
  try {
    klaviyo = (await klaviyoEmailsForRange(today, to)).emails;
  } catch (err) {
    console.error("[marketing-approvals] Klaviyo read failed:", err instanceof Error ? err.message : String(err));
    klaviyoError = "Couldn't reach Klaviyo just now — the count may be short";
  }
  const items = buildApprovalItems({
    planned: planned.map(p => ({ id: p.id, sendDate: p.sendDate, subject: p.subject, status: p.status, klaviyoCampaignId: p.klaviyoCampaignId })),
    klaviyo,
    approvals: approvals.map(a => ({ key: a.targetKey, approved: a.approved, subject: a.subject })),
    today,
  }).filter(i => i.needsApproval);
  res.json({
    today,
    canApprove: await canApprove(req),
    count: items.length,
    klaviyoError,
    items: items.map(i => ({
      key: i.key, kind: i.kind, date: i.date, subject: i.subject, stage: i.stage, state: i.state,
      emailId: i.plan?.id ?? null, klaviyoCampaignId: i.klaviyo?.id ?? i.plan?.klaviyoCampaignId ?? null,
      klaviyoName: i.klaviyo?.name ?? null,
    })),
  });
});

// ── One approval's history (the Klaviyo email card shows it) ───────────────
const HistoryQuery = z.object({ key: z.string().regex(/^(plan:\d+|klaviyo:.+)$/).max(120) });

router.get("/history", validateQuery(HistoryQuery), async (_req: Request, res: Response) => {
  const { key } = res.locals["query"] as z.infer<typeof HistoryQuery>;
  const [row] = await db.select().from(marketingEmailApprovalsTable).where(eq(marketingEmailApprovalsTable.targetKey, key));
  if (!row) { res.json({ approval: null, history: [] }); return; }
  const hist = await db.select().from(marketingEmailApprovalHistoryTable)
    .where(eq(marketingEmailApprovalHistoryTable.approvalId, row.id))
    .orderBy(desc(marketingEmailApprovalHistoryTable.createdAt), desc(marketingEmailApprovalHistoryTable.id));
  res.json({
    approval: approvalJson(row),
    history: hist.map(h => ({ id: h.id, action: h.action, summary: h.summary, userId: h.userId, userName: h.userName, at: h.createdAt.toISOString() })),
  });
});

// ── Approve / undo ─────────────────────────────────────────────────────────
const TargetBody = z.object({
  emailId: z.number().int().positive().optional(),
  klaviyoCampaignId: z.string().trim().min(1).max(100).optional(),
}).refine(b => (b.emailId != null) !== (b.klaviyoCampaignId != null), { message: "Say which email: a planned email or a Klaviyo campaign" });

type Target = {
  key: string;
  plan: typeof marketingEmailsTable.$inferSelect | null;
  klaviyoCampaignId: string | null;
};

/** Which approval governs what was tapped, and the plan behind it (if any). */
async function resolveTarget(b: z.infer<typeof TargetBody>, tx: Tx | typeof db = db): Promise<Target | { error: string; status: number }> {
  if (b.emailId != null) {
    const [plan] = await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, b.emailId));
    if (!plan || plan.deletedAt) return { status: 404, error: "Email not found (it may have been deleted)" };
    return { key: approvalKey({ kind: "plan", emailId: plan.id, klaviyoCampaignId: plan.klaviyoCampaignId }), plan, klaviyoCampaignId: plan.klaviyoCampaignId };
  }
  const cid = b.klaviyoCampaignId!;
  const [plan] = await tx.select().from(marketingEmailsTable)
    .where(and(eq(marketingEmailsTable.klaviyoCampaignId, cid), isNull(marketingEmailsTable.deletedAt)));
  return { key: klaviyoKey(cid), plan: plan ?? null, klaviyoCampaignId: cid };
}

async function planHistory(tx: Tx, emailId: number, user: { id: number; name: string }, action: "approved" | "unapproved", summary: string) {
  await tx.insert(marketingEmailHistoryTable).values({ emailId, userId: user.id, userName: user.name, action, summary });
}

router.post("/approve", requireFounderArea(FOUNDER_FEATURES.approveEmails), validate(TargetBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof TargetBody>;
  const user = await sessionUser(req);
  const t = await resolveTarget(b);
  if ("error" in t) { res.status(t.status).json({ error: t.error }); return; }

  // The subject line as it is RIGHT NOW is what gets approved.
  let subject: string | null;
  let kName: string | null = null;
  let sendDate: string | null = t.plan?.sendDate ?? null;
  if (t.klaviyoCampaignId) {
    try {
      const k = await klaviyoCampaignById(t.klaviyoCampaignId);
      if (!k) { res.status(409).json({ error: "Klaviyo isn't connected, so its subject line can't be checked." }); return; }
      subject = k.subject;
      kName = k.name;
      // A draft's day in Klaviyo is a placeholder — the plan's day wins then.
      if (k.date && (k.status !== "Draft" || !sendDate)) sendDate = k.date;
    } catch (err) {
      console.error("[marketing-approvals] Klaviyo lookup failed:", err instanceof Error ? err.message : String(err));
      res.status(502).json({ error: "Couldn't read the subject line from Klaviyo just now — try again in a minute." });
      return;
    }
  } else {
    subject = t.plan!.subject;
  }

  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailApprovalsTable)
      .where(eq(marketingEmailApprovalsTable.targetKey, t.key)).for("update");
    if (before?.approved && (before.subject ?? "") === (subject ?? "")) return before; // already approved as it is
    const again = before?.approved === true;
    const now = new Date();
    const values = {
      emailId: t.plan?.id ?? before?.emailId ?? null,
      klaviyoCampaignId: t.klaviyoCampaignId,
      approved: true,
      subject,
      klaviyoCampaignName: kName ?? before?.klaviyoCampaignName ?? null,
      sendDate,
      approvedById: user.id, approvedByName: user.name, approvedAt: now,
      updatedAt: now,
    };
    const [after] = before
      ? await tx.update(marketingEmailApprovalsTable).set(values).where(eq(marketingEmailApprovalsTable.id, before.id)).returning()
      : await tx.insert(marketingEmailApprovalsTable).values({ targetKey: t.key, ...values }).returning();
    const summary = `${again ? "approved it again (the subject line had changed)" : "approved it"} — subject line “${subject ?? "(none)"}”`;
    await tx.insert(marketingEmailApprovalHistoryTable).values({ approvalId: after.id, action: "approved", summary, subject, userId: user.id, userName: user.name });
    if (t.plan) await planHistory(tx, t.plan.id, user, "approved", summary);
    return after;
  });
  res.json({ approval: approvalJson(row) });
});

router.post("/unapprove", requireFounderArea(FOUNDER_FEATURES.approveEmails), validate(TargetBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof TargetBody>;
  const user = await sessionUser(req);
  const t = await resolveTarget(b);
  if ("error" in t) { res.status(t.status).json({ error: t.error }); return; }
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(marketingEmailApprovalsTable)
      .where(eq(marketingEmailApprovalsTable.targetKey, t.key)).for("update");
    if (!before || !before.approved) return before ?? null;
    const now = new Date();
    const [after] = await tx.update(marketingEmailApprovalsTable).set({
      approved: false, unapprovedById: user.id, unapprovedByName: user.name, unapprovedAt: now, updatedAt: now,
    }).where(eq(marketingEmailApprovalsTable.id, before.id)).returning();
    const summary = "undid the approval";
    await tx.insert(marketingEmailApprovalHistoryTable).values({ approvalId: after.id, action: "unapproved", summary, subject: before.subject, userId: user.id, userName: user.name });
    if (t.plan) await planHistory(tx, t.plan.id, user, "unapproved", summary);
    return after;
  });
  res.json({ approval: row ? approvalJson(row) : null });
});

/**
 * Linking a plan to a Klaviyo campaign: the approval moves with it. If the
 * plan was approved and the campaign isn't, the campaign's approval takes
 * the plan's (same subject snapshot — so if Klaviyo's subject line differs
 * it shows "Changed since approval"). Called inside the link transaction in
 * routes/marketing-emails.ts. Unlinking leaves the campaign's approval with
 * the campaign; the plan is then judged on its own row again.
 */
export async function carryApprovalOnLink(tx: Tx, emailId: number, klaviyoCampaignId: string, user: { id: number; name: string }): Promise<boolean> {
  const [planRow] = await tx.select().from(marketingEmailApprovalsTable)
    .where(eq(marketingEmailApprovalsTable.targetKey, `plan:${emailId}`)).for("update");
  if (!planRow?.approved) return false;
  const kKey = klaviyoKey(klaviyoCampaignId);
  const [kRow] = await tx.select().from(marketingEmailApprovalsTable)
    .where(eq(marketingEmailApprovalsTable.targetKey, kKey)).for("update");
  if (kRow?.approved) return false;
  const now = new Date();
  const carried = {
    emailId, klaviyoCampaignId, approved: true, subject: planRow.subject, sendDate: planRow.sendDate,
    approvedById: planRow.approvedById, approvedByName: planRow.approvedByName, approvedAt: planRow.approvedAt, updatedAt: now,
  };
  const [target] = kRow
    ? await tx.update(marketingEmailApprovalsTable).set(carried).where(eq(marketingEmailApprovalsTable.id, kRow.id)).returning()
    : await tx.insert(marketingEmailApprovalsTable).values({ targetKey: kKey, ...carried }).returning();
  await tx.update(marketingEmailApprovalsTable).set({ approved: false, updatedAt: now }).where(eq(marketingEmailApprovalsTable.id, planRow.id));
  const summary = "linked to Klaviyo — the approval moved to the Klaviyo email";
  await tx.insert(marketingEmailApprovalHistoryTable).values([
    { approvalId: target.id, action: "moved", summary, subject: planRow.subject, userId: user.id, userName: user.name },
    { approvalId: planRow.id, action: "moved", summary, subject: planRow.subject, userId: user.id, userName: user.name },
  ]);
  return true;
}

export default router;
