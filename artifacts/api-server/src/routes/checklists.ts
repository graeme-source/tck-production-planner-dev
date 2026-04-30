import { Router, type IRouter, type Request, type Response } from "express";
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
} from "@workspace/db";
import { eq, and, gt, asc, desc, gte, lte, sql, isNull, inArray } from "drizzle-orm";
import * as z from "zod";

type ChecklistCompletion = typeof checklistCompletionsTable.$inferSelect;

const router: IRouter = Router();


// Shared checklists: stations on the left share a single checklist stored
// under the canonical station on the right. Editing or viewing the alias
// transparently routes to the canonical record so a "weekly Monday" item
// added to either station shows up on both for every user.
const SHARED_CHECKLIST_STATIONS: Record<string, string> = {
  building_2: "building_1",
  dough_prep: "dough_sheeting",
};

/** Resolve to the canonical station type for checklist storage */
function resolveChecklistStation(stationType: string): string {
  return SHARED_CHECKLIST_STATIONS[stationType] ?? stationType;
}

function getDayName(date: Date): string {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()];
}

function templateMatchesDay(template: { schedule: string; scheduleDays: string | null }, planDate: string): boolean {
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
  return true;
}

// ─── Template CRUD (admin-only) ──────────────────────────────────────

const CreateTemplateBody = z.object({
  stationType: z.string().min(1),
  category: z.enum(["opening", "cleaning", "closing"]),
  title: z.string().min(1),
  description: z.string().nullish(),
  schedule: z.enum(["daily", "weekly", "specific_days"]).default("daily"),
  scheduleDays: z.array(z.string()).nullish(),
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
  schedule: z.enum(["daily", "weekly", "specific_days"]).optional(),
  scheduleDays: z.array(z.string()).nullable().optional(),
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

router.delete("/templates/:id", async (req: Request, res: Response) => {
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
  await db.transaction(async (tx: typeof db) => {
    for (const item of parsed.data.order) {
      await tx.update(checklistTemplatesTable)
        .set({ orderPosition: item.orderPosition })
        .where(eq(checklistTemplatesTable.id, item.id));
    }
  });
  res.json({ success: true });
});

// ─── Station Checklist (merged templates + completions) ──────────────

router.get("/station/:stationType/plan/:planId", async (req: Request, res: Response) => {
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

  // Filter by schedule/day
  const filtered = templates.filter((t: { schedule: string; scheduleDays: string | null }) => templateMatchesDay(t, plan.planDate));

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
// templates that were scheduled for a given (plan date × station) but have
// no matching completion row, plus any one-off items that were created but
// never ticked off. Used by the Analytics → HACCP tab to surface "what did
// we miss yesterday?" for EHO compliance.
//
// Query params:
//   from (required): YYYY-MM-DD, inclusive
//   to   (required): YYYY-MM-DD, inclusive
//   stationType (optional): filter to a single station
//
// Returns an array of missing items in the same shape as /completions so
// the frontend can render them in the same table, but with completedAt
// replaced by the plan date and a `missing: true` flag.
router.get("/missing", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : null;
  const to = typeof req.query.to === "string" ? req.query.to : null;
  if (!from || !to) {
    res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    return;
  }
  const stationFilter = typeof req.query.stationType === "string" ? req.query.stationType : null;

  // Plans that live in the requested date range. We enumerate "what should
  // have happened" against these plans — each plan represents a day that
  // the station was scheduled to run.
  const plans = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate })
    .from(productionPlansTable)
    .where(and(
      gte(productionPlansTable.planDate, from),
      lte(productionPlansTable.planDate, to),
    ));

  if (plans.length === 0) {
    res.json([]);
    return;
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

  // Completions for the plans in range — existence means "not missing".
  const planIds = plans.map(p => p.id);
  const completions = planIds.length > 0
    ? await db
        .select({
          templateId: checklistCompletionsTable.templateId,
          planId: checklistCompletionsTable.planId,
          stationType: checklistCompletionsTable.stationType,
        })
        .from(checklistCompletionsTable)
        .where(inArray(checklistCompletionsTable.planId, planIds))
    : [];

  // (templateId → Set<planId>) so we can check "did template X have a
  // completion for plan Y?" in constant time.
  const completedMap = new Map<number, Set<number>>();
  for (const c of completions) {
    let set = completedMap.get(c.templateId);
    if (!set) { set = new Set(); completedMap.set(c.templateId, set); }
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

  // Iterate every (plan × template) combination and emit a row for each
  // template that SHOULD apply on that plan's date but has no completion.
  for (const plan of plans) {
    for (const t of templates) {
      if (!templateMatchesDay(t, plan.planDate)) continue;
      const done = completedMap.get(t.id);
      if (done?.has(plan.id)) continue;
      missing.push({
        id: `tpl-${t.id}-plan-${plan.id}`,
        kind: "template-missing",
        templateId: t.id,
        planId: plan.id,
        stationType: t.stationType,
        category: t.category as "opening" | "cleaning" | "closing",
        title: t.title,
        description: t.description,
        planDate: plan.planDate,
        missing: true,
      });
    }
  }

  // Uncompleted one-off items in the same date range (rows exist but
  // completedAt IS NULL).
  const oneoffConds = [
    inArray(checklistOneoffItemsTable.planId, planIds),
    isNull(checklistOneoffItemsTable.completedAt),
  ];
  if (stationFilter) {
    oneoffConds.push(eq(checklistOneoffItemsTable.stationType, resolveChecklistStation(stationFilter)));
  }
  const oneoffs = planIds.length > 0
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
    // Calculate mozzarella load for the plan (same logic as production-plans mozzarella-load endpoint)
    const planItems = await db
      .select({
        recipeId: productionPlanItemsTable.recipeId,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        portionsPerBatch: recipesTable.portionsPerBatch,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(eq(productionPlanItemsTable.planId, planId));

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
    res.json([{ name: mozzMeta.name, unit: mozzMeta.unit, totalQty, bagWeight, bags }]);
    return;
  }

  if (type === "desserts_report") {
    // Always use tomorrow's date for delivery tag (dispatch is always for next day)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tag = tomorrow.toISOString().split("T")[0]; // yyyy-MM-dd

    try {
      const { getProductsByTag, getOrdersByTag } = await import("../services/shopify");
      const [dessertTitles, orders] = await Promise.all([
        getProductsByTag("Desserts"),
        getOrdersByTag(tag),
      ]);

      const productTotals = new Map<string, { quantity: number; orderCount: number }>();
      for (const order of orders) {
        for (const item of order.line_items) {
          if (dessertTitles.has(item.title)) {
            const existing = productTotals.get(item.title) ?? { quantity: 0, orderCount: 0 };
            existing.quantity += item.quantity;
            existing.orderCount += 1;
            productTotals.set(item.title, existing);
          }
        }
      }

      const products = [...productTotals.entries()]
        .map(([title, stats]) => ({ title, ...stats }))
        .sort((a, b) => a.title.localeCompare(b.title));

      const totalQuantity = products.reduce((s, p) => s + p.quantity, 0);
      const deliveryLabel = tomorrow.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

      res.json([{ tag, deliveryLabel, products, totalQuantity, dessertProductCount: dessertTitles.size }]);
    } catch (err: any) {
      console.error("[checklist] desserts_report error:", err.message);
      res.json([]);
    }
    return;
  }

  if (type === "first_pack_batch_numbers") {
    // Get ALL recipes currently in the production fridge from stock_entries
    // (the aggregate stock table that always has data, unlike fridge_stock_batches
    // which only populates from new wrapping going forward)
    const fridgeStock = await db
      .select({
        recipeId: stockEntriesTable.recipeId,
        recipeName: recipesTable.name,
        quantity: stockEntriesTable.quantity,
      })
      .from(stockEntriesTable)
      .leftJoin(recipesTable, eq(stockEntriesTable.recipeId, recipesTable.id))
      .where(and(
        eq(stockEntriesTable.itemType, "recipe"),
        eq(stockEntriesTable.location, "production_fridge"),
        gt(stockEntriesTable.quantity, "0"),
      ))
      .orderBy(asc(recipesTable.name));

    // Deduplicate by recipeId (stock_entries may have multiple rows per recipe)
    const fridgeRecipes = new Map<number, { recipeName: string; qty: number }>();
    for (const row of fridgeStock) {
      if (!row.recipeId) continue;
      const existing = fridgeRecipes.get(row.recipeId);
      if (!existing || Number(row.quantity) > existing.qty) {
        fridgeRecipes.set(row.recipeId, {
          recipeName: row.recipeName ?? `Recipe #${row.recipeId}`,
          qty: Number(row.quantity),
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
          ))
          .orderBy(asc(fridgeStockBatchesTable.useByDate))
      : [];

    const oldestBatch = new Map<number, { batchNumber: number; useByDate: string }>();
    for (const b of batchRows) {
      if (!oldestBatch.has(b.recipeId)) {
        oldestBatch.set(b.recipeId, { batchNumber: b.batchNumber, useByDate: b.useByDate });
      }
    }

    // Get any already-recorded batch numbers for this plan
    const existingRecords = await db
      .select()
      .from(packingBatchRecordsTable)
      .where(eq(packingBatchRecordsTable.planId, planId));
    const recordMap = new Map<number, { batchNumber: number; recordedAt: string }>();
    for (const r of existingRecords) {
      recordMap.set(r.recipeId, { batchNumber: r.batchNumber, recordedAt: r.recordedAt.toISOString() });
    }

    const result = fridgeRecipeIds.map(recipeId => {
      const recipe = fridgeRecipes.get(recipeId)!;
      const suggested = oldestBatch.get(recipeId);
      const recorded = recordMap.get(recipeId);
      return {
        recipeId,
        recipeName: recipe.recipeName,
        fridgeQty: recipe.qty,
        suggestedBatchNumber: suggested?.batchNumber ?? null,
        suggestedUseByDate: suggested?.useByDate ?? null,
        recordedBatchNumber: recorded?.batchNumber ?? null,
        recordedAt: recorded?.recordedAt ?? null,
      };
    });

    res.json(result);
    return;
  }

  res.status(400).json({ error: `Unknown dynamic data type: ${type}` });
});

// POST /packing-batch-record — save or update a first-pack batch number for a recipe
router.post("/packing-batch-record", async (req: Request, res: Response) => {
  const { planId, recipeId, batchNumber } = req.body as { planId: number; recipeId: number; batchNumber: number };
  if (!planId || !recipeId || !batchNumber) {
    res.status(400).json({ error: "planId, recipeId, and batchNumber are required" });
    return;
  }
  const userId = (req.session as any)?.userId ?? null;
  try {
    await db.execute(sql`
      INSERT INTO packing_batch_records (plan_id, recipe_id, batch_number, user_id)
      VALUES (${planId}, ${recipeId}, ${batchNumber}, ${userId})
      ON CONFLICT (plan_id, recipe_id)
      DO UPDATE SET batch_number = ${batchNumber}, user_id = ${userId}, recorded_at = NOW()
    `);
    res.json({ ok: true });
  } catch (err) {
    console.error("packing-batch-record error:", err);
    res.status(500).json({ error: "Failed to save batch record" });
  }
});

export default router;
