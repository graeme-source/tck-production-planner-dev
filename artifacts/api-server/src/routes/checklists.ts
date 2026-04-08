import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  checklistTemplatesTable,
  checklistCompletionsTable,
  checklistOneoffItemsTable,
  productionPlansTable,
  temperatureRecordsTable,
  ovenEventsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import * as z from "zod";

type ChecklistCompletion = typeof checklistCompletionsTable.$inferSelect;

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
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

// Shared checklists: building_1 and building_2 share one checklist stored under building_1
const SHARED_CHECKLIST_STATIONS: Record<string, string> = {
  building_2: "building_1",
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
  description: z.string().optional(),
  schedule: z.enum(["daily", "weekly", "specific_days"]).default("daily"),
  scheduleDays: z.array(z.string()).optional(),
  orderPosition: z.number().int().optional(),
  dynamicDataType: z.string().nullable().optional(),
});

router.get("/templates", async (req: Request, res: Response) => {
  const station = req.query.station as string | undefined;
  const where = station ? eq(checklistTemplatesTable.stationType, station) : undefined;
  const rows = await db.select().from(checklistTemplatesTable)
    .where(where)
    .orderBy(asc(checklistTemplatesTable.category), asc(checklistTemplatesTable.orderPosition));
  res.json(rows);
});

router.post("/templates", requireAdmin, async (req: Request, res: Response) => {
  const parsed = CreateTemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const { scheduleDays, ...rest } = parsed.data;
  const [row] = await db.insert(checklistTemplatesTable).values({
    ...rest,
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

router.put("/templates/:id", requireAdmin, async (req: Request, res: Response) => {
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

router.delete("/templates/:id", requireAdmin, async (req: Request, res: Response) => {
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

router.patch("/templates/reorder", requireAdmin, async (req: Request, res: Response) => {
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

  res.status(400).json({ error: `Unknown dynamic data type: ${type}` });
});

export default router;
