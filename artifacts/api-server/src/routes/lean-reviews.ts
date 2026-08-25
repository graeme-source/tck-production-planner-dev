/**
 * Weekly lean lesson reviews (Objective E — the "impossible not to learn"
 * loop, Graeme 2026-08-25).
 *
 * Everyone reviews the SAME weekly module, in lockstep with the morning
 * meeting: the module's pages are the week's five meeting lessons, and its
 * last page is a short quiz. All answers must be right to complete —
 * retries are free; the goal is understanding, not examination.
 *
 * Completion closes the loop in three places at once:
 *   1. a lean_lesson_reviews row (one per person per week),
 *   2. the person's cell on the Lean training matrix (the matrix item that
 *      carries this week's principle_id) — self-filling matrix,
 *   3. the auto-created weekly to-do (lean_week_start marks it; created
 *      lazily for each person the first time they load the module that
 *      week, so it surfaces in My To-dos with a deep link).
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, asc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  leanPrinciplesTable,
  leanExamplesTable,
  leanLessonReviewsTable,
  trainingMatrixItemsTable,
  trainingMatrixEnrolmentsTable,
  trainingRecordsTable,
  usersTable,
} from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import { mondayOf, getWeekFocusPrinciple } from "./morning-meetings";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// Kill switch (Graeme, 2026-08-25: "in case it doesn't work in the first
// instance, I just want to get rid of it rather than give people a bad
// experience"). Off = the strip disappears, the page shows nothing to do,
// no to-dos are created. Toggled from the meeting page's curriculum editor.
const REVIEW_ENABLED_KEY = "lean_weekly_review_enabled";

async function reviewsEnabled(): Promise<boolean> {
  const rows = await db.execute<{ value: string }>(sql`
    SELECT value FROM app_settings WHERE key = ${REVIEW_ENABLED_KEY}
  `);
  const value = (rows.rows ?? [])[0]?.value;
  return value !== "false"; // absent = on
}

interface QuizQuestion { question: string; options: string[]; answer: number }

function parseQuiz(quizJson: string | null): QuizQuestion[] {
  if (!quizJson) return [];
  try {
    const parsed = JSON.parse(quizJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type LeanPrincipleRow = typeof leanPrinciplesTable.$inferSelect;
type LeanReviewRow = typeof leanLessonReviewsTable.$inferSelect;

/** This week's principle + the caller's completion state. Explicitly typed:
 *  the route-module import graph is cyclic enough that TS collapses the
 *  inferred getWeekFocusPrinciple result to null without the annotation. */
async function currentWeekContext(userId: number): Promise<{
  weekStart: string;
  principle: LeanPrincipleRow | null;
  review: LeanReviewRow | null;
}> {
  const weekStart = mondayOf(londonDateString());
  const { principle } = (await getWeekFocusPrinciple(weekStart)) as { principle: LeanPrincipleRow | null };
  if (!principle) return { weekStart, principle: null, review: null };
  const [review] = await db
    .select()
    .from(leanLessonReviewsTable)
    .where(and(eq(leanLessonReviewsTable.userId, userId), eq(leanLessonReviewsTable.weekStart, weekStart)));
  return { weekStart, principle, review: review ?? null };
}

/** Lazily ensure this person's weekly to-do exists — the push that makes
 *  the module findable from My To-dos. Identified by lean_week_start,
 *  never by title. No-op once the review is done or the task exists. */
async function ensureWeeklyTodo(userId: number, weekStart: string, principleTitle: string) {
  await db.execute(sql`
    INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status, lean_week_start)
    SELECT ${userId}, NULL, 'Lean learning',
           ${`Lean lesson of the week: ${principleTitle}`},
           'Two minutes: the week''s five morning-meeting pages, then three quick questions. Completing it ticks your Lean training matrix.',
           '/lean-review', 'normal',
           (${weekStart}::date + 4), -- due Friday of that week
           'open', ${weekStart}
    WHERE NOT EXISTS (
      SELECT 1 FROM todo_tasks WHERE assignee_id = ${userId} AND lean_week_start = ${weekStart}
    )
  `);
}

// GET /api/lean-reviews/current — the week's module for the signed-in user:
// principle, five lesson pages, quiz questions (without answers), and the
// caller's completion state.
router.get("/current", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  if (!(await reviewsEnabled())) {
    res.json({ weekStart: mondayOf(londonDateString()), principle: null, lessons: [], quiz: [], completed: false, disabled: true });
    return;
  }
  const { weekStart, principle, review } = await currentWeekContext(userId);
  if (!principle) {
    res.json({ weekStart, principle: null, lessons: [], quiz: [], completed: false });
    return;
  }
  const lessons = await db
    .select({
      id: leanExamplesTable.id,
      title: leanExamplesTable.title,
      summary: leanExamplesTable.summary,
      whatToShowMd: leanExamplesTable.whatToShowMd,
      diagram: leanExamplesTable.diagram,
      imageUrl: leanExamplesTable.imageUrl,
      videoUrl: leanExamplesTable.videoUrl,
    })
    .from(leanExamplesTable)
    .where(and(eq(leanExamplesTable.principleId, principle.id), eq(leanExamplesTable.isActive, true)))
    .orderBy(asc(leanExamplesTable.orderPosition));

  const quiz = parseQuiz(principle.quizJson ?? null);

  if (!review) {
    await ensureWeeklyTodo(userId, weekStart, principle.title);
  }

  res.json({
    weekStart,
    principle: { id: principle.id, title: principle.title, summary: principle.summary },
    lessons,
    // The answers stay server-side — the quiz checks understanding, and a
    // peek at the payload shouldn't hand out the answer key.
    quiz: quiz.map(q => ({ question: q.question, options: q.options })),
    completed: !!review,
    completedAt: review?.completedAt ?? null,
  });
});

const completeSchema = z.object({
  answers: z.array(z.number().int().min(0)).max(20),
});

// POST /api/lean-reviews/complete — check the quiz, and on a full-marks
// pass record the review, tick the Lean matrix, close the weekly to-do.
router.post("/complete", requireAuth, validate(completeSchema), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  if (!(await reviewsEnabled())) { res.status(409).json({ error: "Weekly reviews are switched off" }); return; }
  const { answers } = req.body as { answers: number[] };
  const { weekStart, principle, review } = await currentWeekContext(userId);
  if (!principle) { res.status(409).json({ error: "No lean focus is set for this week" }); return; }
  if (review) { res.json({ passed: true, alreadyCompleted: true }); return; }

  const quiz = parseQuiz(principle.quizJson ?? null);
  const total = quiz.length;
  const correct = quiz.filter((q, i) => answers[i] === q.answer).length;
  if (total > 0 && (answers.length !== total || correct !== total)) {
    // Not a failure state to store — just "not yet". Retries are free.
    res.json({ passed: false, correct, total });
    return;
  }

  await db.insert(leanLessonReviewsTable).values({
    userId,
    principleId: principle.id,
    weekStart,
    quizCorrect: total > 0 ? correct : null,
    quizTotal: total > 0 ? total : null,
  }).onConflictDoNothing();

  // Self-filling training matrix: tick the item that certifies this week's
  // principle, enrolling the person on first contact.
  const [item] = await db
    .select({ id: trainingMatrixItemsTable.id, matrixId: trainingMatrixItemsTable.matrixId })
    .from(trainingMatrixItemsTable)
    .where(eq(trainingMatrixItemsTable.principleId, principle.id));
  if (item) {
    await db.insert(trainingMatrixEnrolmentsTable)
      .values({ matrixId: item.matrixId, userId })
      .onConflictDoNothing();
    await db.execute(sql`
      INSERT INTO training_records (item_id, user_id, trained, trained_at, signed_off_by_user_id, signed_off_by_name)
      VALUES (${item.id}, ${userId}, TRUE, ${londonDateString()}, NULL, 'In-app lesson review')
      ON CONFLICT (item_id, user_id)
      DO UPDATE SET trained = TRUE, trained_at = EXCLUDED.trained_at,
                    signed_off_by_name = 'In-app lesson review', updated_at = NOW()
    `);
  }

  // Close the weekly to-do so My To-dos reflects the completion.
  await db.execute(sql`
    UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
    WHERE assignee_id = ${userId} AND lean_week_start = ${weekStart} AND status <> 'done'
  `);

  res.json({ passed: true, correct, total });
});

// GET /api/lean-reviews/status — this week's completion per active user,
// for the founder's Thursday-laggards view. Manager/admin only.
router.get("/status", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  const weekStart = mondayOf(londonDateString());
  const { principle } = await getWeekFocusPrinciple(weekStart);
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.isActive, true))
    .orderBy(asc(usersTable.name));
  const reviews = await db
    .select({ userId: leanLessonReviewsTable.userId, completedAt: leanLessonReviewsTable.completedAt })
    .from(leanLessonReviewsTable)
    .where(eq(leanLessonReviewsTable.weekStart, weekStart));
  const byUser = new Map(reviews.map(r => [r.userId, r.completedAt]));
  res.json({
    weekStart,
    principleTitle: principle?.title ?? null,
    users: users.map(u => ({ id: u.id, name: u.name, completedAt: byUser.get(u.id) ?? null })),
  });
});

const settingsSchema = z.object({ enabled: z.boolean() });

// GET/PATCH /api/lean-reviews/settings — the kill switch, admin/manager.
router.get("/settings", requireManagerOrAdmin, async (_req: Request, res: Response) => {
  res.json({ enabled: await reviewsEnabled() });
});
router.patch("/settings", requireManagerOrAdmin, validate(settingsSchema), async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled: boolean };
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${REVIEW_ENABLED_KEY}, ${enabled ? "true" : "false"}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.json({ enabled });
});

export default router;
