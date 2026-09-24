/**
 * Issue pipeline — the PEOPLE side (docs/ISSUE_PIPELINE.md "Built").
 * Session-authed; mounted behind the app-wide session guard.
 *
 *  - /review/*            Graeme's Fix queue: read recommendations, approve,
 *                         reject, or reply with a question. Founder-only —
 *                         the account, not the role (middleware/founder-access).
 *  - /my-fixed-notices/*  The reporter's "Your report has been fixed — please
 *                         test it" pop-up. Scoped to the session user.
 *
 * The scheduled Claude Code session talks to routes/issue-pipeline-machine.ts
 * instead, with a bearer token; nothing here accepts that token.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, usersTable, issueTriageTable, issueFixNoticesTable, andonIssuesTable, type IssueTriage } from "@workspace/db";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFounder } from "../middleware/founder-access";
import {
  NOTICE_ACK_ACTIONS,
  TRIAGE_STATUSES,
  canDismiss,
  canMessageReporter,
  canSnooze,
  queueTabFor,
  QUEUE_TABS,
  SNOOZE_DAYS,
  canReply,
  canReviewMove,
  noticeAckVerdict,
  type TriageStatus,
} from "../lib/issue-pipeline-rules";
import {
  buildIssueViews,
  loadAndonRows,
  creditImprovementIfDue,
  messageReporter,
  noticesByTriageId,
  pendingNoticesFor,
  recordEvent,
  triageByIssueId,
} from "../lib/issue-pipeline-data";

const router: IRouter = Router();

const reviewAttachmentUrl = (id: number) => `/api/andon/attachments/${id}/file`;

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function sessionUserName(userId: number): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? "Someone";
}

// ── GET /review — the Fix queue ─────────────────────────────────────────────
// Tabs: proposed | approved | in_progress | fixed | rejected (rejected also
// shows wont_fix — both are "not being built").
const reviewQuery = z.object({ tab: z.enum(QUEUE_TABS).optional() });

router.get("/review", requireFounder, async (req, res) => {
  const parsed = reviewQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }
  const tab = parsed.data.tab ?? "proposed";
  try {
    const countRows = await db.execute<{ status: string; n: number; awaiting: number }>(sql`
      SELECT status, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE awaiting_retriage)::int AS awaiting
      FROM issue_triage GROUP BY status
    `);
    const counts: Record<string, number> = Object.fromEntries(TRIAGE_STATUSES.map(s => [s, 0]));
    let awaitingReply = 0;
    for (const r of countRows.rows) { counts[r.status] = r.n; awaitingReply += r.awaiting; }

    // Every card is bucketed by one rule (queueTabFor): To review is only
    // what needs Graeme NOW — waiting-on-Claude goes to In progress, snoozed
    // to Snoozed — and both come back by themselves.
    const now = new Date();
    const all = await db.select().from(issueTriageTable).orderBy(desc(issueTriageTable.triagedAt)).limit(1000);
    const tabCounts: Record<string, number> = Object.fromEntries(QUEUE_TABS.map(t => [t, 0]));
    for (const r of all) tabCounts[queueTabFor({ ...r, status: r.status as TriageStatus }, now)]++;
    const rows = all.filter(r => queueTabFor({ ...r, status: r.status as TriageStatus }, now) === tab).slice(0, 200);

    const relatedIds = [...new Set(rows.flatMap(r => r.relatedIssueIds))];
    const [issues, relatedRows, relatedTriage, notices] = await Promise.all([
      loadAndonRows(rows.map(r => r.andonIssueId)).then(r => buildIssueViews(r, reviewAttachmentUrl)),
      loadAndonRows(relatedIds),
      triageByIssueId(relatedIds),
      noticesByTriageId(rows.map(r => r.id)),
    ]);
    const issueById = new Map(issues.map(i => [i.id, i]));
    const relatedById = new Map(relatedRows.map(r => [r.id, r]));

    res.json({
      tab,
      counts: { ...counts, awaitingReply },
      tabCounts,
      items: rows.map(t => ({
        triage: t,
        issue: issueById.get(t.andonIssueId) ?? null,
        notices: notices.get(t.id) ?? [],
        related: t.relatedIssueIds.map(id => {
          const r = relatedById.get(id);
          return r
            ? { id, description: r.description, station: r.station, reporterName: r.reportedByName, createdAt: r.createdAt, resolvedAt: r.resolvedAt, triageStatus: relatedTriage.get(id)?.status ?? null }
            : { id, description: null, station: null, reporterName: null, createdAt: null, resolvedAt: null, triageStatus: null };
        }),
      })),
    });
  } catch (err) {
    console.error("[issue-pipeline] review list failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load the fix queue" });
  }
});

// ── POST /review/:id/approve | reject | reply ───────────────────────────────
const decisionBody = z.object({ note: z.string().trim().max(2000).nullable().optional() });
const replyBody = z.object({ note: z.string().trim().min(1).max(2000) });

async function decide(req: Request, res: Response, action: "approve" | "reject" | "reply") {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId!;
  const note = (req.body as { note?: string | null }).note?.trim() || null;
  try {
    const name = await sessionUserName(userId);
    const out = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(issueTriageTable).where(eq(issueTriageTable.id, id)).for("update");
      if (!current) return { status: 404 as const, error: "Recommendation not found" };
      const from = current.status as TriageStatus;

      let row: IssueTriage;
      if (action === "reply") {
        if (!canReply(from)) return { status: 409 as const, error: `Can't reply to a '${from}' recommendation`, triage: current };
        // Stays 'proposed'; the flag puts it back in the session's inbox.
        [row] = await tx.update(issueTriageTable).set({
          awaitingRetriage: true, decisionNote: note, decidedBy: name, decidedByUserId: userId, decidedAt: new Date(), updatedAt: new Date(),
        }).where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
        await recordEvent(tx, row, "replied", name, note);
      } else {
        const to: TriageStatus = action === "approve" ? "approved" : "rejected";
        if (!canReviewMove(from, to)) return { status: 409 as const, error: `Can't ${action} a '${from}' recommendation`, triage: current };
        [row] = await tx.update(issueTriageTable).set({
          status: to, awaitingRetriage: false, decisionNote: note, decidedBy: name, decidedByUserId: userId, decidedAt: new Date(), updatedAt: new Date(),
        }).where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
        await recordEvent(tx, row, to, name, note);
      }
      return { status: 200 as const, triage: row };
    });
    if (out.status !== 200) { const { status, ...body } = out; res.status(status).json(body); return; }
    res.json({ triage: out.triage });
  } catch (err) {
    console.error(`[issue-pipeline] ${action} failed:`, err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: `Failed to ${action}` });
  }
}

router.post("/review/:id/approve", requireFounder, validate(decisionBody), (req, res) => decide(req, res, "approve"));
router.post("/review/:id/reject", requireFounder, validate(decisionBody), (req, res) => decide(req, res, "reject"));
router.post("/review/:id/reply", requireFounder, validate(replyBody), (req, res) => decide(req, res, "reply"));

// ── POST /review/:id/snooze {days} | /unsnooze ──────────────────────────────
// "Not now": the card leaves To review for a while and comes back by itself.
const snoozeBody = z.object({
  days: z.number().int().refine(d => (SNOOZE_DAYS as readonly number[]).includes(d), { message: `days must be one of ${SNOOZE_DAYS.join(", ")}` }),
});
router.post("/review/:id/snooze", requireFounder, validate(snoozeBody), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const days = (req.body as { days: number }).days;
  const [current] = await db.select().from(issueTriageTable).where(eq(issueTriageTable.id, id));
  if (!current) { res.status(404).json({ error: "Recommendation not found" }); return; }
  if (!canSnooze({ status: current.status as TriageStatus, awaitingRetriage: current.awaitingRetriage })) {
    res.status(409).json({ error: "Only a card waiting on you can be snoozed" }); return;
  }
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const [row] = await db.update(issueTriageTable).set({ snoozedUntil: until, updatedAt: new Date() })
    .where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
  await recordEvent(db, row, "snoozed", await sessionUserName(req.session.userId!), `Snoozed for ${days} day${days === 1 ? "" : "s"}`);
  res.json({ triage: row });
});

router.post("/review/:id/unsnooze", requireFounder, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(issueTriageTable).set({ snoozedUntil: null, updatedAt: new Date() })
    .where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
  if (!row) { res.status(404).json({ error: "Recommendation not found" }); return; }
  res.json({ triage: row });
});

// ── POST /review/:id/dismiss — "Dismiss — already done" ─────────────────────
// For reports Claude has verified need no action (already fixed or built,
// withdrawn, not a problem). One tap closes the report on the andon log; if
// Claude drafted a reply, the reporter gets it as "A reply to your report",
// so they learn it's done and where to find it.
router.post("/review/:id/dismiss", requireFounder, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId!;
  try {
    const name = await sessionUserName(userId);
    const out = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(issueTriageTable).where(eq(issueTriageTable.id, id)).for("update");
      if (!current) return { status: 404 as const, error: "Recommendation not found" };
      if (!canDismiss(current.status as TriageStatus)) {
        return { status: 409 as const, error: `This report is already ${current.status === "in_progress" ? "being fixed" : "closed"}.` };
      }
      const [issue] = await tx.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, current.andonIssueId));
      if (!issue) return { status: 404 as const, error: "The report no longer exists" };

      const reply = current.suggestedReply?.trim();
      let notified = false;
      if (reply) {
        const sent = await messageReporter(tx, issue, { triageId: current.id, senderUserId: userId, senderName: name, message: reply, close: true });
        notified = sent.noticeQueued;
      } else if (!issue.resolvedAt) {
        await tx.update(andonIssuesTable)
          .set({ resolvedBy: userId, resolvedByName: name, resolvedAt: new Date() })
          .where(eq(andonIssuesTable.id, issue.id));
      }
      const [row] = await tx.update(issueTriageTable).set({
        status: "dismissed", awaitingRetriage: false, decidedBy: name, decidedByUserId: userId,
        decidedAt: new Date(), issueResolvedAt: new Date(), updatedAt: new Date(),
      }).where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
      await recordEvent(tx, row, "dismissed", name, reply ? "Dismissed — reply sent to the reporter" : "Dismissed — already done");
      await creditImprovementIfDue(tx, row, name);
      return { status: 200 as const, triage: row, notified };
    });
    if (out.status !== 200) { const { status, ...body } = out; res.status(status).json(body); return; }
    const { status: _s, ...body } = out;
    res.json(body);
  } catch (err) {
    console.error("[issue-pipeline] dismiss failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to dismiss" });
  }
});

// ── POST /review/:id/message — "Message the reporter" ───────────────────────
// Graeme's words go to the person who reported it (issue comment, bell, and
// a full-screen "A reply to your report"). close=true means "this answers
// it": the report is resolved and the recommendation marked 'answered' —
// e.g. no fix needed, they can set it themselves on the recipe form.
const messageBody = z.object({
  message: z.string().trim().min(1).max(4000),
  close: z.boolean(),
});

router.post("/review/:id/message", requireFounder, validate(messageBody), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId!;
  const { message, close } = req.body as z.infer<typeof messageBody>;
  try {
    const name = await sessionUserName(userId);
    const out = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(issueTriageTable).where(eq(issueTriageTable.id, id)).for("update");
      if (!current) return { status: 404 as const, error: "Recommendation not found" };
      const from = current.status as TriageStatus;
      if (!canMessageReporter(from, close)) {
        return { status: 409 as const, error: `This report is already ${from === "in_progress" ? "being fixed" : "closed"} — send the message without closing it.` };
      }
      const [issue] = await tx.select().from(andonIssuesTable).where(eq(andonIssuesTable.id, current.andonIssueId));
      if (!issue) return { status: 404 as const, error: "The report no longer exists" };
      const sent = await messageReporter(tx, issue, { triageId: current.id, senderUserId: userId, senderName: name, message, close });
      let row = current;
      if (close) {
        [row] = await tx.update(issueTriageTable).set({
          status: "answered", awaitingRetriage: false, decisionNote: message, decidedBy: name, decidedByUserId: userId,
          decidedAt: new Date(), issueResolvedAt: new Date(), updatedAt: new Date(),
        }).where(eq(issueTriageTable.id, id)).returning() as [IssueTriage];
      }
      await recordEvent(tx, row, close ? "answered" : "messaged", name, message);
      if (close) await creditImprovementIfDue(tx, row, name);
      return { status: 200 as const, triage: row, ...sent };
    });
    if (out.status !== 200) { const { status, ...body } = out; res.status(status).json(body); return; }
    const { status: _s, ...body } = out;
    res.json(body);
  } catch (err) {
    console.error("[issue-pipeline] message failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to send the message" });
  }
});

// ── Reporter: "Your report has been fixed" ─────────────────────────────────
router.get("/my-fixed-notices", async (req, res) => {
  try {
    const notices = await pendingNoticesFor(req.session.userId!);
    res.json({ notices });
  } catch (err) {
    console.error("[issue-pipeline] my notices failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to load notices" });
  }
});

const ackBody = z.object({ action: z.enum(NOTICE_ACK_ACTIONS) });

router.post("/my-fixed-notices/:id/ack", validate(ackBody), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId!;
  const { action } = req.body as z.infer<typeof ackBody>;
  try {
    const out = await db.transaction(async (tx) => {
      const [notice] = await tx.select().from(issueFixNoticesTable).where(eq(issueFixNoticesTable.id, id)).for("update");
      const verdict = noticeAckVerdict(notice ?? null, userId);
      if (!verdict.ok) return verdict;
      const [row] = await tx.update(issueFixNoticesTable)
        .set({ acknowledgedAt: new Date(), ackAction: action })
        .where(eq(issueFixNoticesTable.id, id)).returning();
      if (notice!.triageId) {
        const [t] = await tx.select().from(issueTriageTable).where(eq(issueTriageTable.id, notice!.triageId));
        if (t) {
          const [who] = await tx.select({ name: andonIssuesTable.reportedByName }).from(andonIssuesTable).where(eq(andonIssuesTable.id, notice!.andonIssueId));
          await recordEvent(tx, t, "notice_ack", who?.name ?? null, action === "test_now" ? `Issue #${notice!.andonIssueId}: testing it now` : `Issue #${notice!.andonIssueId}: will test later`);
        }
      }
      return { ok: true as const, notice: row };
    });
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    res.json({ notice: out.notice });
  } catch (err) {
    console.error("[issue-pipeline] notice ack failed:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Failed to acknowledge" });
  }
});

export default router;
