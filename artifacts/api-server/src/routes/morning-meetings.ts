/**
 * Morning Meeting routes — the dashboard tile + slideshow.
 *
 * The "dashboard" endpoint here is the heavy one. It aggregates every
 * slide's data in a single round-trip so the slideshow can start
 * instantly without 10 parallel fetches:
 *   - today's special, plan, deliveries, open struggles + safety items
 *   - yesterday's wonkies, builder rate, packing rate (KPI slide)
 *   - recent SOP updates
 *   - this week's lean lesson (rolls through the 12-week curriculum
 *     automatically, admin-overridable per week)
 *
 * Meeting state is kept in `morning_meetings` (one row per day). New
 * struggles and safety issues raised during the meeting POST into the
 * existing improvement_submissions / andon_issues tables so they show
 * up on the kaizen / problem-log boards the team already use.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  productionPlansTable,
  productionPlanItemsTable,
  batchCompletionsTable,
  recipesTable,
  purchaseOrdersTable,
  suppliersTable,
  improvementSubmissionsTable,
  andonIssuesTable,
  leanLessonsTable,
  morningMeetingsTable,
  meetingGratitudeTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, asc, sql, inArray, isNull, notInArray } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();

/** Today's lesson rotates through the 12-week curriculum based on
 *  ISO-week-of-year. Wraps automatically so it runs forever. Admin
 *  can deactivate a lesson and the next active one takes its slot. */
async function getTodayLesson() {
  const now = new Date();
  // ISO-week: first Thursday rule. Good enough for rotation purposes —
  // we just need a stable integer that increments weekly.
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const weekOfYear = Math.floor(dayOfYear / 7) + 1;
  const targetWeek = ((weekOfYear - 1) % 12) + 1;

  // Try the targeted week; fall back to next active lesson if that one
  // has been deactivated.
  let [lesson] = await db
    .select()
    .from(leanLessonsTable)
    .where(and(eq(leanLessonsTable.weekNumber, targetWeek), eq(leanLessonsTable.isActive, true)))
    .limit(1);
  if (!lesson) {
    [lesson] = await db
      .select()
      .from(leanLessonsTable)
      .where(eq(leanLessonsTable.isActive, true))
      .orderBy(asc(leanLessonsTable.weekNumber))
      .limit(1);
  }
  return lesson ?? null;
}

function isoDateMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

router.get("/dashboard", async (_req: Request, res: Response) => {
  try {
    const today = londonDateString();
    const yesterday = isoDateMinusDays(today, 1);

    // ── Today's special ─────────────────────────────────────────────
    const [special] = await db
      .select({ id: recipesTable.id, name: recipesTable.name })
      .from(recipesTable)
      .where(eq(recipesTable.isCurrentSpecial, true))
      .limit(1);

    // ── Today's production plan items (already category-sorted: Mac
    //    & Cheese first, then orderPosition) ─────────────────────────
    const [todayPlan] = await db
      .select({ id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.planDate, today))
      .limit(1);
    let todayPlanItems: Array<{ recipeId: number; recipeName: string; batchesTarget: number; recipeCategory: string | null }> = [];
    if (todayPlan) {
      todayPlanItems = await db
        .select({
          recipeId: productionPlanItemsTable.recipeId,
          recipeName: recipesTable.name,
          batchesTarget: productionPlanItemsTable.batchesTarget,
          recipeCategory: recipesTable.category,
        })
        .from(productionPlanItemsTable)
        .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
        .where(eq(productionPlanItemsTable.planId, todayPlan.id))
        .orderBy(
          sql`CASE WHEN ${recipesTable.category} = 'Macaroni Cheese' THEN 0 ELSE 1 END`,
          productionPlanItemsTable.orderPosition,
        );
    }

    // ── Yesterday's KPIs (wonky / builder rate / packing rate) ──────
    const [yesterdayPlan] = await db
      .select({ id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.planDate, yesterday))
      .limit(1);

    let wonkyCount = 0;
    let shortCount = 0;
    let leftoverFillingGrams = 0;
    let builderBatchesPerHour: number | null = null;
    let packingBatchesPerHour: number | null = null;
    let yesterdayBatchesTotal = 0;

    if (yesterdayPlan) {
      const items = await db
        .select({
          id: productionPlanItemsTable.id,
          wonlyTotal: productionPlanItemsTable.wonlyTotal,
          shortCount: productionPlanItemsTable.shortCount,
          leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
          batchesTarget: productionPlanItemsTable.batchesTarget,
        })
        .from(productionPlanItemsTable)
        .where(eq(productionPlanItemsTable.planId, yesterdayPlan.id));

      const itemIds = items.map(it => it.id);
      for (const it of items) {
        wonkyCount += it.wonlyTotal ?? 0;
        shortCount += it.shortCount ?? 0;
        leftoverFillingGrams += it.leftoverFillingGrams ?? 0;
        yesterdayBatchesTotal += it.batchesTarget ?? 0;
      }

      if (itemIds.length > 0) {
        // Building rate: total batches completed in building stations,
        // divided by the wall-clock span from first to last completion.
        // Approximation — doesn't subtract breaks — but the spread of
        // completions across the morning is what the team cares about.
        const buildingRows = await db
          .select({ completedAt: batchCompletionsTable.completedAt })
          .from(batchCompletionsTable)
          .where(and(
            inArray(batchCompletionsTable.planItemId, itemIds),
            sql`${batchCompletionsTable.stationType} IN ('building_1', 'building_2')`,
          ));
        if (buildingRows.length >= 2) {
          const times = buildingRows.map(r => r.completedAt.getTime()).sort((a, b) => a - b);
          const hours = (times[times.length - 1] - times[0]) / 3_600_000;
          if (hours > 0) {
            builderBatchesPerHour = Math.round((buildingRows.length / hours) * 10) / 10;
          }
        }

        const packingRows = await db
          .select({ completedAt: batchCompletionsTable.completedAt })
          .from(batchCompletionsTable)
          .where(and(
            inArray(batchCompletionsTable.planItemId, itemIds),
            eq(batchCompletionsTable.stationType, "packing"),
          ));
        if (packingRows.length >= 2) {
          const times = packingRows.map(r => r.completedAt.getTime()).sort((a, b) => a - b);
          const hours = (times[times.length - 1] - times[0]) / 3_600_000;
          if (hours > 0) {
            packingBatchesPerHour = Math.round((packingRows.length / hours) * 10) / 10;
          }
        }
      }
    }

    // ── Today's deliveries ─────────────────────────────────────────
    const todayDeliveries = await db
      .select({
        id: purchaseOrdersTable.id,
        supplierName: suppliersTable.name,
        status: purchaseOrdersTable.status,
      })
      .from(purchaseOrdersTable)
      .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
      .where(eq(purchaseOrdersTable.expectedDeliveryDate, today));

    // ── Open safety issues (andon with category=safety, not yet resolved) ─
    const safetyIssues = await db
      .select({
        id: andonIssuesTable.id,
        category: andonIssuesTable.category,
        severity: andonIssuesTable.severity,
        description: andonIssuesTable.description,
        createdAt: andonIssuesTable.createdAt,
      })
      .from(andonIssuesTable)
      .where(and(
        eq(andonIssuesTable.category, "safety"),
        isNull(andonIssuesTable.resolvedAt),
      ))
      .orderBy(desc(andonIssuesTable.createdAt))
      .limit(10);

    // ── Open struggles (improvements tagged type='struggle', not yet
    //    completed or rejected — match the existing kaizen board) ────
    const struggles = await db
      .select({
        id: improvementSubmissionsTable.id,
        title: improvementSubmissionsTable.title,
        description: improvementSubmissionsTable.description,
        createdAt: improvementSubmissionsTable.createdAt,
      })
      .from(improvementSubmissionsTable)
      .where(and(
        eq(improvementSubmissionsTable.type, "struggle"),
        notInArray(improvementSubmissionsTable.progressStatus, ["complete", "rejected"]),
      ))
      .orderBy(desc(improvementSubmissionsTable.createdAt))
      .limit(10);

    // ── SOPs updated in the last 7 days ────────────────────────────
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSops = await db.execute<{ id: number; title: string; updated_at: Date }>(sql`
      SELECT id, title, updated_at
      FROM risk_assessments
      WHERE assessment_type = 'sop' AND updated_at >= ${sevenDaysAgo.toISOString()}
      ORDER BY updated_at DESC
      LIMIT 20
    `);

    // ── Today's lean lesson ─────────────────────────────────────────
    const lesson = await getTodayLesson();

    // ── Existing meeting record (if one's been started today) ──────
    const [meeting] = await db
      .select()
      .from(morningMeetingsTable)
      .where(eq(morningMeetingsTable.meetingDate, today))
      .limit(1);

    let gratitude: Array<{ id: number; fromName: string; toName: string | null; content: string }> = [];
    if (meeting) {
      gratitude = await db
        .select({
          id: meetingGratitudeTable.id,
          fromName: meetingGratitudeTable.fromName,
          toName: meetingGratitudeTable.toName,
          content: meetingGratitudeTable.content,
        })
        .from(meetingGratitudeTable)
        .where(eq(meetingGratitudeTable.meetingId, meeting.id))
        .orderBy(desc(meetingGratitudeTable.createdAt));
    }

    res.json({
      today,
      yesterday,
      special,
      todayPlan: {
        id: todayPlan?.id ?? null,
        items: todayPlanItems,
      },
      yesterdayKpis: {
        wonkyCount,
        shortCount,
        leftoverFillingGrams,
        builderBatchesPerHour,
        packingBatchesPerHour,
        batchesTarget: yesterdayBatchesTotal,
      },
      todayDeliveries,
      safetyIssues,
      struggles,
      recentSops: (recentSops.rows ?? recentSops).map((r: any) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updated_at,
      })),
      lesson,
      meeting: meeting
        ? {
            id: meeting.id,
            hostName: meeting.hostName,
            startedAt: meeting.startedAt.toISOString(),
            endedAt: meeting.endedAt?.toISOString() ?? null,
            lessonId: meeting.lessonId,
          }
        : null,
      gratitude,
    });
  } catch (err: any) {
    console.error("[morning-meetings] dashboard error:", err);
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

/** Start (or reuse) today's meeting. The host sets their name; if the
 *  meeting record already exists the host name is updated so a second
 *  person can take over mid-meeting. */
router.post("/start", async (req: Request, res: Response) => {
  try {
    const { hostName, lessonId } = req.body as { hostName?: string; lessonId?: number };
    const today = londonDateString();
    const userId = (req.session as any)?.userId ?? null;
    let resolvedName = hostName?.trim();
    if (!resolvedName && userId) {
      const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      resolvedName = u?.name ?? null;
    }
    if (!resolvedName) {
      res.status(400).json({ error: "hostName is required when no logged-in user" });
      return;
    }
    const [row] = await db
      .insert(morningMeetingsTable)
      .values({
        meetingDate: today,
        hostUserId: userId,
        hostName: resolvedName,
        lessonId: lessonId ?? null,
      })
      .onConflictDoUpdate({
        target: morningMeetingsTable.meetingDate,
        set: {
          hostUserId: userId,
          hostName: resolvedName,
          lessonId: lessonId ?? null,
        },
      })
      .returning();
    res.json({ id: row.id, hostName: row.hostName, meetingDate: row.meetingDate });
  } catch (err: any) {
    console.error("[morning-meetings] start error:", err);
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

/** End the meeting — records the end timestamp so we can track average
 *  duration across days. */
router.post("/:id/end", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid meeting id" }); return; }
  await db
    .update(morningMeetingsTable)
    .set({ endedAt: new Date() })
    .where(eq(morningMeetingsTable.id, id));
  res.json({ ok: true });
});

/** Add a gratitude shout-out captured live during the meeting. */
router.post("/:id/gratitude", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { fromName, toName, content } = req.body as { fromName: string; toName?: string; content: string };
  if (!id || !fromName || !content) {
    res.status(400).json({ error: "fromName and content are required" });
    return;
  }
  const [row] = await db
    .insert(meetingGratitudeTable)
    .values({ meetingId: id, fromName, toName: toName ?? null, content })
    .returning();
  res.status(201).json(row);
});

/** Recent meeting history — last 14 days, for the "past meetings"
 *  side panel and host-engagement leaderboard. */
router.get("/recent", async (_req: Request, res: Response) => {
  const fourteenDaysAgo = isoDateMinusDays(londonDateString(), 14);
  const rows = await db
    .select({
      id: morningMeetingsTable.id,
      meetingDate: morningMeetingsTable.meetingDate,
      hostName: morningMeetingsTable.hostName,
      lessonId: morningMeetingsTable.lessonId,
      startedAt: morningMeetingsTable.startedAt,
      endedAt: morningMeetingsTable.endedAt,
    })
    .from(morningMeetingsTable)
    .where(gte(morningMeetingsTable.meetingDate, fourteenDaysAgo))
    .orderBy(desc(morningMeetingsTable.meetingDate));
  res.json(rows);
});

// ── Lean lesson CRUD (admin) ──────────────────────────────────────

router.get("/lessons", async (_req: Request, res: Response) => {
  const lessons = await db
    .select()
    .from(leanLessonsTable)
    .orderBy(asc(leanLessonsTable.weekNumber));
  res.json(lessons);
});

router.get("/lessons/today", async (_req: Request, res: Response) => {
  const lesson = await getTodayLesson();
  res.json(lesson);
});

router.put("/lessons/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Partial<{
    title: string;
    summary: string;
    explanationMd: string;
    whatToShowMd: string;
    deliveryNotesMd: string;
    videoUrl: string | null;
    isActive: boolean;
  }>;
  const [updated] = await db
    .update(leanLessonsTable)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.explanationMd !== undefined ? { explanationMd: body.explanationMd } : {}),
      ...(body.whatToShowMd !== undefined ? { whatToShowMd: body.whatToShowMd } : {}),
      ...(body.deliveryNotesMd !== undefined ? { deliveryNotesMd: body.deliveryNotesMd } : {}),
      ...(body.videoUrl !== undefined ? { videoUrl: body.videoUrl } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leanLessonsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Lesson not found" }); return; }
  res.json(updated);
});

export default router;

// Silence unused-import warnings for filters that are exported but not
// used directly above (kept available for future endpoints).
void lte;
