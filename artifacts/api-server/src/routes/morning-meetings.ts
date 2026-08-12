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
import multer from "multer";
import {
  db,
  productionPlansTable,
  productionPlanItemsTable,
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
  appSettingsTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, asc, sql, isNull, notInArray } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";
import {
  computeBuilderBatchesPerHourForDay,
  computePackingOrdersPerHourForDay,
} from "../lib/yesterday-kpis";
import { getPreviousDispatchDayAsync } from "./production-plans";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";
import { leanCorpusPrompt } from "../lib/lean-corpus";
import type Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

// Gratitude-slide photo upload. In-memory, 10MB image cap, stored as bytea on
// the meeting row (same approach as improvement attachments / SOP media).
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const GRATITUDE_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

const ON_DEMAND_PRINCIPLE_TITLE = "On-demand lessons";

/** Monday (YYYY-MM-DD) of the week containing the given London date. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/** Which principle is the focus for the week starting `weekStart`?
 *  An explicit row in lean_week_focus wins; otherwise the active
 *  curriculum (minus the on-demand catch-all) is walked in weekPosition
 *  order from the anchor week. */
async function getWeekFocusPrinciple(weekStart: string) {
  const [override] = await db.execute<{ principle_id: number }>(sql`
    SELECT principle_id FROM lean_week_focus WHERE week_start = ${weekStart}
  `).then(r => r.rows);
  if (override) {
    const [p] = await db.select().from(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, override.principle_id));
    if (p) return { principle: p, source: "override" as const };
  }

  const actives = await db
    .select()
    .from(leanPrinciplesTable)
    .where(eq(leanPrinciplesTable.isActive, true))
    .orderBy(asc(leanPrinciplesTable.weekPosition));
  const rotation = actives.filter(p => p.title !== ON_DEMAND_PRINCIPLE_TITLE);
  if (rotation.length === 0) return { principle: null, source: "curriculum" as const };

  const [anchorRow] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "lean_curriculum_start_date"))
    .limit(1);
  const anchorMonday = mondayOf(anchorRow?.value ?? londonDateString());
  const weeks = Math.max(0, Math.round(
    (new Date(`${weekStart}T00:00:00Z`).getTime() - new Date(`${anchorMonday}T00:00:00Z`).getTime()) / (7 * 86_400_000),
  ));
  return { principle: rotation[weeks % rotation.length], source: "curriculum" as const };
}

/** Picks today's default lesson — WEEKLY focus, daily variety.
 *  One principle is the theme for the whole week (Mon–Sun): either the
 *  host's explicit pick for that week (lean_week_focus — "next week we're
 *  doing Leave It Better Than You Found It") or the curriculum walked one
 *  principle per week from the anchor. Within the week, the principle's
 *  examples rotate by weekday so a rich theme still varies day to day —
 *  this deliberately replaces the every-example-daily rotation (which
 *  changed topic every morning) while avoiding the older repeat problem
 *  by cycling examples inside the theme. Host can still override a single
 *  day on the meeting slide via configJson.exampleId / the library picker. */
async function getTodayPrincipleAndExample(forDateIso?: string) {
  const todayIso = forDateIso ?? londonDateString();
  const weekStart = mondayOf(todayIso);
  const { principle } = await getWeekFocusPrinciple(weekStart);
  if (!principle) return { principle: null, example: null };

  const examples = await db
    .select()
    .from(leanExamplesTable)
    .where(and(eq(leanExamplesTable.principleId, principle.id), eq(leanExamplesTable.isActive, true)))
    .orderBy(asc(leanExamplesTable.orderPosition));
  if (examples.length === 0) return { principle, example: null };

  const dayIdx = (new Date(`${todayIso}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon=0
  return { principle, example: examples[dayIdx % examples.length] };
}

/** Backwards-compat shim — returns the legacy lean_lessons-shaped row
 *  the dashboard already exposes. New code reads principle/example
 *  directly. */
async function getTodayLessonLegacy(forDateIso?: string) {
  const { principle, example } = await getTodayPrincipleAndExample(forDateIso);
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
    diagram: example.diagram ?? null,
    imageUrl: example.imageUrl ?? null,
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

// ── "Who's On Today" — station assignments from the Planday rota ──────────
// Maps rota positions onto planner stations via the editable
// station_assignments_mapping setting; unmapped positions land in an
// "extras" footer so nobody disappears from the slide. Self-contained
// endpoint (not part of /dashboard) because Planday costs a few round
// trips — the slide fetches it lazily with its own spinner.
router.get("/station-assignments", async (req: Request, res: Response) => {
  const dateStr = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

  try {
    const { isPlandayConfigured, getPlandayShifts, getPlandayEmployees, getPlandayPositions } = await import("../services/planday");
    if (!isPlandayConfigured()) {
      res.json({ available: false, reason: "Planday is not configured on this server.", date: dateStr, stations: [], extras: [] });
      return;
    }

    const [shifts, employees, positions] = await Promise.all([
      getPlandayShifts(dateStr, dateStr),
      getPlandayEmployees(),
      getPlandayPositions(),
    ]);

    const empById = new Map(employees.map(e => [e.id, e]));
    const posById = new Map(positions.map(p => [p.id, p]));

    // Mapping: { stations: [{ title, positions: string[], hideWhenEmpty? }] }
    let mapping: { stations: Array<{ title: string; positions: string[]; hideWhenEmpty?: boolean }> } = { stations: [] };
    const [mapRow] = await db.select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "station_assignments_mapping"));
    try {
      if (mapRow?.value) mapping = JSON.parse(mapRow.value);
    } catch { /* fall through with empty mapping — everything lands in extras */ }

    const positionToStation = new Map<string, string>();
    for (const st of mapping.stations ?? []) {
      for (const p of st.positions ?? []) positionToStation.set(p.trim().toLowerCase(), st.title);
    }

    type Person = { name: string; start: string | null; end: string | null; position: string };
    const byStation = new Map<string, Person[]>();
    const extras: Person[] = [];

    for (const s of shifts) {
      const emp = s.employeeId != null ? empById.get(s.employeeId) : undefined;
      const posName = s.positionId != null ? (posById.get(s.positionId)?.name ?? null) : null;
      const person: Person = {
        name: emp ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() || "Unassigned" : "Unassigned",
        start: s.startDateTime?.slice(11, 16) ?? null,
        end: s.endDateTime?.slice(11, 16) ?? null,
        position: posName ?? "No position",
      };
      const station = posName ? positionToStation.get(posName.trim().toLowerCase()) : undefined;
      if (station) {
        if (!byStation.has(station)) byStation.set(station, []);
        byStation.get(station)!.push(person);
      } else {
        extras.push(person);
      }
    }

    const stations = (mapping.stations ?? [])
      .map(st => ({
        title: st.title,
        people: (byStation.get(st.title) ?? []).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")),
        hideWhenEmpty: !!st.hideWhenEmpty,
      }))
      .filter(st => st.people.length > 0 || !st.hideWhenEmpty);

    extras.sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

    res.json({ available: true, date: dateStr, stations, extras });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[morning-meetings] station-assignments error:", msg);
    res.json({ available: false, reason: "Could not reach Planday.", date: dateStr, stations: [], extras: [] });
  }
});

router.get("/dashboard", async (_req: Request, res: Response) => {
  try {
    const today = londonDateString();
    // "Yesterday's numbers" should mean the previous PRODUCTION day, not the
    // previous calendar day — so on Monday we show Friday, on Friday Thursday,
    // and bank holidays are skipped (Mon-Fri minus non-dispatch dates).
    const yesterday = await getPreviousDispatchDayAsync(today);
    const tomorrow = isoDateMinusDays(today, -1);

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
    let todayPlanItems: Array<{ recipeId: number; recipeName: string; recipeColor: string | null; batchesTarget: number; recipeCategory: string | null; eightPackBagCount: number }> = [];
    if (todayPlan) {
      todayPlanItems = await db
        .select({
          recipeId: productionPlanItemsTable.recipeId,
          recipeName: recipesTable.name,
          recipeColor: recipesTable.color,
          batchesTarget: productionPlanItemsTable.batchesTarget,
          recipeCategory: recipesTable.category,
          eightPackBagCount: productionPlanItemsTable.eightPackBagCount,
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

      for (const it of items) {
        wonkyCount += it.wonlyTotal ?? 0;
        shortCount += it.shortCount ?? 0;
        leftoverFillingGrams += it.leftoverFillingGrams ?? 0;
        yesterdayBatchesTotal += it.batchesTarget ?? 0;
      }
    }

    // Yesterday's builder + packing rates come from the same helpers
    // /api/reports/production-kpis and /api/reports/packing-speed use,
    // so the meeting reports the same numbers operators see on the
    // Analytics page. Previously the meeting did simpler raw-wallclock
    // maths (no break subtraction) for building, and read local
    // batch_completions for packing — which is empty because packing
    // is logged via Shopify fulfilment timestamps, not locally.
    const [builderKpi, packingKpi] = await Promise.all([
      computeBuilderBatchesPerHourForDay(yesterday).catch(err => {
        console.warn("[morning-meeting] builder BPH calc failed:", err);
        return { totalBatches: 0, activeMinutes: 0, batchesPerHour: null };
      }),
      computePackingOrdersPerHourForDay(yesterday).catch(err => {
        console.warn("[morning-meeting] packing orders/hr calc failed:", err);
        return { totalOrders: 0, activeMinutes: 0, ordersPerHour: null };
      }),
    ]);
    builderBatchesPerHour = builderKpi.batchesPerHour;
    packingBatchesPerHour = packingKpi.ordersPerHour;

    // ── Tomorrow's non-core production (Test Product Prep slide) ────
    // Anything on tomorrow's plan that isn't a core menu item needs
    // attention today — test boxes, one-off specials, R&D batches.
    // Core items are routine and don't need calling out in the
    // morning huddle.
    const [tomorrowPlan] = await db
      .select({ id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.planDate, tomorrow))
      .limit(1);
    let tomorrowNonCoreItems: Array<{ recipeId: number; recipeName: string; recipeColor: string | null; batchesTarget: number; recipeCategory: string | null }> = [];
    if (tomorrowPlan) {
      tomorrowNonCoreItems = await db
        .select({
          recipeId: productionPlanItemsTable.recipeId,
          recipeName: recipesTable.name,
          recipeColor: recipesTable.color,
          batchesTarget: productionPlanItemsTable.batchesTarget,
          recipeCategory: recipesTable.category,
        })
        .from(productionPlanItemsTable)
        .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
        .where(and(
          eq(productionPlanItemsTable.planId, tomorrowPlan.id),
          eq(recipesTable.isCoreMenu, false),
        ))
        .orderBy(productionPlanItemsTable.orderPosition);
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

    // ── Improvements required (open improvements — ideas + struggles are
    //    now one concept; two-status model means open = not complete) ───
    const improvementsRequired = await db
      .select({
        id: improvementSubmissionsTable.id,
        title: improvementSubmissionsTable.title,
        description: improvementSubmissionsTable.description,
        assignedToName: improvementSubmissionsTable.assignedToName,
        createdAt: improvementSubmissionsTable.createdAt,
      })
      .from(improvementSubmissionsTable)
      .where(notInArray(improvementSubmissionsTable.progressStatus, ["complete"]))
      .orderBy(desc(improvementSubmissionsTable.createdAt))
      .limit(10);

    // ── Recently completed improvements (for the "Recent Improvements"
    //    meeting slide). Newest completions first. ─────────────────────
    const recentImprovements = await db
      .select({
        id: improvementSubmissionsTable.id,
        title: improvementSubmissionsTable.title,
        description: improvementSubmissionsTable.description,
        updatedAt: improvementSubmissionsTable.updatedAt,
      })
      .from(improvementSubmissionsTable)
      .where(eq(improvementSubmissionsTable.progressStatus, "complete"))
      .orderBy(desc(improvementSubmissionsTable.updatedAt))
      .limit(8);

    // ── SOPs updated in the last 7 days ────────────────────────────
    // Reads from the new standards_sops table (the Standards & SOPs
    // dialog writes here). The legacy risk_assessments table still
    // exists but is no longer authored against, so checking it here
    // missed every new SOP.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSops = await db.execute<{ id: number; title: string; updated_at: Date }>(sql`
      SELECT id, title, updated_at
      FROM standards_sops
      WHERE updated_at >= ${sevenDaysAgo.toISOString()}
      ORDER BY updated_at DESC
      LIMIT 20
    `);

    // ── Today's lean lesson — picks this week's principle + today's
    //    example by default, but honors the per-meeting exampleId
    //    override so the host can swap to a different example from the
    //    Lesson slide without changing tomorrow's auto-rotation ──────
    let lesson = await getTodayLessonLegacy();
    const [maybeMeetingForLesson] = await db
      .select({ exampleId: morningMeetingsTable.exampleId })
      .from(morningMeetingsTable)
      .where(eq(morningMeetingsTable.meetingDate, today))
      .limit(1);
    if (maybeMeetingForLesson?.exampleId) {
      const [override] = await db
        .select({
          id: leanExamplesTable.id,
          title: leanExamplesTable.title,
          summary: leanExamplesTable.summary,
          explanationMd: leanExamplesTable.explanationMd,
          whatToShowMd: leanExamplesTable.whatToShowMd,
          deliveryNotesMd: leanExamplesTable.deliveryNotesMd,
          videoUrl: leanExamplesTable.videoUrl,
          diagram: leanExamplesTable.diagram,
          imageUrl: leanExamplesTable.imageUrl,
          principleId: leanExamplesTable.principleId,
          principleTitle: leanPrinciplesTable.title,
          weekPosition: leanPrinciplesTable.weekPosition,
        })
        .from(leanExamplesTable)
        .innerJoin(leanPrinciplesTable, eq(leanPrinciplesTable.id, leanExamplesTable.principleId))
        .where(eq(leanExamplesTable.id, maybeMeetingForLesson.exampleId))
        .limit(1);
      if (override) {
        lesson = {
          id: override.id,
          weekNumber: override.weekPosition,
          title: override.title,
          summary: override.summary,
          explanationMd: override.explanationMd,
          whatToShowMd: override.whatToShowMd,
          deliveryNotesMd: override.deliveryNotesMd,
          videoUrl: override.videoUrl,
          diagram: override.diagram ?? null,
          imageUrl: override.imageUrl ?? null,
          principleId: override.principleId,
          principleTitle: override.principleTitle,
        };
      }
    }

    // ── Existing meeting record + its slide list. Slides live in DB
    //    now; the runner reads from `slides` instead of a hardcoded
    //    array. Auto-clone the default template the first time anyone
    //    interacts with today's meeting (handled by /start), so by the
    //    time the slideshow opens this list is always populated ────
    // Select explicit columns (NOT the gratitude_photo bytea) so the heavy
    // dashboard poll never drags the image bytes along. The slide loads the
    // photo lazily from its own streaming endpoint when hasGratitudePhoto.
    const [meeting] = await db
      .select({
        id: morningMeetingsTable.id,
        hostName: morningMeetingsTable.hostName,
        lessonId: morningMeetingsTable.lessonId,
        exampleId: morningMeetingsTable.exampleId,
        startedAt: morningMeetingsTable.startedAt,
        endedAt: morningMeetingsTable.endedAt,
        gratitudeCaption: morningMeetingsTable.gratitudeCaption,
        hasGratitudePhoto: sql<boolean>`${morningMeetingsTable.gratitudePhoto} IS NOT NULL`,
      })
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
      tomorrow,
      tomorrowNonCoreItems,
      todayDeliveries,
      safetyIssues,
      improvementsRequired,
      // Back-compat alias so any cached/older client still renders.
      struggles: improvementsRequired,
      recentImprovements,
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
            gratitudeCaption: meeting.gratitudeCaption ?? null,
            hasGratitudePhoto: Boolean(meeting.hasGratitudePhoto),
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
    const { hostName, exampleId } = req.body as { hostName?: string; exampleId?: number };
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
        exampleId: exampleId ?? null,
      })
      .onConflictDoUpdate({
        target: morningMeetingsTable.meetingDate,
        set: {
          hostUserId: userId,
          hostName: resolvedName,
          exampleId: exampleId ?? null,
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

/** Upload (or replace) the gratitude-slide photo for a meeting. Multipart:
 *  `file` (image) required, `caption` (text) optional. Stored inline as bytea
 *  on the meeting row, so it's naturally per-day. */
router.post("/:id/gratitude-photo", photoUpload.single("file"), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid meeting id" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  const mime = req.file.mimetype;
  if (!GRATITUDE_IMAGE_MIMES.includes(mime)) {
    res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, WebP, GIF or HEIC." });
    return;
  }
  // multer already caps at 10MB, but guard explicitly in case the limit ever changes.
  if (req.file.size > 10 * 1024 * 1024) { res.status(400).json({ error: "Image too large (max 10MB)." }); return; }
  const captionRaw = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
  const caption = captionRaw.length > 0 ? captionRaw.slice(0, 300) : null;
  const [row] = await db
    .update(morningMeetingsTable)
    .set({ gratitudePhoto: req.file.buffer, gratitudePhotoMime: mime, gratitudeCaption: caption })
    .where(eq(morningMeetingsTable.id, id))
    .returning({ id: morningMeetingsTable.id });
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.status(201).json({ ok: true, hasGratitudePhoto: true, gratitudeCaption: caption });
});

/** Update just the caption (without re-uploading the photo). */
router.patch("/:id/gratitude-caption", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid meeting id" }); return; }
  const captionRaw = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
  const caption = captionRaw.length > 0 ? captionRaw.slice(0, 300) : null;
  const [row] = await db
    .update(morningMeetingsTable)
    .set({ gratitudeCaption: caption })
    .where(eq(morningMeetingsTable.id, id))
    .returning({ id: morningMeetingsTable.id });
  if (!row) { res.status(404).json({ error: "Meeting not found" }); return; }
  res.json({ ok: true, gratitudeCaption: caption });
});

/** Remove the gratitude photo + caption — reverts the slide to the live
 *  themed fallback image. */
router.delete("/:id/gratitude-photo", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid meeting id" }); return; }
  await db
    .update(morningMeetingsTable)
    .set({ gratitudePhoto: null, gratitudePhotoMime: null, gratitudeCaption: null })
    .where(eq(morningMeetingsTable.id, id));
  res.json({ ok: true, hasGratitudePhoto: false });
});

/** Stream the gratitude photo bytes for a meeting. 404 when none uploaded. */
router.get("/:id/gratitude-photo", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid meeting id" }); return; }
  const [row] = await db
    .select({ photo: morningMeetingsTable.gratitudePhoto, mime: morningMeetingsTable.gratitudePhotoMime })
    .from(morningMeetingsTable)
    .where(eq(morningMeetingsTable.id, id))
    .limit(1);
  if (!row || !row.photo) { res.status(404).json({ error: "No photo" }); return; }
  res.setHeader("Content-Type", row.mime ?? "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(row.photo);
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

// ── Weekly focus ────────────────────────────────────────────────────
// GET  /lessons/week-plan   — this week + next week's focus and options
// PUT  /lessons/week-focus  — pin (or clear) a week's principle
router.get("/lessons/week-plan", async (_req: Request, res: Response) => {
  const thisMonday = mondayOf(londonDateString());
  const nextMonday = mondayOf(new Date(new Date(`${thisMonday}T00:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10));

  const [thisWeek, nextWeek, principles] = await Promise.all([
    getWeekFocusPrinciple(thisMonday),
    getWeekFocusPrinciple(nextMonday),
    db.select({ id: leanPrinciplesTable.id, title: leanPrinciplesTable.title, weekPosition: leanPrinciplesTable.weekPosition, isActive: leanPrinciplesTable.isActive })
      .from(leanPrinciplesTable)
      .orderBy(asc(leanPrinciplesTable.weekPosition)),
  ]);

  res.json({
    thisWeek: { weekStart: thisMonday, principle: thisWeek.principle ? { id: thisWeek.principle.id, title: thisWeek.principle.title } : null, source: thisWeek.source },
    nextWeek: { weekStart: nextMonday, principle: nextWeek.principle ? { id: nextWeek.principle.id, title: nextWeek.principle.title } : null, source: nextWeek.source },
    principles: principles.filter(p => p.isActive && p.title !== ON_DEMAND_PRINCIPLE_TITLE),
  });
});

router.put("/lessons/week-focus", async (req: Request, res: Response) => {
  const body = req.body as { weekStart?: string; principleId?: number | null };
  if (!body.weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
    res.status(400).json({ error: "weekStart (YYYY-MM-DD) required" });
    return;
  }
  const weekStart = mondayOf(body.weekStart);
  if (body.principleId == null) {
    await db.execute(sql`DELETE FROM lean_week_focus WHERE week_start = ${weekStart}`);
    res.json({ ok: true, weekStart, cleared: true });
    return;
  }
  const [p] = await db.select({ id: leanPrinciplesTable.id }).from(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, body.principleId));
  if (!p) { res.status(404).json({ error: "Principle not found" }); return; }
  await db.execute(sql`
    INSERT INTO lean_week_focus (week_start, principle_id) VALUES (${weekStart}, ${body.principleId})
    ON CONFLICT (week_start) DO UPDATE SET principle_id = ${body.principleId}
  `);
  res.json({ ok: true, weekStart, principleId: body.principleId });
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

// ── AI lesson generation ────────────────────────────────────────────
// The host types a topic on the Lesson slide ("total ownership as in
// Lean Made Simple by Ryan Tierney") and we generate a full three-block
// lesson in the house style, save it as a permanent example under the
// catch-all "On-demand lessons" principle (so it joins the daily
// rotation + library picker forever), and return it shaped like the
// dashboard lesson so the slide can switch to it immediately.

const LESSON_TOOL: Anthropic.Tool = {
  name: "emit_lesson",
  description: "Return the finished lean lesson in the required three-block format.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short lesson title, e.g. 'Total Ownership'. No week number." },
      summary: { type: "string", description: "One punchy sentence capturing the core idea." },
      explanationMd: { type: "string", description: "Markdown for 'what it means' — host prep. 2-4 short paragraphs, **bold** the key term. No headings." },
      whatToShowMd: { type: "string", description: "Markdown for the slide the team sees: a short **bold heading**, 3-5 tight bullets or a small table, then a line starting '**Today's question:**' or '**Today:**'. No headings (#)." },
      deliveryNotesMd: { type: "string", description: "Markdown: a '**Talking points:**' list of 2-3 bullets, then a final line starting '**Prompt:**' with a question to ask the room." },
    },
    required: ["title", "summary", "explanationMd", "whatToShowMd", "deliveryNotesMd"],
  },
};

const LESSON_SYSTEM = `You write daily "lean lesson" cards for the morning stand-up at The Calzone Kitchen, a UK artisan food business that makes calzones and macaroni cheese. The team practises Two Second Lean (Paul Akers) and their primary lean text is Lean Made Simple by Ryan Tierney — the whole team learned lean through this book, so terminology consistency with it is non-negotiable.

${leanCorpusPrompt()}

Write ONE lesson on the topic the user gives you, in this exact house style:
- Keep it short — the whole thing is read aloud in 2-3 minutes.
- Never use H1/H2 markdown headings (#). Use **bold** and bullet lists only.

Return the lesson by calling the emit_lesson tool. Do not write anything outside the tool call.`;

router.post("/lessons/generate", async (req: Request, res: Response) => {
  if (!isClaudeConfigured()) {
    res.status(503).json({ error: "AI is not configured (missing ANTHROPIC_API_KEY)." });
    return;
  }
  const { topic } = req.body as { topic?: string };
  if (!topic || !topic.trim()) {
    res.status(400).json({ error: "A topic is required." });
    return;
  }

  try {
    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 2048,
      system: LESSON_SYSTEM,
      tools: [LESSON_TOOL],
      tool_choice: { type: "tool", name: "emit_lesson" },
      messages: [{ role: "user", content: `Topic: ${topic.trim()}` }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_lesson",
    );
    if (!toolUse) {
      res.status(502).json({ error: "The AI didn't return a lesson. Try rephrasing the topic." });
      return;
    }
    const gen = toolUse.input as {
      title: string; summary: string; explanationMd: string;
      whatToShowMd: string; deliveryNotesMd: string;
    };

    // Find or create the catch-all "On-demand lessons" principle, placed
    // at the end of the week order so it never displaces the curriculum.
    let [principle] = await db
      .select()
      .from(leanPrinciplesTable)
      .where(eq(leanPrinciplesTable.title, ON_DEMAND_PRINCIPLE_TITLE))
      .limit(1);
    if (!principle) {
      const [lastPrinciple] = await db
        .select({ wp: leanPrinciplesTable.weekPosition })
        .from(leanPrinciplesTable)
        .orderBy(desc(leanPrinciplesTable.weekPosition))
        .limit(1);
      [principle] = await db
        .insert(leanPrinciplesTable)
        .values({
          weekPosition: (lastPrinciple?.wp ?? 0) + 1,
          title: ON_DEMAND_PRINCIPLE_TITLE,
          summary: "Lessons generated on demand by the host. Each one joins the daily rotation.",
          isActive: true,
        })
        .returning();
    }

    const [lastExample] = await db
      .select({ op: leanExamplesTable.orderPosition })
      .from(leanExamplesTable)
      .where(eq(leanExamplesTable.principleId, principle.id))
      .orderBy(desc(leanExamplesTable.orderPosition))
      .limit(1);
    const [example] = await db
      .insert(leanExamplesTable)
      .values({
        principleId: principle.id,
        orderPosition: (lastExample?.op ?? -1) + 1,
        title: gen.title,
        summary: gen.summary,
        explanationMd: gen.explanationMd,
        whatToShowMd: gen.whatToShowMd,
        deliveryNotesMd: gen.deliveryNotesMd,
        isActive: true,
      })
      .returning();

    res.status(201).json({
      id: example.id,
      weekNumber: principle.weekPosition,
      title: example.title,
      summary: example.summary,
      explanationMd: example.explanationMd,
      whatToShowMd: example.whatToShowMd,
      deliveryNotesMd: example.deliveryNotesMd,
      videoUrl: example.videoUrl,
      diagram: example.diagram ?? null,
      imageUrl: example.imageUrl ?? null,
      principleId: principle.id,
      principleTitle: principle.title,
    });
  } catch (err) {
    console.error("[morning-meetings] lesson generate failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Lesson generation failed: ${message}` });
  }
});

// ── Meeting slide CRUD ──────────────────────────────────────────────
// All slide edits go through the same endpoints whether the host is
// editing today's meeting or the master template (templateId vs
// meetingId in the URL). Reordering is bulk to avoid the N+1 round
// trip from a drag-and-drop.

router.get("/:id/slides", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid meeting id" }); return; }
  const rows = await fetchMeetingSlides(id);
  res.json(rows);
});

router.post("/:id/slides", async (req: Request, res: Response) => {
  const meetingId = Number(req.params.id);
  const { kind, title, contentMd, configJson, afterSlideId } = req.body as {
    kind: string;
    title: string;
    contentMd?: string | null;
    configJson?: Record<string, unknown> | null;
    afterSlideId?: number;
  };
  if (!meetingId || !kind || !title) { res.status(400).json({ error: "kind and title are required" }); return; }

  // Insert after the named slide, otherwise at the end. Renumber all
  // following rows to leave room.
  const existing = await db
    .select({ id: meetingSlidesTable.id, orderPosition: meetingSlidesTable.orderPosition })
    .from(meetingSlidesTable)
    .where(eq(meetingSlidesTable.meetingId, meetingId))
    .orderBy(asc(meetingSlidesTable.orderPosition));
  let insertAt = existing.length;
  if (afterSlideId) {
    const idx = existing.findIndex(s => s.id === afterSlideId);
    if (idx >= 0) insertAt = idx + 1;
  }
  // Shift down
  for (let i = insertAt; i < existing.length; i++) {
    await db.update(meetingSlidesTable)
      .set({ orderPosition: i + 1 })
      .where(eq(meetingSlidesTable.id, existing[i].id));
  }
  const [row] = await db.insert(meetingSlidesTable).values({
    meetingId,
    kind,
    title,
    orderPosition: insertAt,
    contentMd: contentMd ?? null,
    configJson: configJson ?? null,
  }).returning();
  res.status(201).json(row);
});

router.put("/slides/:slideId", async (req: Request, res: Response) => {
  const slideId = Number(req.params.slideId);
  const body = req.body as Partial<{
    title: string;
    contentMd: string | null;
    configJson: Record<string, unknown> | null;
  }>;
  const [updated] = await db.update(meetingSlidesTable)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.contentMd !== undefined ? { contentMd: body.contentMd } : {}),
      ...(body.configJson !== undefined ? { configJson: body.configJson } : {}),
      updatedAt: new Date(),
    })
    .where(eq(meetingSlidesTable.id, slideId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Slide not found" }); return; }
  res.json(updated);
});

router.delete("/slides/:slideId", async (req: Request, res: Response) => {
  const slideId = Number(req.params.slideId);
  await db.delete(meetingSlidesTable).where(eq(meetingSlidesTable.id, slideId));
  res.json({ ok: true });
});

/** Reorder slides in one shot — body is `{ order: [{id, orderPosition}, ...] }`.
 *  Atomic; runs in a transaction so the slideshow never flashes a
 *  half-reordered state. */
router.put("/:id/slides/reorder", async (req: Request, res: Response) => {
  const meetingId = Number(req.params.id);
  const { order } = req.body as { order: Array<{ id: number; orderPosition: number }> };
  if (!meetingId || !Array.isArray(order)) { res.status(400).json({ error: "order required" }); return; }
  await db.transaction(async (tx) => {
    for (const o of order) {
      await tx.update(meetingSlidesTable)
        .set({ orderPosition: o.orderPosition })
        .where(and(eq(meetingSlidesTable.id, o.id), eq(meetingSlidesTable.meetingId, meetingId)));
    }
  });
  res.json({ ok: true });
});

// ── Template slide CRUD (same shape, different table) ───────────────

router.get("/templates", async (_req: Request, res: Response) => {
  const rows = await db.select().from(meetingTemplatesTable).orderBy(asc(meetingTemplatesTable.id));
  res.json(rows);
});

router.get("/templates/:id/slides", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(templateSlidesTable)
    .where(eq(templateSlidesTable.templateId, id))
    .orderBy(asc(templateSlidesTable.orderPosition));
  res.json(rows);
});

router.post("/templates/:id/slides", async (req: Request, res: Response) => {
  const templateId = Number(req.params.id);
  const { kind, title, contentMd, configJson, afterSlideId } = req.body as {
    kind: string;
    title: string;
    contentMd?: string | null;
    configJson?: Record<string, unknown> | null;
    afterSlideId?: number;
  };
  if (!templateId || !kind || !title) { res.status(400).json({ error: "kind and title are required" }); return; }
  const existing = await db
    .select({ id: templateSlidesTable.id, orderPosition: templateSlidesTable.orderPosition })
    .from(templateSlidesTable)
    .where(eq(templateSlidesTable.templateId, templateId))
    .orderBy(asc(templateSlidesTable.orderPosition));
  let insertAt = existing.length;
  if (afterSlideId) {
    const idx = existing.findIndex(s => s.id === afterSlideId);
    if (idx >= 0) insertAt = idx + 1;
  }
  for (let i = insertAt; i < existing.length; i++) {
    await db.update(templateSlidesTable)
      .set({ orderPosition: i + 1 })
      .where(eq(templateSlidesTable.id, existing[i].id));
  }
  const [row] = await db.insert(templateSlidesTable).values({
    templateId,
    kind,
    title,
    orderPosition: insertAt,
    contentMd: contentMd ?? null,
    configJson: configJson ?? null,
  }).returning();
  res.status(201).json(row);
});

router.put("/template-slides/:slideId", async (req: Request, res: Response) => {
  const slideId = Number(req.params.slideId);
  const body = req.body as Partial<{
    title: string;
    contentMd: string | null;
    configJson: Record<string, unknown> | null;
  }>;
  const [updated] = await db.update(templateSlidesTable)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.contentMd !== undefined ? { contentMd: body.contentMd } : {}),
      ...(body.configJson !== undefined ? { configJson: body.configJson } : {}),
      updatedAt: new Date(),
    })
    .where(eq(templateSlidesTable.id, slideId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Slide not found" }); return; }
  res.json(updated);
});

router.delete("/template-slides/:slideId", async (req: Request, res: Response) => {
  const slideId = Number(req.params.slideId);
  await db.delete(templateSlidesTable).where(eq(templateSlidesTable.id, slideId));
  res.json({ ok: true });
});

router.put("/templates/:id/slides/reorder", async (req: Request, res: Response) => {
  const templateId = Number(req.params.id);
  const { order } = req.body as { order: Array<{ id: number; orderPosition: number }> };
  if (!templateId || !Array.isArray(order)) { res.status(400).json({ error: "order required" }); return; }
  await db.transaction(async (tx) => {
    for (const o of order) {
      await tx.update(templateSlidesTable)
        .set({ orderPosition: o.orderPosition })
        .where(and(eq(templateSlidesTable.id, o.id), eq(templateSlidesTable.templateId, templateId)));
    }
  });
  res.json({ ok: true });
});

/** Schedule a meeting for a specific future date. Clones the default
 *  template's slides immediately so the host can pre-edit. If a
 *  meeting already exists for that date, returns it unchanged.
 *  Body: { meetingDate: 'YYYY-MM-DD', hostName?: string } */
router.post("/schedule", async (req: Request, res: Response) => {
  const { meetingDate, hostName } = req.body as { meetingDate: string; hostName?: string };
  if (!meetingDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    res.status(400).json({ error: "meetingDate (YYYY-MM-DD) is required" });
    return;
  }
  const userId = (req.session as any)?.userId ?? null;
  const [row] = await db
    .insert(morningMeetingsTable)
    .values({
      meetingDate,
      hostUserId: userId,
      hostName: hostName?.trim() ?? null,
    })
    .onConflictDoNothing()
    .returning();
  let meetingId: number;
  if (row) {
    meetingId = row.id;
  } else {
    const [existing] = await db
      .select({ id: morningMeetingsTable.id })
      .from(morningMeetingsTable)
      .where(eq(morningMeetingsTable.meetingDate, meetingDate));
    meetingId = existing!.id;
  }
  await cloneTemplateSlidesIfEmpty(meetingId);
  res.json({ id: meetingId, meetingDate });
});

// What a host can set up ahead of time for a given day: the gratitude
// photo and the lean lesson. Deliberately narrow — the full dashboard is
// a snapshot of today's live numbers and can't be projected forward, so
// this returns only the two things that genuinely are per-day settings.
// Read-only: meetingId comes back null until something is actually saved,
// at which point the client calls /schedule to create the row.
router.get("/day-setup", async (req: Request, res: Response) => {
  const date = String(req.query.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
    return;
  }
  try {
    const [meeting] = await db
      .select({
        id: morningMeetingsTable.id,
        exampleId: morningMeetingsTable.exampleId,
        gratitudeCaption: morningMeetingsTable.gratitudeCaption,
        hasGratitudePhoto: sql<boolean>`${morningMeetingsTable.gratitudePhoto} IS NOT NULL`,
      })
      .from(morningMeetingsTable)
      .where(eq(morningMeetingsTable.meetingDate, date))
      .limit(1);

    // The rotation's pick for that date, then the host's override if set.
    const defaultLesson = await getTodayLessonLegacy(date);
    let lesson = defaultLesson;
    if (meeting?.exampleId) {
      const [override] = await db
        .select({
          id: leanExamplesTable.id,
          title: leanExamplesTable.title,
          summary: leanExamplesTable.summary,
          principleTitle: leanPrinciplesTable.title,
          weekPosition: leanPrinciplesTable.weekPosition,
        })
        .from(leanExamplesTable)
        .innerJoin(leanPrinciplesTable, eq(leanPrinciplesTable.id, leanExamplesTable.principleId))
        .where(eq(leanExamplesTable.id, meeting.exampleId))
        .limit(1);
      if (override) {
        lesson = {
          ...(defaultLesson ?? {}),
          id: override.id,
          weekNumber: override.weekPosition,
          title: override.title,
          summary: override.summary,
          principleTitle: override.principleTitle,
        } as typeof defaultLesson;
      }
    }

    res.json({
      meetingDate: date,
      meetingId: meeting?.id ?? null,
      hasGratitudePhoto: meeting?.hasGratitudePhoto ?? false,
      gratitudeCaption: meeting?.gratitudeCaption ?? null,
      exampleId: meeting?.exampleId ?? null,
      isLessonOverridden: meeting?.exampleId != null,
      lesson,
      defaultLessonTitle: defaultLesson?.title ?? null,
    });
  } catch (err) {
    console.error("[morning-meetings] day-setup failed:", err);
    res.status(500).json({ error: "Failed to load day setup" });
  }
});

// ── Curriculum admin: principles + examples ─────────────────────────

router.get("/principles", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(leanPrinciplesTable)
    .orderBy(asc(leanPrinciplesTable.weekPosition));
  res.json(rows);
});

router.get("/principles/today", async (_req: Request, res: Response) => {
  const { principle, example } = await getTodayPrincipleAndExample();
  res.json({ principle, example });
});

router.post("/principles", async (req: Request, res: Response) => {
  const body = req.body as { title: string; summary: string; weekPosition?: number };
  if (!body.title || !body.summary) {
    res.status(400).json({ error: "title and summary are required" });
    return;
  }
  // If no weekPosition given, place at the end.
  let weekPosition = body.weekPosition;
  if (!weekPosition) {
    const [last] = await db
      .select({ wp: leanPrinciplesTable.weekPosition })
      .from(leanPrinciplesTable)
      .orderBy(desc(leanPrinciplesTable.weekPosition))
      .limit(1);
    weekPosition = (last?.wp ?? 0) + 1;
  }
  const [row] = await db
    .insert(leanPrinciplesTable)
    .values({ weekPosition, title: body.title, summary: body.summary, isActive: true })
    .returning();
  res.status(201).json(row);
});

router.put("/principles/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Partial<{ title: string; summary: string; isActive: boolean; weekPosition: number }>;
  const [updated] = await db
    .update(leanPrinciplesTable)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.weekPosition !== undefined ? { weekPosition: body.weekPosition } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leanPrinciplesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Principle not found" }); return; }
  res.json(updated);
});

router.delete("/principles/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.delete(leanPrinciplesTable).where(eq(leanPrinciplesTable.id, id));
  res.json({ ok: true });
});

// All active examples across every active principle — powers the
// "Shuffle" control on the Lesson slide (pick any lesson, any week).
router.get("/examples", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: leanExamplesTable.id,
      title: leanExamplesTable.title,
      summary: leanExamplesTable.summary,
      principleId: leanExamplesTable.principleId,
      principleTitle: leanPrinciplesTable.title,
      weekPosition: leanPrinciplesTable.weekPosition,
    })
    .from(leanExamplesTable)
    .innerJoin(leanPrinciplesTable, eq(leanPrinciplesTable.id, leanExamplesTable.principleId))
    .where(and(eq(leanExamplesTable.isActive, true), eq(leanPrinciplesTable.isActive, true)))
    .orderBy(asc(leanPrinciplesTable.weekPosition), asc(leanExamplesTable.orderPosition));
  res.json(rows);
});

router.get("/principles/:id/examples", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(leanExamplesTable)
    .where(eq(leanExamplesTable.principleId, id))
    .orderBy(asc(leanExamplesTable.orderPosition));
  res.json(rows);
});

router.post("/principles/:id/examples", async (req: Request, res: Response) => {
  const principleId = Number(req.params.id);
  const body = req.body as Partial<{
    title: string; summary: string; explanationMd: string; whatToShowMd: string;
    deliveryNotesMd: string; videoUrl: string | null; diagram: string | null; imageUrl: string | null;
  }>;
  if (!body.title || !body.summary) { res.status(400).json({ error: "title and summary are required" }); return; }
  const [last] = await db
    .select({ op: leanExamplesTable.orderPosition })
    .from(leanExamplesTable)
    .where(eq(leanExamplesTable.principleId, principleId))
    .orderBy(desc(leanExamplesTable.orderPosition))
    .limit(1);
  const nextPos = (last?.op ?? -1) + 1;
  const [row] = await db
    .insert(leanExamplesTable)
    .values({
      principleId,
      orderPosition: nextPos,
      title: body.title,
      summary: body.summary,
      explanationMd: body.explanationMd ?? "",
      whatToShowMd: body.whatToShowMd ?? "",
      deliveryNotesMd: body.deliveryNotesMd ?? "",
      videoUrl: body.videoUrl ?? null,
      diagram: body.diagram ?? null,
      imageUrl: body.imageUrl ?? null,
      isActive: true,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/examples/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Partial<{
    title: string; summary: string; explanationMd: string; whatToShowMd: string;
    deliveryNotesMd: string; videoUrl: string | null; diagram: string | null; imageUrl: string | null;
    isActive: boolean; orderPosition: number;
  }>;
  const [updated] = await db
    .update(leanExamplesTable)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.explanationMd !== undefined ? { explanationMd: body.explanationMd } : {}),
      ...(body.whatToShowMd !== undefined ? { whatToShowMd: body.whatToShowMd } : {}),
      ...(body.deliveryNotesMd !== undefined ? { deliveryNotesMd: body.deliveryNotesMd } : {}),
      ...(body.videoUrl !== undefined ? { videoUrl: body.videoUrl } : {}),
      ...(body.diagram !== undefined ? { diagram: body.diagram } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.orderPosition !== undefined ? { orderPosition: body.orderPosition } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leanExamplesTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Example not found" }); return; }
  res.json(updated);
});

router.delete("/examples/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.delete(leanExamplesTable).where(eq(leanExamplesTable.id, id));
  res.json({ ok: true });
});

/** Override the lesson example for a specific meeting — used by the
 *  host on the Lesson slide if they want to swap to a different example
 *  within the week's principle (or to a totally different principle). */
router.put("/:id/example", async (req: Request, res: Response) => {
  const meetingId = Number(req.params.id);
  const { exampleId } = req.body as { exampleId: number | null };
  await db
    .update(morningMeetingsTable)
    .set({ exampleId: exampleId ?? null })
    .where(eq(morningMeetingsTable.id, meetingId));
  res.json({ ok: true });
});

export default router;

// Silence unused-import warnings for filters that are exported but not
// used directly above (kept available for future endpoints).
void lte;
