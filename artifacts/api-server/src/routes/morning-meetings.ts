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
  leanPrinciplesTable,
  leanExamplesTable,
  meetingTemplatesTable,
  templateSlidesTable,
  meetingSlidesTable,
  morningMeetingsTable,
  meetingGratitudeTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, asc, sql, inArray, isNull, notInArray } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();

/** Picks this week's principle (rotates by week-of-year through every
 *  active row in lean_principles) and the default example for today
 *  within that principle (rotates by weekday). Host can override on
 *  the meeting slide via configJson.exampleId. */
async function getTodayPrincipleAndExample() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const weekOfYear = Math.floor(dayOfYear / 7) + 1;

  const principles = await db
    .select()
    .from(leanPrinciplesTable)
    .where(eq(leanPrinciplesTable.isActive, true))
    .orderBy(asc(leanPrinciplesTable.weekPosition));
  if (principles.length === 0) return { principle: null, example: null };
  const principle = principles[(weekOfYear - 1) % principles.length];

  const examples = await db
    .select()
    .from(leanExamplesTable)
    .where(and(eq(leanExamplesTable.principleId, principle.id), eq(leanExamplesTable.isActive, true)))
    .orderBy(asc(leanExamplesTable.orderPosition));
  if (examples.length === 0) return { principle, example: null };
  // Monday = 1 .. Sunday = 0 from Date.getDay(). Use weekday-1 so the
  // first example shows Monday, second Tuesday, etc. Wraps on the
  // weekend so weekend hosts still see an example.
  const weekday = ((now.getDay() + 6) % 7);
  const example = examples[weekday % examples.length];
  return { principle, example };
}

/** Backwards-compat shim — returns the legacy lean_lessons-shaped row
 *  the dashboard already exposes. New code reads principle/example
 *  directly. */
async function getTodayLessonLegacy() {
  const { principle, example } = await getTodayPrincipleAndExample();
  if (!principle || !example) return null;
  return {
    id: example.id,
    weekNumber: principle.weekPosition,
    title: example.title,
    summary: example.summary,
    explanationMd: example.explanationMd,
    whatToShowMd: example.whatToShowMd,
    deliveryNotesMd: example.deliveryNotesMd,
    videoUrl: example.videoUrl,
    principleId: principle.id,
    principleTitle: principle.title,
  };
}

/** Clones the default template's slide rows into a meeting. Idempotent:
 *  no-op if the meeting already has any slides. Returns the resulting
 *  slide list ordered by orderPosition. */
async function cloneTemplateSlidesIfEmpty(meetingId: number) {
  const existing = await db
    .select({ id: meetingSlidesTable.id })
    .from(meetingSlidesTable)
    .where(eq(meetingSlidesTable.meetingId, meetingId))
    .limit(1);
  if (existing.length > 0) return;

  const [defaultTpl] = await db
    .select({ id: meetingTemplatesTable.id })
    .from(meetingTemplatesTable)
    .where(eq(meetingTemplatesTable.isDefault, true))
    .limit(1);
  if (!defaultTpl) return;

  const tplSlides = await db
    .select()
    .from(templateSlidesTable)
    .where(eq(templateSlidesTable.templateId, defaultTpl.id))
    .orderBy(asc(templateSlidesTable.orderPosition));
  if (tplSlides.length === 0) return;

  await db.insert(meetingSlidesTable).values(
    tplSlides.map((s) => ({
      meetingId,
      kind: s.kind,
      title: s.title,
      orderPosition: s.orderPosition,
      contentMd: s.contentMd,
      configJson: s.configJson,
    })),
  );
}

async function fetchMeetingSlides(meetingId: number) {
  return db
    .select()
    .from(meetingSlidesTable)
    .where(eq(meetingSlidesTable.meetingId, meetingId))
    .orderBy(asc(meetingSlidesTable.orderPosition));
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

    // ── Today's lean lesson — picks this week's principle + today's
    //    example, with the legacy shape kept on `lesson` so existing
    //    frontend code keeps working unchanged ───────────────────────
    const lesson = await getTodayLessonLegacy();

    // ── Existing meeting record + its slide list. Slides live in DB
    //    now; the runner reads from `slides` instead of a hardcoded
    //    array. Auto-clone the default template the first time anyone
    //    interacts with today's meeting (handled by /start), so by the
    //    time the slideshow opens this list is always populated ────
    const [meeting] = await db
      .select()
      .from(morningMeetingsTable)
      .where(eq(morningMeetingsTable.meetingDate, today))
      .limit(1);

    let gratitude: Array<{ id: number; fromName: string; toName: string | null; content: string }> = [];
    let slides: Awaited<ReturnType<typeof fetchMeetingSlides>> = [];
    if (meeting) {
      slides = await fetchMeetingSlides(meeting.id);
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
            exampleId: meeting.exampleId ?? null,
          }
        : null,
      slides: slides.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        orderPosition: s.orderPosition,
        contentMd: s.contentMd,
        configJson: s.configJson,
      })),
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
    // First time today's meeting is started → clone the default
    // template's slides in. Reusing an existing meeting is a no-op
    // (cloneTemplateSlidesIfEmpty short-circuits when slides exist),
    // so this is also safe when a second person takes over the host
    // role mid-meeting.
    await cloneTemplateSlidesIfEmpty(row.id);
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
  const lesson = await getTodayLessonLegacy();
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
