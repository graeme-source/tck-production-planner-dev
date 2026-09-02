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

// The founder reviews AHEAD: their weekly task is NEXT week's module,
// done by the end of this week — so they always know what's coming, have
// already fixed anything wrong with it, and (same rules as everyone)
// completing it counts as their review for that week. Founder is matched
// by email, same pattern as the founder pages; the local test account is
// included so the flow is testable off-live (no such user exists on live).
/** Exported for the improvements review queue — the same person owns both. */
export const FOUNDER_EMAILS = new Set([
  "graeme@thecalzonekitchen.co.uk",
  "claude-test@thecalzonekitchen.co.uk",
]);

async function isFounder(userId: number): Promise<boolean> {
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  return !!user && FOUNDER_EMAILS.has(user.email);
}

/** Monday + 7 days. */
function nextMondayFrom(monday: string): string {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/** Lazily ensure a weekly lean to-do exists — the push that makes the
 *  module findable from My To-dos. Identified by (assignee, lean_week_start),
 *  never by title. No-op once the task exists. */
async function ensureWeeklyTodo(params: {
  userId: number;
  weekStart: string;
  title: string;
  notes: string;
  url: string;
  dueDate: string;
}) {
  await db.execute(sql`
    INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, due_date, status, lean_week_start)
    SELECT ${params.userId}, NULL, 'Lean learning',
           ${params.title}, ${params.notes}, ${params.url}, 'normal',
           ${params.dueDate}::date, 'open', ${params.weekStart}
    WHERE NOT EXISTS (
      SELECT 1 FROM todo_tasks WHERE assignee_id = ${params.userId} AND lean_week_start = ${params.weekStart}
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

  if (await isFounder(userId)) {
    // The founder's standing task is NEXT week's module, due by the end of
    // THIS week. If they fall behind, the task simply ages into the normal
    // current-week flow: completing this week's module closes it, because
    // both key on the same lean_week_start.
    const nextMonday = nextMondayFrom(weekStart);
    const [nextReview] = await db
      .select({ id: leanLessonReviewsTable.id })
      .from(leanLessonReviewsTable)
      .where(and(eq(leanLessonReviewsTable.userId, userId), eq(leanLessonReviewsTable.weekStart, nextMonday)));
    if (!nextReview) {
      const { principle: nextPrinciple } = (await getWeekFocusPrinciple(nextMonday)) as { principle: LeanPrincipleRow | null };
      if (nextPrinciple) {
        await ensureWeeklyTodo({
          userId,
          weekStart: nextMonday,
          title: `Review next week's lean module: ${nextPrinciple.title}`,
          notes: "Founder review-ahead: read next week's five pages, check the videos and quiz, swap anything that isn't right — then count it as your completion. Same rules as everyone, a week early.",
          url: "/lean-review?week=next",
          // Due the Friday of the CURRENT week — reviewed before it starts.
          dueDate: new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 4 * 86_400_000).toISOString().slice(0, 10),
        });
      }
    }
  } else if (!review) {
    await ensureWeeklyTodo({
      userId,
      weekStart,
      title: `Lean lesson of the week: ${principle.title}`,
      notes: "Two minutes: the week's five morning-meeting pages, then three quick questions. Completing it ticks your Lean training matrix.",
      url: "/lean-review",
      dueDate: new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 4 * 86_400_000).toISOString().slice(0, 10),
    });
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

// GET /api/lean-reviews/preview — NEXT week's module, for the founder's
// review-ahead ritual: learn next week's lesson by the end of this week,
// swap a video, fix wording — before the team ever sees it. Returns the
// quiz WITH its answers (this is a content review, not a test) and the
// example ids so the page can offer inline video swapping via the existing
// example PUT. Manager/admin only.
router.get("/preview", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const nextMonday = nextMondayFrom(mondayOf(londonDateString()));
  const { principle } = (await getWeekFocusPrinciple(nextMonday)) as { principle: LeanPrincipleRow | null };
  const founder = await isFounder(userId);
  if (!principle) {
    res.json({ weekStart: nextMonday, principle: null, lessons: [], quiz: [], canSelfComplete: founder, selfCompleted: false });
    return;
  }
  const [nextReview] = await db
    .select({ id: leanLessonReviewsTable.id })
    .from(leanLessonReviewsTable)
    .where(and(eq(leanLessonReviewsTable.userId, userId), eq(leanLessonReviewsTable.weekStart, nextMonday)));
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
  res.json({
    weekStart: nextMonday,
    principle: { id: principle.id, title: principle.title, summary: principle.summary },
    lessons,
    quiz: parseQuiz(principle.quizJson ?? null),
    canSelfComplete: founder,
    selfCompleted: !!nextReview,
  });
});

// POST /api/lean-reviews/preview/complete — the founder's review-ahead
// completion: reviewing next week's module counts as their review for
// that week (same rules as everyone, a week early), ticks their matrix
// cell and closes the review-ahead to-do. Founder only.
router.post("/preview/complete", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  if (!(await isFounder(userId))) { res.status(403).json({ error: "Founder only" }); return; }
  // Deliberately NOT gated on reviewsEnabled: the launch plan is to ship
  // with the team-facing switch off during the prep week while the founder
  // reviews ahead — their review-ahead must work while everything else
  // stays dark.
  const nextMonday = nextMondayFrom(mondayOf(londonDateString()));
  const { principle } = (await getWeekFocusPrinciple(nextMonday)) as { principle: LeanPrincipleRow | null };
  if (!principle) { res.status(409).json({ error: "No lean focus is set for next week" }); return; }

  await db.insert(leanLessonReviewsTable).values({
    userId,
    principleId: principle.id,
    weekStart: nextMonday,
  }).onConflictDoNothing();

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

  await db.execute(sql`
    UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
    WHERE assignee_id = ${userId} AND lean_week_start = ${nextMonday} AND status <> 'done'
  `);

  res.json({ passed: true });
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
