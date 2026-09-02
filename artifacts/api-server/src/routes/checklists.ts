import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  checklistTemplatesTable,
  checklistCompletionsTable,
  checklistOneoffItemsTable,
  productionPlansTable,
  productionPlanItemsTable,
  recipesTable,
  recipeIngredientsTable,
  ingredientsTable,
  temperatureRecordsTable,
  ovenEventsTable,
  usersTable,
  fridgeStockBatchesTable,
  packingBatchRecordsTable,
  stockEntriesTable,
  storageLocationsTable,
  locationTemperatureRecordsTable,
} from "@workspace/db";
import { eq, and, or, gt, asc, desc, gte, lte, sql, isNull, inArray } from "drizzle-orm";
import * as z from "zod";
import { londonDateString, londonStartOfDay, londonEndOfDay } from "../lib/london-time";
import { LOCATION_DEFS } from "../lib/storage-location-defs";
import { computeClosingFridgeActions, addCalendarDays } from "../lib/fridge-expiry";
import { loadMinShelfDaysRules, minShelfDaysFor } from "../lib/min-shelf-days";
import { productionDateFromJulianBatch } from "../lib/julian-batch";
import { adjustFridgeStock, addRecipeFreezerStock } from "../lib/fridge-stock";
import { resolveRecipeIngredients } from "../lib/ingredient-resolver";

type ChecklistCompletion = typeof checklistCompletionsTable.$inferSelect;

const router: IRouter = Router();

// Hard-deleting a template cascades to its completion history, so a stray
// tap wipes a HACCP audit trail (this happened to the mixing AM fridge-temp
// check in July 2026). Regular deletes are soft (is_active=false, restorable);
// permanent deletion stays admin-only.
async function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin") { next(); return; }
    }
  }
  res.status(403).json({ error: "Admin access required" });
}


// Shared checklists: stations on the left share a single checklist stored
// under the canonical station on the right. Editing or viewing the alias
// transparently routes to the canonical record so a "weekly Monday" item
// added to either station shows up on both for every user.
const SHARED_CHECKLIST_STATIONS: Record<string, string> = {
  building_2: "building_1",
  dough_prep: "dough_sheeting",
  // The prep area is ONE physical station with one checklist, whichever
  // section (hub, main, bases, raw meat) it's opened from. Before 2026-07-30
  // each section had its own cloned copy, so a tick in one section didn't
  // show in the others and the team thought the checklist was undoing
  // itself. Existing templates/history were merged into 'prep' by the
  // prep_checklist_merge_v1 startup migration.
  main_prep: "prep",
  prep_bases: "prep",
  prep_meat: "prep",
};

/** Resolve to the canonical station type for checklist storage.
 *  Exported for routes that store per-station-per-plan records alongside the
 *  checklist (curiosity walks) — they must share this aliasing or building_2
 *  and the prep sections would each get their own copy. */
export function resolveChecklistStation(stationType: string): string {
  return SHARED_CHECKLIST_STATIONS[stationType] ?? stationType;
}

function getDayName(date: Date): string {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
}

/** Monday 12:00Z of the week containing the given ISO date. */
function mondayOfWeek(iso: string): Date {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function templateMatchesDay(
  template: { schedule: string; scheduleDays: string | null; scheduleAnchorDate?: string | null; createdAt?: Date | null },
  planDate: string,
): boolean {
  if (template.schedule === "daily") return true;
  const day = getDayName(new Date(`${planDate}T12:00:00Z`));
  if (template.schedule === "weekly") {
    // Weekly defaults to monday if no days specified
    const days: string[] = template.scheduleDays ? JSON.parse(template.scheduleDays) : ["monday"];
    return days.includes(day);
  }
  if (template.schedule === "specific_days") {
    if (!template.scheduleDays) return false;
    const days: string[] = JSON.parse(template.scheduleDays);
    return days.includes(day);
  }
  if (template.schedule === "periodic") {
    // Every 4 weeks (TCK runs 13 four-week periods a year): due on its
    // scheduleDays in every week that's a whole multiple of 4 weeks from
    // the anchor's week. The anchor picks which week of the period the
    // task lands, so periodic tasks can be staggered; a template without
    // an anchor cycles from its creation week.
    const days: string[] = template.scheduleDays ? JSON.parse(template.scheduleDays) : ["monday"];
    if (!days.includes(day)) return false;
    const anchorIso = template.scheduleAnchorDate
      ?? (template.createdAt ? template.createdAt.toISOString().slice(0, 10) : planDate);
    const weeks = Math.round(
      (mondayOfWeek(planDate).getTime() - mondayOfWeek(anchorIso).getTime()) / (7 * 86_400_000),
    );
    return ((weeks % 4) + 4) % 4 === 0;
  }
  return true;
}

// ─── Template CRUD (admin-only) ──────────────────────────────────────

const CreateTemplateBody = z.object({
  stationType: z.string().min(1),
  category: z.enum(["opening", "cleaning", "closing"]),
  title: z.string().min(1),
  description: z.string().nullish(),
  schedule: z.enum(["daily", "weekly", "specific_days", "periodic"]).default("daily"),
  scheduleDays: z.array(z.string()).nullish(),
  scheduleAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  orderPosition: z.number().int().optional(),
  dynamicDataType: z.string().nullish(),
});

router.get("/templates", async (req: Request, res: Response) => {
  const station = req.query.station as string | undefined;
  // Resolve aliases so the admin panel on e.g. building_2 sees the same list
  // it'll be evaluated against at runtime — without this, edits made on the
  // alias save under one stationType but render from another.
  const canonicalStation = station ? resolveChecklistStation(station) : undefined;
  const where = canonicalStation ? eq(checklistTemplatesTable.stationType, canonicalStation) : undefined;
  const rows = await db.select().from(checklistTemplatesTable)
    .where(where)
    .orderBy(asc(checklistTemplatesTable.category), asc(checklistTemplatesTable.orderPosition));
  res.json(rows);
});

router.post("/templates", async (req: Request, res: Response) => {
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const { scheduleDays, stationType, ...rest } = parsed.data;
  // Force aliased stations onto the canonical row so reads/writes can't
  // diverge. A row created from building_2 becomes a building_1 template.
  const canonicalStation = resolveChecklistStation(stationType);
  const [row] = await db.insert(checklistTemplatesTable).values({
    ...rest,
    stationType: canonicalStation,
    scheduleDays: scheduleDays ? JSON.stringify(scheduleDays) : null,
  }).returning();
  res.status(201).json(row);
});

const UpdateTemplateBody = z.object({
  category: z.enum(["opening", "cleaning", "closing"]).optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  schedule: z.enum(["daily", "weekly", "specific_days", "periodic"]).optional(),
  scheduleDays: z.array(z.string()).nullable().optional(),
  scheduleAnchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  orderPosition: z.number().int().optional(),
  dynamicDataType: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

router.put("/templates/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = UpdateTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const { scheduleDays, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };
  if (scheduleDays !== undefined) {
    updates.scheduleDays = scheduleDays ? JSON.stringify(scheduleDays) : null;
  }
  const [row] = await db.update(checklistTemplatesTable).set(updates).where(eq(checklistTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

// Soft delete: deactivate the template so it stops appearing on checklists
// but keeps its completion history (HACCP audit trail) and can be restored
// from the template manager. Any user may do this — the team manages their
// own station checklists.
router.delete("/templates/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.update(checklistTemplatesTable)
    .set({ isActive: false })
    .where(eq(checklistTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ success: true, deactivated: true });
});

// Permanent delete (admin-only): removes the template AND all its completion
// history. Only for genuine cleanup of deactivated templates.
router.delete("/templates/:id/permanent", adminOnly, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.delete(checklistTemplatesTable).where(eq(checklistTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ success: true });
});

const ReorderBody = z.object({
  order: z.array(z.object({
    id: z.number().int(),
    orderPosition: z.number().int(),
  })),
});

router.patch("/templates/reorder", async (req: Request, res: Response) => {
  const parsed = ReorderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  await db.transaction(async (tx) => {
    for (const item of parsed.data.order) {
      await tx.update(checklistTemplatesTable)
        .set({ orderPosition: item.orderPosition })
        .where(eq(checklistTemplatesTable.id, item.id));
    }
  });
  res.json({ success: true });
});

// ─── Station Checklist (merged templates + completions) ──────────────

router.get("/station/:stationType/plan/:planId", async (req: Request<{ stationType: string; planId: string }>, res: Response) => {
  const { stationType, planId: planIdStr } = req.params;
  const planId = Number(planIdStr);
  const canonicalStation = resolveChecklistStation(stationType);

  // Get the plan to know the date
  const [plan] = await db.select({ planDate: productionPlansTable.planDate, status: productionPlansTable.status })
    .from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  // Get all active templates for this station (use canonical station for shared checklists)
  const templates = await db.select().from(checklistTemplatesTable)
    .where(and(
      eq(checklistTemplatesTable.stationType, canonicalStation),
      eq(checklistTemplatesTable.isActive, true),
    ))
    .orderBy(asc(checklistTemplatesTable.category), asc(checklistTemplatesTable.orderPosition));

  // Filter by schedule/day — against TODAY's calendar day in London, not the
  // plan's production date. The dough room's screen sits on the NEXT day's
  // plan (dough is made the day before production), so plan-date matching
  // hid day-scheduled checks from the person actually in the room: a
  // Thursday check never showed on Thursday, and Sunday checks could never
  // show at all because no plan is ever dated Sunday. A check scheduled for
  // a day is due on that real day, whichever plan the station is anchored to.
  const filtered = templates.filter((t: { schedule: string; scheduleDays: string | null }) => templateMatchesDay(t, londonDateString()));

  // Get completions for this plan (use canonical station so both views see same completions)
  const completions = await db.select().from(checklistCompletionsTable)
    .where(and(
      eq(checklistCompletionsTable.planId, planId),
      eq(checklistCompletionsTable.stationType, canonicalStation),
    ));

  // Get one-off items for this plan (use canonical station for shared checklists)
  const oneoffs = await db.select().from(checklistOneoffItemsTable)
    .where(and(
      eq(checklistOneoffItemsTable.planId, planId),
      eq(checklistOneoffItemsTable.stationType, canonicalStation),
    ))
    .orderBy(asc(checklistOneoffItemsTable.category), asc(checklistOneoffItemsTable.orderPosition));

  // Build completion map
  const completionMap = new Map<number, ChecklistCompletion>(completions.map((c: ChecklistCompletion) => [c.templateId, c]));

  // Group by category
  const categories: Record<string, Array<{
    type: "template" | "oneoff";
    id: number;
    title: string;
    description: string | null;
    dynamicDataType: string | null;
    schedule: string;
    scheduleDays: string | null;
    completed: boolean;
    completedBy: string | null;
    completedAt: string | null;
    completionId: number | null;
    notes: string | null;
    skippedReason: string | null;
  }>> = {};

  for (const t of filtered) {
    const completion = completionMap.get(t.id);
    const cat = t.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({
      type: "template",
      id: t.id,
      title: t.title,
      description: t.description,
      dynamicDataType: t.dynamicDataType,
      schedule: t.schedule,
      scheduleDays: t.scheduleDays,
      completed: !!completion,
      completedBy: completion?.completedByName ?? null,
      completedAt: completion?.completedAt?.toISOString() ?? null,
      completionId: completion?.id ?? null,
      notes: completion?.notes ?? null,
      skippedReason: completion?.skippedReason ?? null,
    });
  }

  for (const o of oneoffs) {
    const cat = o.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({
      type: "oneoff",
      id: o.id,
      title: o.title,
      description: o.description,
      dynamicDataType: null,
      schedule: "oneoff",
      scheduleDays: null,
      completed: !!o.completedAt,
      completedBy: o.completedByName ?? null,
      completedAt: o.completedAt?.toISOString() ?? null,
      completionId: null,
      notes: null,
      skippedReason: o.skippedReason ?? null,
    });
  }

  // Summary counts
  const allItems = Object.values(categories).flat();
  const total = allItems.length;
  const done = allItems.filter(i => i.completed).length;

  res.json({
    planStatus: plan.status,
    categories,
    summary: { total, done },
  });
});

// ─── Completions ─────────────────────────────────────────────────────

const CompleteBody = z.object({
  templateId: z.number().int(),
  planId: z.number().int(),
  stationType: z.string().min(1),
  notes: z.string().optional(),
  skippedReason: z.string().optional(),
});

router.post("/completions", async (req: Request, res: Response) => {
  const parsed = CompleteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  // Get user name
  let userName = "Unknown";
  if (req.session.userId) {
    const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) userName = user.name;
  }

  try {
    const canonicalStation = resolveChecklistStation(parsed.data.stationType);
    const [row] = await db.insert(checklistCompletionsTable).values({
      templateId: parsed.data.templateId,
      planId: parsed.data.planId,
      stationType: canonicalStation,
      completedBy: req.session.userId ?? null,
      completedByName: userName,
      notes: parsed.data.notes,
      skippedReason: parsed.data.skippedReason ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      res.status(409).json({ error: "Already completed" });
      return;
    }
    throw err;
  }
});

router.delete("/completions/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.delete(checklistCompletionsTable).where(eq(checklistCompletionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Completion not found" }); return; }
  res.json({ success: true });
});

// HACCP reporting: list completions across a date range, joined with template
// info (title, category) so reports can show what was ticked off without
// needing a second round-trip for each row.
//
// Query params:
//   from (required): inclusive start date, YYYY-MM-DD (interpreted as UTC)
//   to   (required): inclusive end date,   YYYY-MM-DD
//   stationType (optional): filter to a single station
//   userId (optional): filter to a single user's completions (numeric)
//
// Returns an array ordered by most-recent-first, with template rows and
// one-off rows merged into a uniform shape.
router.get("/completions", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (!from || !to) {
    res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    return;
  }
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    res.status(400).json({ error: "Invalid date format" });
    return;
  }

  const stationFilter = typeof req.query.stationType === "string" ? req.query.stationType : null;
  const userIdRaw = typeof req.query.userId === "string" ? Number(req.query.userId) : null;
  const userIdFilter = userIdRaw && Number.isFinite(userIdRaw) ? userIdRaw : null;

  // Template-based completions, joined with template title/category
  const templateConds = [
    gte(checklistCompletionsTable.completedAt, fromDate),
    lte(checklistCompletionsTable.completedAt, toDate),
  ];
  if (stationFilter) templateConds.push(eq(checklistCompletionsTable.stationType, stationFilter));
  if (userIdFilter) templateConds.push(eq(checklistCompletionsTable.completedBy, userIdFilter));

  const templateRows = await db
    .select({
      id: checklistCompletionsTable.id,
      kind: sql<string>`'template'`.as("kind"),
      templateId: checklistCompletionsTable.templateId,
      planId: checklistCompletionsTable.planId,
      stationType: checklistCompletionsTable.stationType,
      category: checklistTemplatesTable.category,
      title: checklistTemplatesTable.title,
      description: checklistTemplatesTable.description,
      completedBy: checklistCompletionsTable.completedBy,
      completedByName: checklistCompletionsTable.completedByName,
      completedAt: checklistCompletionsTable.completedAt,
      notes: checklistCompletionsTable.notes,
    })
    .from(checklistCompletionsTable)
    .innerJoin(
      checklistTemplatesTable,
      eq(checklistTemplatesTable.id, checklistCompletionsTable.templateId),
    )
    .where(and(...templateConds))
    .orderBy(desc(checklistCompletionsTable.completedAt));

  // One-off items completed in the range
  const oneoffConds = [
    gte(checklistOneoffItemsTable.completedAt, fromDate),
    lte(checklistOneoffItemsTable.completedAt, toDate),
  ];
  if (stationFilter) oneoffConds.push(eq(checklistOneoffItemsTable.stationType, stationFilter));
  if (userIdFilter) oneoffConds.push(eq(checklistOneoffItemsTable.completedBy, userIdFilter));

  const oneoffRows = await db
    .select({
      id: checklistOneoffItemsTable.id,
      kind: sql<string>`'oneoff'`.as("kind"),
      templateId: sql<number | null>`NULL`.as("templateId"),
      planId: checklistOneoffItemsTable.planId,
      stationType: checklistOneoffItemsTable.stationType,
      category: checklistOneoffItemsTable.category,
      title: checklistOneoffItemsTable.title,
      description: checklistOneoffItemsTable.description,
      completedBy: checklistOneoffItemsTable.completedBy,
      completedByName: checklistOneoffItemsTable.completedByName,
      completedAt: checklistOneoffItemsTable.completedAt,
      notes: sql<string | null>`NULL`.as("notes"),
    })
    .from(checklistOneoffItemsTable)
    .where(and(...oneoffConds))
    .orderBy(desc(checklistOneoffItemsTable.completedAt));

  const merged = [...templateRows, ...oneoffRows].sort((a, b) => {
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bTime - aTime;
  });

  res.json(merged);
});

// HACCP reporting: list OUTSTANDING checklist items across a date range —
// templates that were scheduled on a calendar day the kitchen was working
// but have no matching completion, plus any one-off items that were created
// but never ticked off. Used by the Analytics → HACCP tab to surface "what
// did we miss yesterday?" for EHO compliance.
//
// Scheduling is per CALENDAR DAY, not per plan date: the dough room works
// the day before its plan's production date (Sunday's checks are done while
// prepping Monday's plan), so enumerating by plan date made weekend checks
// invisible to this report. A day counts as a working day when a plan is
// dated that day (production ran) or the day after (a prep/dough crew was
// in getting tomorrow ready). Days with no adjacent plan — kitchen shut —
// produce no missing rows.
//
// Query params:
//   from (required): YYYY-MM-DD, inclusive
//   to   (required): YYYY-MM-DD, inclusive
//   stationType (optional): filter to a single station
//
// Returns an array of missing items in the same shape as /completions so
// the frontend can render them in the same table, but with completedAt
// replaced by the calendar day (`planDate`) and a `missing: true` flag.
router.get("/missing", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (!from || !to) {
    res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    return;
  }
  const rangeStart = new Date(`${from}T12:00:00Z`);
  const rangeEnd = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    res.status(400).json({ error: "Invalid date format" });
    return;
  }
  const stationFilter = typeof req.query.stationType === "string" ? req.query.stationType : null;

  // Plans in the range plus one day past it — the extra day is needed to
  // recognise the last requested day as a prep day (e.g. range ending on a
  // Sunday needs Monday's plan to know the dough room was in).
  const dayAfterEnd = new Date(rangeEnd);
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
  const plans = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate })
    .from(productionPlansTable)
    .where(and(
      gte(productionPlansTable.planDate, from),
      lte(productionPlansTable.planDate, dayAfterEnd.toISOString().slice(0, 10)),
    ));

  if (plans.length === 0) {
    res.json([]);
    return;
  }

  const plansByDate = new Map<string, number[]>();
  for (const p of plans) {
    const list = plansByDate.get(p.planDate);
    if (list) list.push(p.id);
    else plansByDate.set(p.planDate, [p.id]);
  }

  // Enumerate the working days in [from, to]. Each carries an anchor planId
  // (same-day plan preferred, else the next day's) purely so rows keep the
  // response shape the frontend already knows.
  const workingDays: Array<{ day: string; anchorPlanId: number }> = [];
  const cursor = new Date(rangeStart);
  for (let guard = 0; guard < 1000 && cursor <= rangeEnd; guard++) {
    const day = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const next = cursor.toISOString().slice(0, 10);
    const anchor = plansByDate.get(day)?.[0] ?? plansByDate.get(next)?.[0];
    if (anchor != null) workingDays.push({ day, anchorPlanId: anchor });
  }

  // All active templates (optionally filtered to the requested station).
  const templateConds = [eq(checklistTemplatesTable.isActive, true)];
  if (stationFilter) {
    // Shared-checklist resolution: building_2 reads off the canonical
    // building_1 template row.
    templateConds.push(eq(checklistTemplatesTable.stationType, resolveChecklistStation(stationFilter)));
  }
  const templates = await db
    .select()
    .from(checklistTemplatesTable)
    .where(and(...templateConds))
    .orderBy(asc(checklistTemplatesTable.category), asc(checklistTemplatesTable.orderPosition));

  // Completions that could satisfy a day in range: ticked during the range
  // (by London calendar day of the timestamp — the primary match), or tied
  // to one of the range's plans (the legacy plan-scoped match; also covers
  // a closing check ticked just past midnight, which stays with its plan's
  // day rather than flagging as missed).
  const planIds = plans.map(p => p.id);
  const completions = await db
    .select({
      templateId: checklistCompletionsTable.templateId,
      planId: checklistCompletionsTable.planId,
      completedAt: checklistCompletionsTable.completedAt,
    })
    .from(checklistCompletionsTable)
    .where(or(
      and(
        gte(checklistCompletionsTable.completedAt, londonStartOfDay(rangeStart)),
        lte(checklistCompletionsTable.completedAt, londonEndOfDay(rangeEnd)),
      ),
      inArray(checklistCompletionsTable.planId, planIds),
    ));

  // (templateId → Set<London day>) and (templateId → Set<planId>) so the
  // day loop can answer "was template X done on day D / for plan Y?" in
  // constant time.
  const completedDays = new Map<number, Set<string>>();
  const completedPlans = new Map<number, Set<number>>();
  for (const c of completions) {
    if (c.completedAt) {
      let days = completedDays.get(c.templateId);
      if (!days) { days = new Set(); completedDays.set(c.templateId, days); }
      days.add(londonDateString(c.completedAt));
    }
    let set = completedPlans.get(c.templateId);
    if (!set) { set = new Set(); completedPlans.set(c.templateId, set); }
    set.add(c.planId);
  }

  type MissingRow = {
    id: string; // synthesised "tpl-{templateId}-plan-{planId}" key for React
    kind: "template-missing" | "oneoff-missing";
    templateId: number | null;
    planId: number;
    stationType: string;
    category: "opening" | "cleaning" | "closing";
    title: string;
    description: string | null;
    planDate: string;
    missing: true;
  };
  const missing: MissingRow[] = [];

  // Iterate every (working day × template) combination and emit a row for
  // each template that SHOULD apply on that calendar day but has no
  // completion — none ticked that day, and none tied to that day's plan.
  for (const { day, anchorPlanId } of workingDays) {
    const sameDayPlanIds = plansByDate.get(day) ?? [];
    for (const t of templates) {
      if (!templateMatchesDay(t, day)) continue;
      if (completedDays.get(t.id)?.has(day)) continue;
      const donePlans = completedPlans.get(t.id);
      if (donePlans && sameDayPlanIds.some(id => donePlans.has(id))) continue;
      missing.push({
        id: `tpl-${t.id}-day-${day}`,
        kind: "template-missing",
        templateId: t.id,
        planId: anchorPlanId,
        stationType: t.stationType,
        category: t.category as "opening" | "cleaning" | "closing",
        title: t.title,
        description: t.description,
        planDate: day,
        missing: true,
      });
    }
  }

  // Uncompleted one-off items in the same date range (rows exist but
  // completedAt IS NULL). One-offs are genuinely plan-scoped, so this stays
  // keyed by plan — but only plans dated inside [from, to], not the extra
  // lookahead day fetched above.
  const oneoffPlanIds = plans.filter(p => p.planDate <= to).map(p => p.id);
  const oneoffConds = [
    inArray(checklistOneoffItemsTable.planId, oneoffPlanIds),
    isNull(checklistOneoffItemsTable.completedAt),
  ];
  if (stationFilter) {
    oneoffConds.push(eq(checklistOneoffItemsTable.stationType, resolveChecklistStation(stationFilter)));
  }
  const oneoffs = oneoffPlanIds.length > 0
    ? await db.select().from(checklistOneoffItemsTable).where(and(...oneoffConds))
    : [];

  // Map planId → planDate so one-off rows can be sorted alongside templates.
  const planDateById = new Map(plans.map(p => [p.id, p.planDate]));

  for (const o of oneoffs) {
    missing.push({
      id: `oneoff-${o.id}`,
      kind: "oneoff-missing",
      templateId: null,
      planId: o.planId,
      stationType: o.stationType,
      category: o.category as "opening" | "cleaning" | "closing",
      title: o.title,
      description: o.description,
      planDate: planDateById.get(o.planId) ?? "",
      missing: true,
    });
  }

  // Most-recent plan date first so "what was outstanding yesterday" is at
  // the top.
  missing.sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0));

  res.json(missing);
});

// ─── One-off Items ───────────────────────────────────────────────────

const OneoffBody = z.object({
  planId: z.number().int(),
  stationType: z.string().min(1),
  category: z.enum(["opening", "cleaning", "closing"]),
  title: z.string().min(1),
  description: z.string().optional(),
  orderPosition: z.number().int().optional(),
});

router.post("/oneoff", async (req: Request, res: Response) => {
  const parsed = OneoffBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const canonicalStation = resolveChecklistStation(parsed.data.stationType);
  const [row] = await db.insert(checklistOneoffItemsTable).values({
    ...parsed.data,
    stationType: canonicalStation,
  }).returning();
  res.status(201).json(row);
});

router.put("/oneoff/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = req.body as Record<string, unknown>;

  // If completing
  if (body.completed === true) {
    let userName = "Unknown";
    if (req.session.userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId));
      if (user) userName = user.name;
    }
    const [row] = await db.update(checklistOneoffItemsTable).set({
      completedBy: req.session.userId ?? null,
      completedByName: userName,
      completedAt: new Date(),
      skippedReason: typeof body.skippedReason === "string" ? body.skippedReason : null,
    }).where(eq(checklistOneoffItemsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Item not found" }); return; }
    res.json(row);
    return;
  }

  // If uncompleting
  if (body.completed === false) {
    const [row] = await db.update(checklistOneoffItemsTable).set({
      completedBy: null,
      completedByName: null,
      completedAt: null,
      skippedReason: null,
    }).where(eq(checklistOneoffItemsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Item not found" }); return; }
    res.json(row);
    return;
  }

  // General update
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") updates.title = body.title;
  if (typeof body.description === "string") updates.description = body.description;
  if (typeof body.category === "string") updates.category = body.category;

  const [row] = await db.update(checklistOneoffItemsTable).set(updates).where(eq(checklistOneoffItemsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(row);
});

router.delete("/oneoff/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db.delete(checklistOneoffItemsTable).where(eq(checklistOneoffItemsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json({ success: true });
});

// ─── Dynamic Data ────────────────────────────────────────────────────

router.get("/dynamic-data/:planId/:type", async (req: Request, res: Response) => {
  const planId = Number(req.params.planId);
  const type = req.params.type;

  if (type === "temperature_records") {
    const rows = await db.select().from(temperatureRecordsTable)
      .where(eq(temperatureRecordsTable.planId, planId))
      .orderBy(desc(temperatureRecordsTable.recordedAt));
    res.json(rows);
    return;
  }

  if (type === "oven_events") {
    const rows = await db.select().from(ovenEventsTable)
      .where(eq(ovenEventsTable.planId, planId))
      .orderBy(desc(ovenEventsTable.ovenInAt));
    res.json(rows);
    return;
  }

  if (type === "mozzarella_load") {
    // Mozzarella is loaded into the building fridges at end of day for the
    // NEXT production day's build — so this (closing-checklist) figure must
    // reflect the next plan's requirement, not the current/today's plan.
    const [currentPlan] = await db
      .select({ planDate: productionPlansTable.planDate })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.id, planId))
      .limit(1);

    let targetPlanId = planId;
    let targetPlanDate: string | null = currentPlan?.planDate ?? null;
    if (currentPlan) {
      const [nextPlan] = await db
        .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate })
        .from(productionPlansTable)
        .where(gt(productionPlansTable.planDate, currentPlan.planDate))
        .orderBy(asc(productionPlansTable.planDate))
        .limit(1);
      if (!nextPlan) { res.json([]); return; } // no upcoming plan → nothing to load yet
      targetPlanId = nextPlan.id;
      targetPlanDate = nextPlan.planDate;
    }

    // Calculate mozzarella load for the next plan (same logic as the
    // production-plans mozzarella-load endpoint).
    const planItems = await db
      .select({
        recipeId: productionPlanItemsTable.recipeId,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        portionsPerBatch: recipesTable.portionsPerBatch,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(eq(productionPlanItemsTable.planId, targetPlanId));

    let totalQty = 0;
    let mozzMeta: { name: string; unit: string } | null = null;

    for (const pi of planItems) {
      const bt = Number(pi.batchesTarget) || 0;
      if (!pi.recipeId || bt === 0) continue;
      const ppb = Number(pi.portionsPerBatch) || 10;
      const rows = await db
        .select({
          quantity: recipeIngredientsTable.quantity,
          ingredientName: ingredientsTable.name,
          unit: ingredientsTable.unit,
        })
        .from(recipeIngredientsTable)
        .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
        .where(and(
          eq(recipeIngredientsTable.recipeId, pi.recipeId),
          isNull(recipeIngredientsTable.marinadeForIngredientId),
        ));
      for (const r of rows) {
        if (!(r.ingredientName ?? "").toLowerCase().includes("mozzarella")) continue;
        totalQty += (Number(r.quantity) || 0) * ppb * bt;
        if (!mozzMeta) mozzMeta = { name: r.ingredientName ?? "Mozzarella", unit: r.unit ?? "g" };
      }
    }

    if (totalQty === 0 || !mozzMeta) { res.json([]); return; }
    const bagWeight = mozzMeta.unit === "kg" ? 2 : 2000;
    const bags = Math.ceil(totalQty / bagWeight);
    res.json([{ name: mozzMeta.name, unit: mozzMeta.unit, totalQty, bagWeight, bags, planDate: targetPlanDate }]);
    return;
  }

  // Today's ice-pack counts ON the check itself — "See how many ice packs
  // are needed" used to mean going to a different screen to look (Graeme,
  // 2026-08-20). Same weather-driven calc as the packing banner.
  if (type === "ice_packs") {
    try {
      const { computeIcePacksToday } = await import("./ice-packs");
      res.json([await computeIcePacksToday()]);
    } catch (err: any) {
      console.error("[checklist] ice_packs error:", err.message);
      res.json([]);
    }
    return;
  }

  if (type === "desserts_report") {
    // Always use tomorrow's date for delivery tag (dispatch is always for next day).
    // "Tomorrow" is measured in London — Railway runs UTC so a plain
    // new Date() would roll over an hour before UK midnight in BST.
    const todayLondon = new Date(`${londonDateString()}T00:00:00Z`);
    const tomorrow = new Date(todayLondon);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tag = londonDateString(tomorrow); // yyyy-MM-dd

    try {
      const { getProductsByTag, getOrdersByTag } = await import("../services/shopify");
      const [dessertTitles, orders] = await Promise.all([
        getProductsByTag("Desserts"),
        getOrdersByTag(tag),
      ]);

      // One implementation, shared with the packing station's report.
      const { buildDessertReport } = await import("../lib/desserts-report");
      const report = buildDessertReport(orders, dessertTitles);
      const deliveryLabel = tomorrow.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

      res.json([{ tag, deliveryLabel, ...report, dessertProductCount: dessertTitles.size }]);
    } catch (err: any) {
      console.error("[checklist] desserts_report error:", err.message);
      res.json([]);
    }
    return;
  }

  // Closing fridge check: packs still in the production fridge whose last
  // valid dispatch is today or already gone — after today's dispatches
  // they can never be sold chilled (calzones must arrive with 3 days of
  // life, mac cheese 2). Listed per recipe; the packing team freezes each
  // via POST /closing-fridge-freeze below, which removes the rows from
  // this payload on the next fetch (self-clearing).
  if (type === "closing_fridge_check") {
    const actions = await computeClosingFridgeActions(londonDateString());
    res.json(actions);
    return;
  }

  // Duck defrost: duck needs ~2 days in the fridge, so the closing check
  // looks TWO production plans ahead of the plan being worked and totals
  // the duck (kg) its recipes need — the quantity to pull from the freezer
  // tonight. Falls back to the only future plan (flagged) when the second
  // one hasn't been created yet.
  if (type === "duck_defrost_quantity") {
    const [currentPlan] = await db
      .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.id, planId));
    if (!currentPlan) { res.json([{ found: false }]); return; }
    const futurePlans = await db
      .select({
        id: productionPlansTable.id,
        name: productionPlansTable.name,
        planDate: productionPlansTable.planDate,
      })
      .from(productionPlansTable)
      .where(and(
        gt(productionPlansTable.planDate, currentPlan.planDate),
        inArray(productionPlansTable.status, ["draft", "active", "prep", "building"]),
      ))
      .orderBy(asc(productionPlansTable.planDate))
      .limit(2);
    const target = futurePlans[1] ?? futurePlans[0];
    if (!target) { res.json([{ found: false }]); return; }

    const items = await db
      .select({
        recipeId: productionPlanItemsTable.recipeId,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        recipeName: recipesTable.name,
        portionsPerBatch: recipesTable.portionsPerBatch,
      })
      .from(productionPlanItemsTable)
      .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(eq(productionPlanItemsTable.planId, target.id));

    const perRecipe: Array<{ recipeName: string; batches: number; kg: number }> = [];
    let totalKg = 0;
    for (const item of items) {
      const batches = item.batchesTarget ?? 0;
      if (batches <= 0 || item.recipeId == null) continue;
      const resolved = await resolveRecipeIngredients(item.recipeId, Number(item.portionsPerBatch) || 10, { skipToppings: true });
      const duckPerBatch = resolved
        .filter(i => i.ingredientName.toLowerCase().includes("duck"))
        .reduce((s, i) => s + i.quantityPerBatch, 0);
      if (duckPerBatch <= 0) continue;
      const kg = Math.round(duckPerBatch * batches * 100) / 100;
      perRecipe.push({ recipeName: item.recipeName ?? `Recipe #${item.recipeId}`, batches, kg });
      totalKg += kg;
    }
    res.json([{
      found: true,
      planId: target.id,
      planName: target.name,
      planDate: target.planDate,
      plansAhead: futurePlans[1] ? 2 : 1,
      totalKg: Math.round(totalKg * 100) / 100,
      perRecipe,
    }]);
    return;
  }

  // Both opening (first) and closing (last) pack-batch checklists pull
  // the same shape of payload — per-recipe fridge qty, suggested-oldest
  // batch, and whatever's already been recorded for first/last today.
  // The frontend component switches its label, suggestion logic, and
  // which column it POSTs to based on the dynamic data type.
  if (type === "first_pack_batch_numbers" || type === "last_pack_batch_numbers") {
    // Order recipes by Shopify SKU (matches Easy Scan's ordering on
    // the kitchen scanner), with recipe name as a tiebreaker for any
    // recipe whose SKU hasn't been backfilled yet. Filtered to core
    // menu items only — discontinued recipes (e.g. New Yorker)
    // shouldn't appear on the opening/closing pack-batch checks
    // even if they still have residual stock in the production
    // fridge. The SKU lives on recipe_shopify_mappings (raw SQL
    // table — no Drizzle schema), so we drop to a raw query for the
    // join.
    const fridgeRows = await db.execute<{
      recipe_id: number;
      recipe_name: string;
      quantity: string;
      category: string | null;
      shelf_life_days: number | null;
      shopify_sku: string | null;
    }>(sql`
      SELECT
        se.recipe_id AS recipe_id,
        r.name       AS recipe_name,
        se.quantity  AS quantity,
        r.category   AS category,
        r.shelf_life_days AS shelf_life_days,
        (
          SELECT m.shopify_sku
          FROM recipe_shopify_mappings m
          WHERE m.recipe_id = se.recipe_id AND m.shopify_sku IS NOT NULL
          ORDER BY m.shopify_sku ASC
          LIMIT 1
        ) AS shopify_sku
      FROM stock_entries se
      INNER JOIN recipes r ON r.id = se.recipe_id
      WHERE se.item_type = 'recipe'
        AND se.location  = 'production_fridge'
        AND se.quantity::numeric > 0
        AND r.is_core_menu = TRUE
      ORDER BY shopify_sku NULLS LAST, r.name ASC
    `);
    const fridgeStock = (fridgeRows.rows ?? fridgeRows).map(r => ({
      recipeId: r.recipe_id,
      recipeName: r.recipe_name,
      quantity: r.quantity,
      category: r.category,
      shelfLifeDays: r.shelf_life_days,
    }));

    // Deduplicate by recipeId (stock_entries may have multiple rows per recipe)
    const fridgeRecipes = new Map<number, { recipeName: string; qty: number; category: string | null; shelfLifeDays: number | null }>();
    for (const row of fridgeStock) {
      if (!row.recipeId) continue;
      const existing = fridgeRecipes.get(row.recipeId);
      if (!existing || Number(row.quantity) > existing.qty) {
        fridgeRecipes.set(row.recipeId, {
          recipeName: row.recipeName ?? `Recipe #${row.recipeId}`,
          qty: Number(row.quantity),
          category: row.category ?? null,
          shelfLifeDays: row.shelfLifeDays != null ? Number(row.shelfLifeDays) : null,
        });
      }
    }

    // Get oldest batch per recipe from fridge_stock_batches (if available — may be empty for pre-migration stock)
    const fridgeRecipeIds = [...fridgeRecipes.keys()];
    const batchRows = fridgeRecipeIds.length > 0
      ? await db
          .select({
            recipeId: fridgeStockBatchesTable.recipeId,
            batchNumber: fridgeStockBatchesTable.batchNumber,
            useByDate: fridgeStockBatchesTable.useByDate,
          })
          .from(fridgeStockBatchesTable)
          .where(and(
            inArray(fridgeStockBatchesTable.recipeId, fridgeRecipeIds),
            sql`${fridgeStockBatchesTable.quantity} > 0`,
            // Only batches from the last two weeks. The batch table's
            // quantities drift, so without a recency window stale months-old
            // rows with phantom stock filled all six chip slots and crowded
            // out the batches actually on the bench (Graeme, 2026-08-25).
            sql`${fridgeStockBatchesTable.createdAt} >= NOW() - INTERVAL '14 days'`,
          ))
          .orderBy(asc(fridgeStockBatchesTable.useByDate))
      : [];

    const oldestBatch = new Map<number, { batchNumber: number; useByDate: string }>();
    // ALL fridge batches per recipe (FIFO order) — the checklist offers
    // these as tap-to-record options so nobody has to type a number.
    const candidatesByRecipe = new Map<number, Array<{ batchNumber: number; useByDate: string | null }>>();
    for (const b of batchRows) {
      if (!oldestBatch.has(b.recipeId)) {
        oldestBatch.set(b.recipeId, { batchNumber: b.batchNumber, useByDate: b.useByDate });
      }
      // Guard against junk rows (batch 0 exists in old data) — a chip
      // with a nonsense number invites a nonsense record.
      if (b.batchNumber > 0) {
        const list = candidatesByRecipe.get(b.recipeId) ?? [];
        if (!list.some(c => c.batchNumber === b.batchNumber)) {
          list.push({ batchNumber: b.batchNumber, useByDate: b.useByDate });
        }
        candidatesByRecipe.set(b.recipeId, list);
      }
    }

    // The tap-chips: batch numbers of the LAST FIVE PRODUCTION DAYS,
    // today first (Graeme, 2026-08-28). Only days a plan actually ran —
    // weekends and dark days never printed a label, so their julian
    // numbers can't be on any pack. Today is included because packs made
    // this morning can ship this afternoon. The fridge-batches table is
    // NOT used for the chips: its quantities drift (see the batch-reset
    // work) and the wrong number as a tap-target invites a wrong record.
    const recentPlanRows = await db
      .select({ batchNumber: productionPlansTable.batchNumber, planDate: productionPlansTable.planDate })
      .from(productionPlansTable)
      .where(sql`${productionPlansTable.planDate} <= CURRENT_DATE AND ${productionPlansTable.batchNumber} IS NOT NULL`)
      .orderBy(sql`${productionPlansTable.planDate} DESC`)
      .limit(30);
    const recentBatchNumbers: number[] = [];
    for (const r of recentPlanRows) {
      const n = r.batchNumber as number;
      if (n > 0 && !recentBatchNumbers.includes(n)) recentBatchNumbers.push(n);
      if (recentBatchNumbers.length >= 5) break;
    }

    // Get any already-recorded batch numbers for this plan (both first
    // and last — opening check will show what's recorded as first;
    // closing check will show first as context and what's recorded as
    // last).
    const existingRecords = await db
      .select()
      .from(packingBatchRecordsTable)
      .where(eq(packingBatchRecordsTable.planId, planId));
    const recordMap = new Map<number, {
      firstBatchNumber: number | null;
      lastBatchNumber: number | null;
      firstRecordedAt: string | null;
      lastRecordedAt: string | null;
    }>();
    for (const r of existingRecords) {
      recordMap.set(r.recipeId, {
        firstBatchNumber: r.firstBatchNumber,
        lastBatchNumber: r.lastBatchNumber,
        firstRecordedAt: r.firstRecordedAt?.toISOString() ?? null,
        lastRecordedAt: r.lastRecordedAt?.toISOString() ?? null,
      });
    }

    // Shelf-life rule context, so the widget can verify dispatchability the
    // moment a batch number is chosen: dispatch today + overnight delivery
    // means the earliest acceptable use-by is today + 1 + minDays for the
    // recipe's category (Graeme, 2026-09-02; rules in lib/min-shelf-days).
    const minShelfRules = await loadMinShelfDaysRules();
    const todayLondon = londonDateString();

    const result = fridgeRecipeIds.map(recipeId => {
      const recipe = fridgeRecipes.get(recipeId)!;
      const suggested = oldestBatch.get(recipeId);
      const recorded = recordMap.get(recipeId);
      const shelfLifeDays = recipe.shelfLifeDays != null && recipe.shelfLifeDays > 0 ? recipe.shelfLifeDays : null;
      const earliestOkUseBy = addCalendarDays(todayLondon, 1 + minShelfDaysFor(recipe.category, minShelfRules));
      return {
        recipeId,
        recipeName: recipe.recipeName,
        fridgeQty: recipe.qty,
        category: recipe.category,
        // null = shelf life not set on the recipe; the widget can't verify
        // and says so rather than guessing.
        shelfLifeDays,
        earliestOkUseBy,
        // First-pack suggestion = oldest batch in the fridge (FIFO) — but
        // only when it's one of the plausible recent numbers; the batch
        // table drifts, and a stale suggestion is worse than none.
        suggestedBatchNumber: suggested && recentBatchNumbers.includes(suggested.batchNumber) ? suggested.batchNumber : null,
        suggestedUseByDate: suggested && recentBatchNumbers.includes(suggested.batchNumber) ? suggested.useByDate : null,
        // Tap-options: the last five production days' batch numbers, today
        // first — the only numbers that can be on a pack label.
        candidateBatchNumbers: recentBatchNumbers,
        recordedFirstBatchNumber: recorded?.firstBatchNumber ?? null,
        recordedLastBatchNumber: recorded?.lastBatchNumber ?? null,
        firstRecordedAt: recorded?.firstRecordedAt ?? null,
        lastRecordedAt: recorded?.lastRecordedAt ?? null,
      };
    });

    res.json(result);
    return;
  }

  // Per-fridge/freezer temperature recording (opening + closing). Both
  // types return the same shape; the frontend records into the AM or PM
  // column based on the London clock (before/after midday), not the type.
  // The location list MIRRORS Stock Control exactly — same rows, same
  // names, same order (built-in fridges first in their canonical order,
  // then user-added ones A-Z) — so the check list and Stock Control's
  // Storage Locations can never drift apart.
  if (type === "fridge_freezer_temps_opening" || type === "fridge_freezer_temps_closing") {
    const allLocs = await db.select().from(storageLocationsTable);
    // Built-ins are identified by their stored def_key (stable across
    // renames), mirroring Stock Control exactly — a renamed built-in keeps
    // its canonical slot and its new display name in both places.
    const systemByDefKey = new Map(allLocs.filter(l => l.defKey).map(l => [l.defKey as string, l]));
    const ordered: typeof allLocs = [];
    for (const def of LOCATION_DEFS) {
      const dbLoc = systemByDefKey.get(def.key);
      if (dbLoc) ordered.push(dbLoc);
    }
    for (const ul of allLocs.filter(l => !l.defKey).sort((a, b) => a.name.localeCompare(b.name))) {
      ordered.push(ul);
    }
    const locations = ordered.filter(l => l.zone === "fridge" || l.zone === "freezer");

    const existing = await db
      .select()
      .from(locationTemperatureRecordsTable)
      .where(eq(locationTemperatureRecordsTable.planId, planId));
    const recordMap = new Map<number, typeof existing[number]>();
    for (const r of existing) recordMap.set(r.storageLocationId, r);

    const result = locations.map((loc) => {
      const rec = recordMap.get(loc.id);
      return {
        storageLocationId: loc.id,
        locationName: loc.name,
        zone: loc.zone,
        tempMinC: loc.tempMinC != null ? Number(loc.tempMinC) : null,
        tempMaxC: loc.tempMaxC != null ? Number(loc.tempMaxC) : null,
        openingTemperatureC: rec?.openingTemperatureC != null ? Number(rec.openingTemperatureC) : null,
        closingTemperatureC: rec?.closingTemperatureC != null ? Number(rec.closingTemperatureC) : null,
        openingRecordedAt: rec?.openingRecordedAt?.toISOString() ?? null,
        closingRecordedAt: rec?.closingRecordedAt?.toISOString() ?? null,
      };
    });
    res.json(result);
    return;
  }

  res.status(400).json({ error: `Unknown dynamic data type: ${type}` });
});

// POST /location-temperature-record — save opening or closing temperature
// for one fridge/freezer in the current plan. `kind` selects which column
// to update so opening and closing checks can share the (plan, location)
// row.
router.post("/location-temperature-record", async (req: Request, res: Response) => {
  const { planId, storageLocationId, temperatureC, kind } = req.body as {
    planId: number;
    storageLocationId: number;
    temperatureC: number;
    kind?: "opening" | "closing";
  };
  if (!planId || !storageLocationId || typeof temperatureC !== "number" || Number.isNaN(temperatureC)) {
    res.status(400).json({ error: "planId, storageLocationId, and numeric temperatureC are required" });
    return;
  }
  const which: "opening" | "closing" = kind === "closing" ? "closing" : "opening";
  const userId = (req.session as any)?.userId ?? null;
  const tempStr = temperatureC.toFixed(1);
  try {
    if (which === "opening") {
      await db.execute(sql`
        INSERT INTO location_temperature_records (plan_id, storage_location_id, opening_temperature_c, opening_user_id, opening_recorded_at)
        VALUES (${planId}, ${storageLocationId}, ${tempStr}, ${userId}, NOW())
        ON CONFLICT (plan_id, storage_location_id)
        DO UPDATE SET opening_temperature_c = ${tempStr}, opening_user_id = ${userId}, opening_recorded_at = NOW()
      `);
    } else {
      await db.execute(sql`
        INSERT INTO location_temperature_records (plan_id, storage_location_id, closing_temperature_c, closing_user_id, closing_recorded_at)
        VALUES (${planId}, ${storageLocationId}, ${tempStr}, ${userId}, NOW())
        ON CONFLICT (plan_id, storage_location_id)
        DO UPDATE SET closing_temperature_c = ${tempStr}, closing_user_id = ${userId}, closing_recorded_at = NOW()
      `);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("location-temperature-record error:", err);
    res.status(500).json({ error: "Failed to save temperature record" });
  }
});

// POST /packing-batch-record — save first OR last pack batch number for
// a recipe. `kind` selects which column to update. The other column is
// left alone, so the same (plan, recipe) row carries both values across
// opening and closing checks.
router.post("/packing-batch-record", async (req: Request, res: Response) => {
  const { planId, recipeId, batchNumber, kind } = req.body as {
    planId: number;
    recipeId: number;
    batchNumber: number;
    kind?: "first" | "last";
  };
  if (!planId || !recipeId || !batchNumber) {
    res.status(400).json({ error: "planId, recipeId, and batchNumber are required" });
    return;
  }
  const which: "first" | "last" = kind === "last" ? "last" : "first";
  const userId = (req.session as any)?.userId ?? null;
  try {
    if (which === "first") {
      // Verify dispatchability as the number is recorded (Graeme,
      // 2026-09-02): batch number → made-on date, + the recipe's shelf life
      // → use-by; dispatch today + overnight delivery needs use-by ≥
      // today + 1 + minDays for the category. Verdict is stored for the
      // HACCP trail and returned so the widget can warn on the spot.
      // null verdict = can't verify (no shelf life set / unparseable batch).
      const [recipe] = await db
        .select({ category: recipesTable.category, shelfLifeDays: recipesTable.shelfLifeDays })
        .from(recipesTable)
        .where(eq(recipesTable.id, recipeId));
      let useByDate: string | null = null;
      let shelfLifeOk: boolean | null = null;
      let earliestOkUseBy: string | null = null;
      const prodDate = productionDateFromJulianBatch(batchNumber);
      if (recipe && recipe.shelfLifeDays != null && Number(recipe.shelfLifeDays) > 0 && prodDate) {
        const rules = await loadMinShelfDaysRules();
        useByDate = addCalendarDays(prodDate, Number(recipe.shelfLifeDays));
        earliestOkUseBy = addCalendarDays(londonDateString(), 1 + minShelfDaysFor(recipe.category ?? null, rules));
        shelfLifeOk = useByDate >= earliestOkUseBy;
      }
      await db.execute(sql`
        INSERT INTO packing_batch_records (plan_id, recipe_id, first_batch_number, first_user_id, first_recorded_at, first_use_by_date, first_shelf_life_ok)
        VALUES (${planId}, ${recipeId}, ${batchNumber}, ${userId}, NOW(), ${useByDate}, ${shelfLifeOk})
        ON CONFLICT (plan_id, recipe_id)
        DO UPDATE SET first_batch_number = ${batchNumber}, first_user_id = ${userId}, first_recorded_at = NOW(),
                      first_use_by_date = ${useByDate}, first_shelf_life_ok = ${shelfLifeOk}
      `);
      res.json({ ok: true, verdict: { useByDate, earliestOkUseBy, shelfLifeOk } });
      return;
    } else {
      await db.execute(sql`
        INSERT INTO packing_batch_records (plan_id, recipe_id, last_batch_number, last_user_id, last_recorded_at)
        VALUES (${planId}, ${recipeId}, ${batchNumber}, ${userId}, NOW())
        ON CONFLICT (plan_id, recipe_id)
        DO UPDATE SET last_batch_number = ${batchNumber}, last_user_id = ${userId}, last_recorded_at = NOW()
      `);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("packing-batch-record error:", err);
    res.status(500).json({ error: "Failed to save batch record" });
  }
});

// POST /closing-fridge-freeze — the action half of the closing fridge
// check: move out-of-life packs from the production fridge into freezer
// (Wonky) stock. Goes through the adjustFridgeStock chokepoint so the
// aggregate, the FIFO batch rows and the audit log all move together;
// packs are re-validated server-side against the live expiring list so a
// stale screen can't freeze packs that were dispatched in the meantime.
router.post("/closing-fridge-freeze", async (req: Request, res: Response) => {
  const { recipeId, packs } = req.body as { recipeId?: number; packs?: number };
  const packsToFreeze = Math.trunc(Number(packs));
  if (!recipeId || !Number.isFinite(packsToFreeze) || packsToFreeze <= 0) {
    res.status(400).json({ error: "recipeId and a positive packs count are required" });
    return;
  }
  try {
    const actions = await computeClosingFridgeActions(londonDateString());
    const action = actions.find(a => a.recipeId === recipeId);
    if (!action) {
      res.status(409).json({ error: "Nothing left to freeze for this recipe — the list may be out of date. Refresh and check again." });
      return;
    }
    if (packsToFreeze > action.actionPacks) {
      res.status(409).json({ error: `Only ${action.actionPacks} pack(s) still need freezing for ${action.recipeName}. Refresh and check again.` });
      return;
    }
    const userId = (req.session as any)?.userId ?? null;
    const result = await adjustFridgeStock({
      recipeId,
      delta: -packsToFreeze,
      packSize: 2,
      reason: `Closing check: ${packsToFreeze} out-of-life pack(s) → freezer (Wonky)`,
      source: "freeze",
      userId,
    });
    const newFreezerQty = await addRecipeFreezerStock(
      recipeId,
      packsToFreeze,
      `Closing check: frozen from production fridge (out of chilled life)`,
    );
    res.json({
      ok: true,
      recipeId,
      frozenPacks: packsToFreeze,
      newFridgeQty: result.newAggregateQty,
      newFreezerQty,
    });
  } catch (err) {
    console.error("closing-fridge-freeze error:", err);
    res.status(500).json({ error: "Failed to freeze packs" });
  }
});

export default router;
