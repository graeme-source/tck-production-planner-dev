/**
 * Test boxes API (memory project_test_box_tool; reworked 2026-10-02).
 * Objectives A (a trial recipe reaches customers without "it silently didn't
 * get ordered" surprises), C (ingredients — specialist ones especially —
 * ordered in time for every delivery) and I (the founder and marketing see
 * the whole run-up on the calendar and in their to-do lists).
 *
 * A box: a VIP launch date (first sale), an optional public launch date, an
 * owner, recipes, buffers; one or more delivery dates added over time, each
 * closed BY HAND. Deadlines are computed on read (lib/test-box-schedule.ts);
 * the calendar bar, the planned launch email + social note and the owner's
 * to-dos are kept in step by syncTestBox (lib/test-box-data.ts) inside the
 * same transaction as every change. Nothing here calls Shopify, Zapiet or
 * Klaviyo, and no email is sent.
 *
 * Same access as Sales & Marketing: the founder, or anyone granted
 * "founder.sales". Every change is stamped with who made it.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db, recipesTable, testBoxesTable, testBoxRecipesTable, testBoxTasksTable, testBoxDeliveriesTable, usersTable, marketingEventsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import {
  loadBoxDeliveries, loadBoxRecipes, loadDoneKeys, loadSupplierLeads, londonToday, scheduleFrom, syncTestBox,
  type Actor, type DeliveryRow, type TestBoxRow, type Tx,
} from "../lib/test-box-data";
import { setDeliveryClosed, tickTestBoxTask } from "../lib/test-box-todos";
import { salesAreaPeople } from "../lib/sales-area-people";
import {
  DELIVERY_STATUSES, PRODUCTION_MIXES, QUEUE_AHEAD_DAYS, SPECIALIST_EXTRA_WORKING_DAYS, VIP_GUARANTEE_HOURS,
  allTasks, deliveryTaskKey, type ScheduleTask, type TestBoxSchedule,
} from "../lib/test-box-schedule";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const STATUSES = ["planning", "selling", "ordering", "producing", "delivered", "cancelled"] as const;
const MAX_RECIPES = 4;

async function sessionUser(req: Request): Promise<Actor> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

function idParam(req: Request, name = "id"): number | null {
  const id = Number(req.params[name]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function ownerNames(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, unique));
  return new Map(rows.map(r => [r.id, r.name]));
}

function boxJson(b: TestBoxRow, recipes: Array<{ id: number; name: string; isDraft: boolean }>, owners: Map<number, string>) {
  const ownerId = b.ownerId ?? b.createdById;
  return {
    id: b.id,
    name: b.name,
    launchDate: b.launchDate,
    publicLaunchDate: b.publicLaunchDate,
    owner: ownerId != null ? { id: ownerId, name: owners.get(ownerId) ?? b.createdByName ?? "Someone" } : null,
    status: b.status,
    notes: b.notes,
    bufferPct: b.bufferPct,
    bufferDays: b.bufferDays,
    ordersCloseDays: b.ordersCloseDays,
    expectedBoxes: b.expectedBoxes,
    recipes,
    launchEmailId: b.launchEmailId,
    // What the launch steps made in Shopify (routes/test-box-shopify.ts).
    shopifyCollectionId: b.shopifyCollectionId,
    discountCode: b.discountCode,
    discountEndsOn: b.discountEndsOn,
    socialNoteEventId: b.socialNoteEventId,
    createdBy: b.createdByName,
    updatedBy: b.updatedByName,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

type Tick = typeof testBoxTasksTable.$inferSelect;
function withTick(t: ScheduleTask, ticks: Map<string, Tick>) {
  const tick = ticks.get(t.key);
  return {
    ...t,
    done: tick?.done ?? false,
    doneBy: tick?.done ? tick.doneByName : null,
    doneAt: tick?.done && tick.doneAt ? tick.doneAt.toISOString() : null,
    todoId: tick?.todoTaskId ?? null,
  };
}

function scheduleJson(s: TestBoxSchedule, deliveries: DeliveryRow[], ticks: Map<string, Tick>) {
  const rows = new Map(deliveries.map(d => [d.id, d]));
  return {
    launchDate: s.launchDate,
    publicLaunchDate: s.publicLaunchDate,
    vipWindowEnds: s.vipWindowEnds,
    vipGuaranteeHours: VIP_GUARANTEE_HOURS,
    specialistExtraDays: SPECIALIST_EXTRA_WORKING_DAYS,
    queueAheadDays: QUEUE_AHEAD_DAYS,
    tightTimeline: s.tightTimeline,
    warnings: s.warnings,
    launchTasks: s.launchTasks.map(t => withTick(t, ticks)),
    deliveries: s.deliveries.map(d => {
      const row = rows.get(d.id);
      return {
        ...d,
        closedBy: row?.closedByName ?? null,
        closedAt: row?.closedAt?.toISOString() ?? null,
        tasks: d.tasks.map(t => withTick(t, ticks)),
      };
    }),
  };
}

async function fullBox(id: number) {
  const [box] = await db.select().from(testBoxesTable).where(eq(testBoxesTable.id, id));
  if (!box || box.deletedAt) return null;
  const recipes = (await loadBoxRecipes(db, [id])).get(id) ?? [];
  const deliveries = (await loadBoxDeliveries(db, [id])).get(id) ?? [];
  const suppliers = await loadSupplierLeads(db, recipes.map(r => r.id));
  const tickRows = await db.select().from(testBoxTasksTable).where(eq(testBoxTasksTable.testBoxId, id));
  const ticks = new Map(tickRows.map(t => [t.taskKey, t]));
  const schedule = scheduleFrom(box, recipes, deliveries, suppliers, tickRows.filter(t => t.done).map(t => t.taskKey));
  const [event] = await db.select({ id: marketingEventsTable.id }).from(marketingEventsTable)
    .where(and(eq(marketingEventsTable.testBoxId, id), isNull(marketingEventsTable.deletedAt)));
  const owners = await ownerNames([box.ownerId ?? box.createdById].filter((x): x is number => x != null));
  return {
    today: londonToday(),
    box: boxJson(box, recipes, owners),
    schedule: scheduleJson(schedule, deliveries, ticks),
    calendarEventId: event?.id ?? null,
  };
}

// ── List ───────────────────────────────────────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  const boxes = await db.select().from(testBoxesTable)
    .where(isNull(testBoxesTable.deletedAt))
    .orderBy(desc(testBoxesTable.launchDate), desc(testBoxesTable.id));
  const ids = boxes.map(b => b.id);
  const recipes = await loadBoxRecipes(db, ids);
  const deliveries = await loadBoxDeliveries(db, ids);
  const owners = await ownerNames(boxes.map(b => b.ownerId ?? b.createdById).filter((x): x is number => x != null));
  const out = [];
  for (const b of boxes) {
    const r = recipes.get(b.id) ?? [];
    const ds = deliveries.get(b.id) ?? [];
    const done = await loadDoneKeys(db, b.id);
    const schedule = scheduleFrom(b, r, ds, await loadSupplierLeads(db, r.map(x => x.id)), done);
    const doneSet = new Set(done);
    const tasks = allTasks(schedule);
    const open = tasks.filter(t => !doneSet.has(t.key)).sort((a, c) => a.date.localeCompare(c.date));
    out.push({
      ...boxJson(b, r, owners),
      deliveries: schedule.deliveries.map(d => ({ id: d.id, deliveryDate: d.deliveryDate, status: d.status, latestClose: d.latestClose })),
      tasksDone: tasks.length - open.length,
      tasksTotal: tasks.length,
      nextTask: open[0] ? { label: open[0].label, date: open[0].date, time: open[0].time ?? null, past: open[0].past } : null,
      overdue: open.filter(t => t.past).length,
    });
  }
  res.json({ boxes: out });
});

// ── Pickers ────────────────────────────────────────────────────────────────
router.get("/recipe-options", async (_req: Request, res: Response) => {
  // Archived recipes (migration 0141) aren't offered; a box that already
  // has one keeps showing it (names come from the box itself). Drafts (0142)
  // ARE offered, flagged isDraft: a test box is how a draft gets trialled.
  const rows = await db.select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category, isDraft: recipesTable.isDraft })
    .from(recipesTable).where(isNull(recipesTable.archivedAt)).orderBy(asc(recipesTable.name));
  res.json({ recipes: rows });
});

/** Who can own a box: people who can open this page (their to-dos link here). */
router.get("/owner-options", async (_req: Request, res: Response) => {
  res.json({ people: await salesAreaPeople() });
});

// ── One box ────────────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const full = await fullBox(id);
  if (!full) { res.status(404).json({ error: "Test box not found" }); return; }
  res.json(full);
});

// ── Create ─────────────────────────────────────────────────────────────────
const Settings = {
  publicLaunchDate: IsoDate.nullish(),
  ownerId: z.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().trim().max(10000).nullish(),
  bufferPct: z.number().int().min(0).max(200).optional(),
  bufferDays: z.number().int().min(0).max(15).optional(),
  ordersCloseDays: z.number().int().min(0).max(20).optional(),
  expectedBoxes: z.number().int().min(0).max(100000).nullish(),
  recipeIds: z.array(z.number().int().positive()).max(MAX_RECIPES, `A test box has at most ${MAX_RECIPES} recipes`).optional(),
};

const CreateBody = z.object({
  name: z.string().trim().min(1, "Give the box a name").max(120),
  launchDate: IsoDate,
  firstDeliveryDate: IsoDate.optional(),
  ...Settings,
}).refine(b => !b.publicLaunchDate || b.publicLaunchDate >= b.launchDate, { message: "The public launch can't be before the VIP launch" })
  .refine(b => !b.firstDeliveryDate || b.firstDeliveryDate > b.launchDate, { message: "The delivery date must be after the launch" });

async function setRecipes(tx: Tx, boxId: number, recipeIds: number[]) {
  await tx.delete(testBoxRecipesTable).where(eq(testBoxRecipesTable.testBoxId, boxId));
  const unique = [...new Set(recipeIds)];
  if (unique.length) {
    await tx.insert(testBoxRecipesTable).values(unique.map((recipeId, position) => ({ testBoxId: boxId, recipeId, position })));
  }
}

async function ownerAllowed(ownerId: number): Promise<boolean> {
  return (await salesAreaPeople()).some(p => p.id === ownerId);
}

const OWNER_REFUSED = "That person can't open Test boxes, so the to-dos would point somewhere they can't go — give them Sales & Marketing access first.";

router.post("/", validate(CreateBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof CreateBody>;
  const user = await sessionUser(req);
  if (b.ownerId != null && b.ownerId !== user.id && !(await ownerAllowed(b.ownerId))) {
    res.status(400).json({ error: OWNER_REFUSED }); return;
  }
  const id = await db.transaction(async (tx) => {
    const [box] = await tx.insert(testBoxesTable).values({
      name: b.name, launchDate: b.launchDate, publicLaunchDate: b.publicLaunchDate ?? null,
      ownerId: b.ownerId ?? user.id,
      status: b.status ?? "planning", notes: b.notes || null,
      ...(b.bufferPct !== undefined ? { bufferPct: b.bufferPct } : {}),
      ...(b.bufferDays !== undefined ? { bufferDays: b.bufferDays } : {}),
      ...(b.ordersCloseDays !== undefined ? { ordersCloseDays: b.ordersCloseDays } : {}),
      expectedBoxes: b.expectedBoxes ?? null,
      createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
    }).returning();
    await setRecipes(tx, box.id, b.recipeIds ?? []);
    if (b.firstDeliveryDate) {
      await tx.insert(testBoxDeliveriesTable).values({
        testBoxId: box.id, deliveryDate: b.firstDeliveryDate, expectedBoxes: b.expectedBoxes ?? null,
        createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
      });
    }
    await syncTestBox(tx, box.id, user);
    return box.id;
  });
  res.status(201).json(await fullBox(id));
});

// ── Edit (autosave from the page) ──────────────────────────────────────────
const PatchBody = z.object({
  name: z.string().trim().min(1, "The name can't be empty").max(120).optional(),
  launchDate: IsoDate.optional(),
  ...Settings,
});

router.patch("/:id", validate(PatchBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PatchBody>;
  const user = await sessionUser(req);
  if (b.ownerId != null && b.ownerId !== user.id && !(await ownerAllowed(b.ownerId))) {
    res.status(400).json({ error: OWNER_REFUSED }); return;
  }
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, id)).for("update");
    if (!before || before.deletedAt) return { status: 404 as const };
    const launch = b.launchDate ?? before.launchDate;
    const pub = b.publicLaunchDate !== undefined ? b.publicLaunchDate : before.publicLaunchDate;
    if (pub && pub < launch) return { status: 400 as const, error: "The public launch can't be before the VIP launch" };
    await tx.update(testBoxesTable).set({
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.launchDate !== undefined ? { launchDate: b.launchDate } : {}),
      ...(b.publicLaunchDate !== undefined ? { publicLaunchDate: b.publicLaunchDate ?? null } : {}),
      ...(b.ownerId !== undefined ? { ownerId: b.ownerId } : {}),
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
      ...(b.bufferPct !== undefined ? { bufferPct: b.bufferPct } : {}),
      ...(b.bufferDays !== undefined ? { bufferDays: b.bufferDays } : {}),
      ...(b.ordersCloseDays !== undefined ? { ordersCloseDays: b.ordersCloseDays } : {}),
      ...(b.expectedBoxes !== undefined ? { expectedBoxes: b.expectedBoxes ?? null } : {}),
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(testBoxesTable.id, id));
    if (b.recipeIds !== undefined) await setRecipes(tx, id, b.recipeIds);
    await syncTestBox(tx, id, user);
    const previousOwner = before.ownerId ?? before.createdById;
    if (b.ownerId !== undefined && b.ownerId !== previousOwner && b.ownerId !== user.id) {
      await tx.execute(sql`
        INSERT INTO notifications (user_id, type, message, read)
        VALUES (${b.ownerId}, 'todo', ${`${user.name} made you the owner of the test box “${b.name ?? before.name}” — its checklist is on your to-do list.`.slice(0, 500)}, false)
      `);
    }
    return { status: 200 as const };
  });
  if (result.status === 404) { res.status(404).json({ error: "Test box not found (it may have been deleted)" }); return; }
  if (result.status === 400) { res.status(400).json({ error: result.error }); return; }
  res.json(await fullBox(id));
});

// ── Delivery dates ─────────────────────────────────────────────────────────
async function lockBox(tx: Tx, id: number): Promise<TestBoxRow | null> {
  const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, id)).for("update");
  return box && !box.deletedAt ? box : null;
}
async function deliveryOf(tx: Tx, boxId: number, deliveryId: number): Promise<DeliveryRow | null> {
  const [d] = await tx.select().from(testBoxDeliveriesTable)
    .where(and(eq(testBoxDeliveriesTable.id, deliveryId), eq(testBoxDeliveriesTable.testBoxId, boxId)));
  return d && !d.deletedAt ? d : null;
}
async function touchBox(tx: Tx, id: number, user: Actor) {
  await tx.update(testBoxesTable).set({ updatedById: user.id, updatedByName: user.name, updatedAt: new Date() }).where(eq(testBoxesTable.id, id));
}
async function dateTaken(tx: Tx, boxId: number, date: string, exceptId?: number): Promise<boolean> {
  const rows = await tx.select({ id: testBoxDeliveriesTable.id }).from(testBoxDeliveriesTable)
    .where(and(eq(testBoxDeliveriesTable.testBoxId, boxId), eq(testBoxDeliveriesTable.deliveryDate, date), isNull(testBoxDeliveriesTable.deletedAt)));
  return rows.some(r => r.id !== exceptId);
}

const AddDeliveryBody = z.object({
  deliveryDate: IsoDate,
  expectedBoxes: z.number().int().min(0).max(100000).nullish(),
});

router.post("/:id/deliveries", validate(AddDeliveryBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof AddDeliveryBody>;
  const user = await sessionUser(req);
  const r = await db.transaction(async (tx) => {
    const box = await lockBox(tx, id);
    if (!box) return 404;
    if (b.deliveryDate <= box.launchDate) return 400;
    if (await dateTaken(tx, id, b.deliveryDate)) return 409;
    await tx.insert(testBoxDeliveriesTable).values({
      testBoxId: id, deliveryDate: b.deliveryDate, expectedBoxes: b.expectedBoxes ?? box.expectedBoxes ?? null,
      createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
    });
    await touchBox(tx, id, user);
    await syncTestBox(tx, id, user);
    return 201;
  });
  if (r === 404) { res.status(404).json({ error: "Test box not found" }); return; }
  if (r === 400) { res.status(400).json({ error: "A delivery date has to be after the launch" }); return; }
  if (r === 409) { res.status(409).json({ error: "This box already has that delivery date" }); return; }
  res.status(201).json(await fullBox(id));
});

const PatchDeliveryBody = z.object({
  deliveryDate: IsoDate.optional(),
  expectedBoxes: z.number().int().min(0).max(100000).nullish(),
  status: z.enum(DELIVERY_STATUSES).optional(),
  productionMix: z.enum(PRODUCTION_MIXES).nullish(),
});

router.patch("/:id/deliveries/:deliveryId", validate(PatchDeliveryBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  const deliveryId = idParam(req, "deliveryId");
  if (!id || !deliveryId) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PatchDeliveryBody>;
  const user = await sessionUser(req);
  const r = await db.transaction(async (tx) => {
    const box = await lockBox(tx, id);
    if (!box) return 404;
    const d = await deliveryOf(tx, id, deliveryId);
    if (!d) return 404;
    if (b.deliveryDate !== undefined) {
      if (b.deliveryDate <= box.launchDate) return 400;
      if (await dateTaken(tx, id, b.deliveryDate, d.id)) return 409;
    }
    // Closing / reopening goes through the same path as the button.
    if (b.status === "closed" && d.status === "open") await setDeliveryClosed(tx, d, true, user);
    if (b.status === "open" && d.status === "closed") await setDeliveryClosed(tx, d, false, user);
    const statusDirect = b.status !== undefined && !(b.status === "closed" && d.status === "open") && !(b.status === "open" && d.status === "closed");
    await tx.update(testBoxDeliveriesTable).set({
      ...(b.deliveryDate !== undefined ? { deliveryDate: b.deliveryDate } : {}),
      ...(b.expectedBoxes !== undefined ? { expectedBoxes: b.expectedBoxes ?? null } : {}),
      ...(statusDirect ? { status: b.status, ...(b.status === "open" ? { closedAt: null, closedById: null, closedByName: null } : {}) } : {}),
      ...(statusDirect && b.status !== "open" && b.status !== "cancelled" && d.closedAt == null ? { closedAt: new Date(), closedById: user.id, closedByName: user.name } : {}),
      ...(b.productionMix !== undefined ? { productionMix: b.productionMix ?? null } : {}),
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(testBoxDeliveriesTable.id, d.id));
    if (b.status !== undefined) await tickTestBoxTask(tx, id, deliveryTaskKey(d.id, "close-orders"), b.status !== "open", user);
    // Choosing test-only / test + normal IS the decision — tick it.
    if (b.productionMix !== undefined) await tickTestBoxTask(tx, id, deliveryTaskKey(d.id, "decide-mix"), b.productionMix != null, user);
    await touchBox(tx, id, user);
    await syncTestBox(tx, id, user);
    return 200;
  });
  if (r === 404) { res.status(404).json({ error: "Delivery date not found (it may have been removed)" }); return; }
  if (r === 400) { res.status(400).json({ error: "A delivery date has to be after the launch" }); return; }
  if (r === 409) { res.status(409).json({ error: "This box already has that delivery date" }); return; }
  res.json(await fullBox(id));
});

const CloseBody = z.object({ closed: z.boolean() });

/** "Close orders for 16 Oct" (or reopen them). Ticks the close step and
 *  unlocks Zapiet-off, queue production and the test/normal decision. */
router.post("/:id/deliveries/:deliveryId/close", validate(CloseBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  const deliveryId = idParam(req, "deliveryId");
  if (!id || !deliveryId) { res.status(400).json({ error: "Invalid id" }); return; }
  const { closed } = req.body as z.infer<typeof CloseBody>;
  const user = await sessionUser(req);
  const r = await db.transaction(async (tx) => {
    const box = await lockBox(tx, id);
    if (!box) return 404;
    const d = await deliveryOf(tx, id, deliveryId);
    if (!d) return 404;
    const changed = await setDeliveryClosed(tx, d, closed, user);
    if (!changed) return 409;
    await tickTestBoxTask(tx, id, deliveryTaskKey(d.id, "close-orders"), closed, user);
    await touchBox(tx, id, user);
    await syncTestBox(tx, id, user);
    return 200;
  });
  if (r === 404) { res.status(404).json({ error: "Delivery date not found (it may have been removed)" }); return; }
  if (r === 409) { res.status(409).json({ error: closed ? "Orders for this date aren't open" : "Only a date that's closed (and not yet queued) can be reopened" }); return; }
  res.json(await fullBox(id));
});

router.delete("/:id/deliveries/:deliveryId", async (req: Request, res: Response) => {
  const id = idParam(req);
  const deliveryId = idParam(req, "deliveryId");
  if (!id || !deliveryId) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const ok = await db.transaction(async (tx) => {
    const box = await lockBox(tx, id);
    if (!box) return false;
    const d = await deliveryOf(tx, id, deliveryId);
    if (!d) return false;
    await tx.update(testBoxDeliveriesTable).set({
      deletedAt: new Date(), deletedById: user.id, deletedByName: user.name, updatedAt: new Date(),
    }).where(eq(testBoxDeliveriesTable.id, d.id));
    await touchBox(tx, id, user);
    await syncTestBox(tx, id, user);
    return true;
  });
  if (!ok) { res.status(404).json({ error: "Delivery date not found" }); return; }
  res.json(await fullBox(id));
});

// ── Tick a task (launch checklist or a delivery's chain) ───────────────────
const TickBody = z.object({ done: z.boolean() });
const TASK_KEY = /^(launch|d\d+):[a-z0-9-]{1,60}$/;

router.put("/:id/tasks/:key", validate(TickBody), async (req: Request, res: Response) => {
  const id = idParam(req);
  const key = String(req.params["key"] ?? "");
  if (!id || !TASK_KEY.test(key)) { res.status(400).json({ error: "Invalid task" }); return; }
  const { done } = req.body as z.infer<typeof TickBody>;
  const user = await sessionUser(req);
  const r = await db.transaction(async (tx) => {
    const box = await lockBox(tx, id);
    if (!box) return 404;
    // Ticking "Close orders" closes them (and unticking reopens).
    const m = /^d(\d+):close-orders$/.exec(key);
    if (m) {
      const d = await deliveryOf(tx, id, Number(m[1]));
      if (d) await setDeliveryClosed(tx, d, done, user);
    }
    await tickTestBoxTask(tx, id, key, done, user);
    await syncTestBox(tx, id, user);
    return 200;
  });
  if (r === 404) { res.status(404).json({ error: "Test box not found" }); return; }
  res.json(await fullBox(id));
});

// ── Delete (soft; calendar bar, planned email, note and open to-dos come off) ─
router.delete("/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const ok = await db.transaction(async (tx) => {
    const box = await lockBox(tx, id);
    if (!box) return false;
    await tx.update(testBoxesTable).set({
      deletedAt: new Date(), deletedById: user.id, deletedByName: user.name,
      updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
    }).where(eq(testBoxesTable.id, id));
    await syncTestBox(tx, id, user);
    return true;
  });
  if (!ok) { res.status(404).json({ error: "Test box not found" }); return; }
  res.json({ ok: true });
});

export default router;
