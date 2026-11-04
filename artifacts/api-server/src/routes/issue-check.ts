/**
 * AI Jane's check on an app report before it's filed, and "Keep me posted"
 * (Graeme, 2026-11-04). Anyone signed in. See lib/issue-report-check.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, andonIssueFollowersTable, andonIssuesTable, issueReportChecksTable, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireFounder } from "../middleware/founder-access";
import { isClaudeConfigured } from "../lib/ai/claude";
import { checkReport } from "../lib/issue-report-check";

const router: IRouter = Router();

const checkBody = z.object({
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(4000) })).min(1).max(8),
});

// Never a failure the person sees: no answer just means "file it".
router.post("/", validate(checkBody), async (req: Request, res: Response) => {
  const { history } = req.body as z.infer<typeof checkBody>;
  if (!isClaudeConfigured() || history[history.length - 1].role !== "user") { res.json({ answer: null }); return; }
  try {
    const answer = await checkReport(history);
    if (answer.outcome === "ask") { res.json({ answer, checkId: null }); return; }
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
    const [row] = await db.insert(issueReportChecksTable).values({
      userId: req.session.userId!, userName: user?.name ?? null,
      description: history.filter(m => m.role === "user").map(m => m.text).join("\n"),
      outcome: answer.outcome, reply: answer.message, path: answer.path, matchedIssueId: answer.issueId,
    }).returning({ id: issueReportChecksTable.id });
    res.json({ answer, checkId: row.id });
  } catch (err) {
    console.error("[issue-check] failed, filing the report as normal:", err instanceof Error ? err.message : String(err));
    res.json({ answer: null });
  }
});

const resultBody = z.object({
  result: z.enum(["resolved", "followed", "reported"]),
  filedIssueId: z.number().int().positive().nullable().optional(),
});

// What they did with her answer. "followed" also signs them up for updates.
router.post("/:id/result", validate(resultBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { result, filedIssueId } = req.body as z.infer<typeof resultBody>;
  const [check] = await db.select().from(issueReportChecksTable).where(eq(issueReportChecksTable.id, id));
  if (!check || check.userId !== req.session.userId) { res.status(404).json({ error: "Check not found" }); return; }
  await db.update(issueReportChecksTable).set({ result, filedIssueId: filedIssueId ?? null }).where(eq(issueReportChecksTable.id, id));
  if (result === "followed" && check.matchedIssueId) {
    const [issue] = await db.select({ reportedBy: andonIssuesTable.reportedBy }).from(andonIssuesTable).where(eq(andonIssuesTable.id, check.matchedIssueId));
    // The reporter already hears; following your own report adds nothing.
    if (issue && issue.reportedBy !== req.session.userId) {
      await db.insert(andonIssueFollowersTable).values({ andonIssueId: check.matchedIssueId, userId: req.session.userId! }).onConflictDoNothing();
    }
  }
  res.json({ ok: true });
});

// What Jane answered lately, for the Fix queue: nothing stays hidden.
router.get("/recent", requireFounder, async (_req: Request, res: Response) => {
  const rows = await db.select().from(issueReportChecksTable).orderBy(desc(issueReportChecksTable.createdAt)).limit(30);
  res.json({ items: rows });
});

export default router;
