/**
 * "Have you made an improvement today?" — the optional last item on every
 * closing checklist (Graeme, 27 Oct 2026; Objectives E and H).
 *
 *   GET  /api/improvement-prompt/today   — my answer for today (London day),
 *                                           and the improvements I've already
 *                                           logged today
 *   POST /api/improvement-prompt/answer  — { answer: "yes"|"no",
 *                                            improvementId? (required for yes),
 *                                            stationType?, planId?, templateId? }
 *   GET  /api/improvement-prompt/uptake  — managers: last N days' answers
 *
 * Always about the SIGNED-IN person (after a PIN switch on a shared iPad
 * the session is the new person's). One answer per person per day;
 * answering again replaces it.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { db, improvementPromptAnswersTable, improvementSubmissionsTable, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { londonDateString, londonStartOfDay, londonEndOfDay } from "../lib/london-time";
import { addCalendarDays } from "../lib/fridge-expiry";
import { PROMPT_ANSWERS, answerProblem, answerRow, summariseUptake, type UptakeRow, type PromptAnswer } from "../lib/improvement-prompt";

const router: IRouter = Router();

router.get("/today", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const day = londonDateString();
  const [row] = await db.select({
    answer: improvementPromptAnswersTable.answer,
    improvementId: improvementPromptAnswersTable.improvementId,
    improvementTitle: improvementSubmissionsTable.title,
    answeredAt: improvementPromptAnswersTable.answeredAt,
  })
    .from(improvementPromptAnswersTable)
    .leftJoin(improvementSubmissionsTable, eq(improvementSubmissionsTable.id, improvementPromptAnswersTable.improvementId))
    .where(and(eq(improvementPromptAnswersTable.userId, userId), eq(improvementPromptAnswersTable.day, day)));

  // What they've already logged today (London day), so "Yes" can count one
  // of those instead of asking them to log the same thing twice.
  const logged = await db.select({ id: improvementSubmissionsTable.id, title: improvementSubmissionsTable.title })
    .from(improvementSubmissionsTable)
    .where(and(
      or(eq(improvementSubmissionsTable.submittedBy, userId), eq(improvementSubmissionsTable.creditedTo, userId)),
      gte(improvementSubmissionsTable.createdAt, londonStartOfDay()),
      lte(improvementSubmissionsTable.createdAt, londonEndOfDay()),
    ))
    .orderBy(desc(improvementSubmissionsTable.createdAt))
    .limit(5);

  res.json({
    day,
    answer: row ? {
      answer: row.answer as PromptAnswer,
      improvementId: row.improvementId,
      improvementTitle: row.improvementTitle ?? null,
      answeredAt: row.answeredAt.toISOString(),
    } : null,
    loggedToday: logged,
  });
});

const answerSchema = z.object({
  answer: z.enum(PROMPT_ANSWERS),
  improvementId: z.number().int().positive().nullable().optional(),
  stationType: z.string().trim().min(1).max(60).optional(),
  planId: z.number().int().positive().optional(),
  templateId: z.number().int().positive().optional(),
});

router.post("/answer", validate(answerSchema), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as z.infer<typeof answerSchema>;
  const problem = answerProblem(body);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const row = answerRow(body);
  if (row.improvementId != null) {
    const [imp] = await db.select({ id: improvementSubmissionsTable.id })
      .from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, row.improvementId));
    if (!imp) { res.status(400).json({ error: "That improvement wasn't found" }); return; }
  }
  const day = londonDateString();
  const values = {
    userId,
    day,
    answer: row.answer,
    improvementId: row.improvementId,
    stationType: body.stationType ?? null,
    planId: body.planId ?? null,
    templateId: body.templateId ?? null,
    answeredAt: new Date(),
  };
  const [saved] = await db.insert(improvementPromptAnswersTable).values(values)
    .onConflictDoUpdate({
      target: [improvementPromptAnswersTable.userId, improvementPromptAnswersTable.day],
      set: {
        answer: values.answer,
        improvementId: values.improvementId,
        stationType: values.stationType,
        planId: values.planId,
        templateId: values.templateId,
        answeredAt: values.answeredAt,
      },
    })
    .returning();
  res.json({ ok: true, day, answer: saved.answer, improvementId: saved.improvementId });
});

const MAX_DAYS = 60;

router.get("/uptake", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const daysRaw = Number(req.query.days ?? 14);
  const days = Number.isFinite(daysRaw) ? Math.min(MAX_DAYS, Math.max(1, Math.round(daysRaw))) : 14;
  const to = londonDateString();
  const from = addCalendarDays(to, -(days - 1));
  const rows = await db.select({
    day: improvementPromptAnswersTable.day,
    userId: improvementPromptAnswersTable.userId,
    name: usersTable.name,
    answer: improvementPromptAnswersTable.answer,
    improvementId: improvementPromptAnswersTable.improvementId,
    improvementTitle: improvementSubmissionsTable.title,
    stationType: improvementPromptAnswersTable.stationType,
  })
    .from(improvementPromptAnswersTable)
    .innerJoin(usersTable, eq(usersTable.id, improvementPromptAnswersTable.userId))
    .leftJoin(improvementSubmissionsTable, eq(improvementSubmissionsTable.id, improvementPromptAnswersTable.improvementId))
    .where(gte(improvementPromptAnswersTable.day, from))
    .orderBy(desc(improvementPromptAnswersTable.day), desc(improvementPromptAnswersTable.answeredAt));
  const answers: UptakeRow[] = rows.map(r => ({
    ...r,
    answer: r.answer as PromptAnswer,
    improvementTitle: r.improvementTitle ?? null,
  }));
  res.json({ from, to, ...summariseUptake(answers), answers });
});

export default router;
