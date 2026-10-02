/**
 * Test boxes API (Phase 1 of the test-box tool — memory project_test_box_tool).
 * Objectives A (a trial recipe reaches customers without "it silently didn't
 * get ordered" surprises), C (ingredients ordered in time, with a buffer) and
 * I (the founder and marketing see the whole run-up at a glance).
 *
 * Same access as Sales & Marketing: the founder, or anyone granted
 * "founder.sales". Every change is stamped with who made it, and the box's
 * marketing-calendar event moves with it (lib/test-box-data.ts).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, recipesTable, testBoxesTable, testBoxRecipesTable, testBoxTasksTable, usersTable, marketingEventsTable } from "@workspace/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { audienceLabel, loadBoxRecipes, scheduleForBox, syncTestBoxEvent } from "../lib/test-box-data";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const AUDIENCES = ["vip", "vip_then_public", "public"] as const;
const STATUSES = ["planning", "selling", "ordering", "producing", "delivered", "cancelled"] as const;
const MAX_RECIPES = 4;

type BoxRow = typeof testBoxesTable.$inferSelect;

async function sessionUser(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function boxJson(b: BoxRow, recipes: Array<{ id: number; name: string }>) {
  return {
    id: b.id,
    name: b.name,
    deliveryDate: b.deliveryDate,
    audience: b.audience,
    audienceLabel: audienceLabel(b.audience),
    status: b.status,
    notes: b.notes,
    bufferPct: b.bufferPct,
    bufferDays: b.bufferDays,
    sellingDays: b.sellingDays,
    ordersCloseDays: b.ordersCloseDays,
    vipHeadStartDays: b.vipHeadStartDays,
    expectedBoxes: b.expectedBoxes,
    recipes,
    createdBy: b.createdByName,
    updatedBy: b.updatedByName,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

async function fullBox(id: number) {
  const [box] = await db.select().from(testBoxesTable).where(eq(testBoxesTable.id, id));
  if (!box || box.deletedAt) return null;
  const recipes = (await loadBoxRecipes(db, [id])).get(id) ?? [];
  const schedule = await scheduleForBox(db, box, recipes);
  const ticks = await db.select().from(testBoxTasksTable).where(eq(testBoxTasksTable.testBoxId, id));
  const tickByKey = new Map(ticks.map(t => [t.taskKey, t]));
  const [event] = await db.select({ id: marketingEventsTable.id }).from(marketingEventsTable)
    .where(and(eq(marketingEventsTable.testBoxId, id), isNull(marketingEventsTable.deletedAt)));
  return {
    box: boxJson(box, recipes),
    schedule: {
      ...schedule,
      tasks: schedule.tasks.map(t => {
        const tick = tickByKey.get(t.key);
        return { ...t, done: tick?.done ?? false, doneBy: tick?.done ? tick.doneByName : null, doneAt: tick?.done && tick.doneAt ? tick.doneAt.toISOString() : null };
      }),
    },
    calendarEventId: event?.id ?? null,
  };
}

// ── List ───────────────────────────────────────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  const boxes = await db.select().from(testBoxesTable)
    .where(isNull(testBoxesTable.deletedAt))
    .orderBy(desc(testBoxesTable.deliveryDate), desc(testBoxesTable.id));
  const recipes = await loadBoxRecipes(db, boxes.map(b => b.id));
  const ticks = boxes.length
    ? await db.select().from(testBoxTasksTable).where(eq(testBoxTasksTable.done, true))
    : [];
  const out = [];
  for (const b of boxes) {
    const r = recipes.get(b.id) ?? [];
    const schedule = await scheduleForBox(db, b, r);
    const done = new Set(ticks.filter(t => t.testBoxId === b.id).map(t => t.taskKey));
    const open = schedule.tasks.filter(t => !done.has(t.key));
    out.push({
      ...boxJson(b, r),
      sellingStart: schedule.sellingStart,
      ordersClose: schedule.ordersClose,
      productionDate: schedule.productionDate,
      tasksDone: schedule.tasks.length - open.length,
      tasksTotal: schedule.tasks.length,
      nextTask: open[0] ? { label: open[0].label, date: open[0].date, time: open[0].time ?? null, past: open[0].past } : null,
      overdue: open.filter(t => t.past).length,
    });
  }
  res.json({ boxes: out });
});

// ── Recipes to pick from ───────────────────────────────────────────────────
router.get("/recipe-options", async (_req: Request, res: Response) => {
  // Archived recipes (migration 0141) aren't offered; a box that already
  // has one keeps showing it (names come from the box itself). Drafts (0142)
  // ARE offered, flagged isDraft: a test box is how a draft gets trialled.
  const rows = await db.select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category, isDraft: recipesTable.isDraft })
    .from(recipesTable).where(isNull(recipesTable.archivedAt)).orderBy(asc(recipesTable.name));
  res.json({ recipes: rows });
});

// ── One box: settings, schedule, to-do list ────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const full = await fullBox(id);
  if (!full) { res.status(404).json({ error: "Test box not found" }); return; }
  res.json(full);
});

// ── Create ─────────────────────────────────────────────────────────────────
const Settings = {
  audience: z.enum(AUDIENCES).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().trim().max(10000).nullish(),
  bufferPct: z.number().int().min(0).max(200).optional(),
  bufferDays: z.number().int().min(0).max(15).optional(),
  sellingDays: z.number().int().min(1).max(120).optional(),
  ordersCloseDays: z.number().int().min(0).max(20).optional(),
  vipHeadStartDays: z.number().int().min(0).max(60).optional(),
  expectedBoxes: z.number().int().min(0).max(100000).nullish(),
  recipeIds: z.array(z.number().int().positive()).max(MAX_RECIPES, `A test box has at most ${MAX_RECIPES} recipes`).optional(),
};

const CreateBody = z.object({
  name: z.string().trim().min(1, "Give the box a name").max(120),
  deliveryDate: IsoDate,
  ...Settings,
});

async function setRecipes(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], boxId: number, recipeIds: number[]) {
  await tx.delete(testBoxRecipesTable).where(eq(testBoxRecipesTable.testBoxId, boxId));
  const unique = [...new Set(recipeIds)];
  if (unique.length) {
    await tx.insert(testBoxRecipesTable).values(unique.map((recipeId, position) => ({ testBoxId: boxId, recipeId, position })));
  }
}

router.post("/", validate(CreateBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof CreateBody>;
  const user = await sessionUser(req);
  const id = await db.transaction(async (tx) => {
    const [box] = await tx.insert(testBoxesTable).values({
      name: b.name, deliveryDate: b.deliveryDate,
      audience: b.audience ?? "vip_then_public", status: b.status ?? "planning", notes: b.notes || null,
      ...(b.bufferPct !== undefined ? { bufferPct: b.bufferPct } : {}),
      ...(b.bufferDays !== undefined ? { bufferDays: b.bufferDays } : {}),
      ...(b.sellingDays !== undefined ? { sellingDays: b.sellingDays } : {}),
      ...(b.ordersCloseDays !== undefined ? { ordersCloseDays: b.ordersCloseDays } : {}),
      ...(b.vipHeadStartDays !== undefined ? { vipHeadStartDays: b.vipHeadStartDays } : {}),
      expectedBoxes: b.expectedBoxes ?? null,
      createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
    }).returning();
    await setRecipes(tx, box.id, b.recipeIds ?? []);
    const recipes = (await loadBoxRecipes(tx, [box.id])).get(box.id) ?? [];
    await syncTestBoxEvent(tx, box, await scheduleForBox(tx, box, recipes), user);
    return box.id;
  });
  res.status(201).json(await fullBox(id));
});

// ── Edit (autosave from the page) ──────────────────────────────────────────
const PatchBody = z.object({
  name: z.string().trim().min(1, "The name can't be empty").max(120).optional(),
  deliveryDate: IsoDate.optional(),
  ...Settings,
});

router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PatchBody>;
  const user = await sessionUser(req);
  const ok = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, id)).for("update");
    if (!before || before.deletedAt) return false;
    const [box] = await tx.update(testBoxesTable).set({
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.deliveryDate !== undefined ? { deliveryDate: b.deliveryDate } : {}),
      ...(b.audience !== undefined ? { audience: b.audience } : {}),
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      ...(b.bufferPct !== undefined ? { bufferPct: b.bufferPct } : {}),
      ...(b.bufferDays !== undefined ? { bufferDays: b.bufferDays } : {}),
      ...(b.sellingDays !== undefined ? { sellingDays: b.sellingDays } : {}),
      ...(b.ordersCloseDays !== undefined ? { ordersCloseDays: b.ordersCloseDays } : {}),
      ...(b.vipHeadStartDays !== undefined ? { vipHeadStartDays: b.vipHeadStartDays } : {}),
      ...(b.expectedBoxes !== undefined ? { expectedBoxes: b.expectedBoxes ?? null } : {}),
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(testBoxesTable.id, id)).returning();
    if (b.recipeIds !== undefined) await setRecipes(tx, id, b.recipeIds);
    const recipes = (await loadBoxRecipes(tx, [id])).get(id) ?? [];
    await syncTestBoxEvent(tx, box, await scheduleForBox(tx, box, recipes), user);
    return true;
  });
  if (!ok) { res.status(404).json({ error: "Test box not found (it may have been deleted)" }); return; }
  res.json(await fullBox(id));
});

// ── Tick a to-do item ──────────────────────────────────────────────────────
const TickBody = z.object({ done: z.boolean() });

router.put("/:id/tasks/:key", validate(TickBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  const key = String(req.params["key"] ?? "");
  if (!id || !/^[a-z0-9-]{1,60}$/.test(key)) { res.status(400).json({ error: "Invalid task" }); return; }
  const { done } = req.body as z.infer<typeof TickBody>;
  const [box] = await db.select({ id: testBoxesTable.id, deletedAt: testBoxesTable.deletedAt }).from(testBoxesTable).where(eq(testBoxesTable.id, id));
  if (!box || box.deletedAt) { res.status(404).json({ error: "Test box not found" }); return; }
  const user = await sessionUser(req);
  const values = { done, doneById: done ? user.id : null, doneByName: done ? user.name : null, doneAt: done ? new Date() : null };
  const [row] = await db.insert(testBoxTasksTable).values({ testBoxId: id, taskKey: key, ...values })
    .onConflictDoUpdate({ target: [testBoxTasksTable.testBoxId, testBoxTasksTable.taskKey], set: values })
    .returning();
  res.json({ key, done: row.done, doneBy: row.doneByName, doneAt: row.doneAt?.toISOString() ?? null });
});

// ── Delete (soft; its calendar event comes off too) ────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const ok = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, id)).for("update");
    if (!before || before.deletedAt) return false;
    const [box] = await tx.update(testBoxesTable).set({
      deletedAt: new Date(), deletedById: user.id, deletedByName: user.name,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(testBoxesTable.id, id)).returning();
    const recipes = (await loadBoxRecipes(tx, [id])).get(id) ?? [];
    await syncTestBoxEvent(tx, box, await scheduleForBox(tx, box, recipes), user);
    return true;
  });
  if (!ok) { res.status(404).json({ error: "Test box not found" }); return; }
  res.json({ ok: true });
});

export default router;
