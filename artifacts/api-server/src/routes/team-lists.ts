/**
 * Team lists (Graeme, 2026-10-13). Objectives G (management sees at a glance
 * whether the day's routines are done) and F (one tap, nothing lost).
 *
 * Shared recurring lists that belong to a role, not a person — the
 * Production Planner's daily list, the Scheduling Manager's weekly one. If
 * the usual person is off, anyone ticked on the list opens it and ticks it
 * as themselves. NOT shown on station screens.
 *
 *   GET    /                    lists I can open, with today's progress
 *   GET    /people              every active person, for "Who can use this list"
 *   POST   /                    new list (managers/admins)
 *   GET    /:id                 one list: items, today's view, coming up
 *   PATCH  /:id                 rename, members, archive / restore
 *   POST   /:id/items           add a task
 *   POST   /:id/reorder         set the list's own order
 *   POST   /:id/import          Todoist "Export as template" CSV
 *   PATCH  /items/:itemId       edit a task (active: false removes it)
 *   POST   /items/:itemId/tick  done / skipped for an occurrence
 *   POST   /items/:itemId/untick
 *
 * Access (lib/team-lists-day.ts, Graeme 2026-10-14 — "if I tick, you've got
 * access"): admins always; anyone else, any role, only when ticked on the
 * list. Everyone who can open a list can tick / skip / undo its tasks;
 * changing the list itself (name, tasks, people, archive, import) is for
 * managers and admins who can open it (canEditList). Enforced here on every
 * endpoint. The rules for what shows today are pure and tested there too.
 */
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, usersTable, teamListsTable, teamListItemsTable, teamListCompletionsTable,
  type TeamList, type TeamListItem,
} from "@workspace/db";
import { isDailyRhythm, normaliseRule, sameRule, type RecurrenceRule } from "@workspace/recurrence";
import { rawBody, validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import {
  buildDay, canAccessList, canCreateList, canEditList, canTickOccurrence, comingUp, membersForNewList,
  occurrencesToLoad, teamListsVisible,
  type DayCompletion, type DayItem, type ListAccessUser,
} from "../lib/team-lists-day";
import { parseTodoistTemplate } from "../lib/todoist-import";

const router: IRouter = Router();

// Any signed-in person may ask; what they get is decided per list below.
async function requireSessionWithRole(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  await resolveRole(req); // fills req.session.userRole for older sessions
  next();
}
router.use(requireSessionWithRole);

function me(req: Request): ListAccessUser {
  return { id: req.session.userId!, role: req.session.userRole ?? "viewer" };
}

async function myName(req: Request): Promise<string | null> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
  return u?.name ?? null;
}

function intParam(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Validation ──────────────────────────────────────────────────────────────
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekday = z.number().int().min(0).max(6);
const recurrenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }),
  z.object({ kind: z.literal("weekdays") }),
  z.object({
    kind: z.literal("weekly"),
    days: z.array(weekday).min(1, "Pick at least one day").max(7),
    interval: z.number().int().min(1).max(52).optional(),
    anchor: isoDate.nullish(),
  }),
  z.object({ kind: z.literal("monthly"), dayOfMonth: z.number().int().min(1).max(31) }),
]);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform(v => (v ? v : null));
const urlField = z.string().trim().max(500).nullish()
  .refine(v => !v || /^(https?:\/\/|\/)/i.test(v), "Links start with https:// or / (a page in the app)")
  .transform(v => (v ? v : null));
const timeField = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time as HH:MM").nullish().transform(v => v ?? null);

const listBody = z.object({
  name: z.string().trim().min(1, "A name is needed").max(120),
  description: optionalText(1000),
  emoji: optionalText(16),
  color: optionalText(20),
  memberIds: z.array(z.number().int().positive()).max(100).default([]),
});
const listPatch = listBody.partial().extend({ archived: z.boolean().optional() });
const dedupe = (ids: number[]) => [...new Set(ids)];

const itemBody = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(300),
  notes: optionalText(4000),
  url: urlField,
  priority: z.number().int().min(1).max(4).default(4),
  recurrence: recurrenceSchema.default({ kind: "daily" }),
  timeOfDay: timeField,
  carryOver: z.boolean().optional(),
});
const itemPatch = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(300).optional(),
  notes: optionalText(4000),
  url: urlField,
  priority: z.number().int().min(1).max(4).optional(),
  recurrence: recurrenceSchema.optional(),
  timeOfDay: timeField.optional(),
  carryOver: z.boolean().optional(),
  active: z.boolean().optional(),
});
const tickBody = z.object({ dueDate: isoDate, status: z.enum(["done", "skipped"]).default("done") });
const untickBody = z.object({ dueDate: isoDate });
const reorderBody = z.object({ itemIds: z.array(z.number().int().positive()).min(1).max(500) });
const importBody = z.object({ csv: z.string().min(1).max(1_000_000) });

// ── Loading ────────────────────────────────────────────────────────────────
function toDayItem(i: TeamListItem): DayItem {
  return {
    id: i.id, priority: i.priority, timeOfDay: i.timeOfDay, sortOrder: i.sortOrder,
    recurrence: i.recurrence, carryOver: i.carryOver, startDate: i.startDate, active: i.active,
  };
}

async function loadCompletions(pairs: Array<{ itemId: number; dueDate: string }>): Promise<DayCompletion[]> {
  if (!pairs.length) return [];
  const ids = [...new Set(pairs.map(p => p.itemId))];
  const dates = [...new Set(pairs.map(p => p.dueDate))];
  const wanted = new Set(pairs.map(p => `${p.itemId}|${p.dueDate}`));
  const rows = await db.select().from(teamListCompletionsTable)
    .where(and(inArray(teamListCompletionsTable.itemId, ids), inArray(teamListCompletionsTable.dueDate, dates)));
  return rows
    .filter(r => wanted.has(`${r.itemId}|${r.dueDate}`))
    .map(r => ({ itemId: r.itemId, dueDate: r.dueDate, status: r.status, byName: r.byName, at: r.at, atDate: londonDateString(r.at) }));
}

/** "open" = see it and tick its tasks; "edit" = change the list itself. */
type Need = "open" | "edit";

async function listFor(req: Request, res: Response, id: number | null, need: Need): Promise<TeamList | null> {
  if (!id) { res.status(404).json({ error: "List not found" }); return null; }
  const [list] = await db.select().from(teamListsTable).where(eq(teamListsTable.id, id));
  if (!list) { res.status(404).json({ error: "List not found" }); return null; }
  if (!canAccessList(me(req), list)) { res.status(403).json({ error: "You haven't been given access to this list" }); return null; }
  if (need === "edit" && !canEditList(me(req), list)) {
    res.status(403).json({ error: "Only managers and admins can change this list — you can tick its tasks" });
    return null;
  }
  return list;
}

async function itemFor(req: Request, res: Response, need: Need): Promise<{ item: TeamListItem; list: TeamList } | null> {
  const id = intParam(req.params.itemId);
  if (!id) { res.status(404).json({ error: "Task not found" }); return null; }
  const [item] = await db.select().from(teamListItemsTable).where(eq(teamListItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Task not found" }); return null; }
  const list = await listFor(req, res, item.listId, need);
  return list ? { item, list } : null;
}

function requireCanCreate(req: Request, res: Response): boolean {
  if (canCreateList(me(req))) return true;
  res.status(403).json({ error: "Only managers and admins can do that" });
  return false;
}

function serialiseList(l: TeamList, user: ListAccessUser) {
  return {
    id: l.id, name: l.name, description: l.description, emoji: l.emoji, color: l.color,
    memberIds: l.memberIds ?? [], sortOrder: l.sortOrder, archived: l.archivedAt != null,
    canEdit: canEditList(user, l),
  };
}

function serialiseItem(i: TeamListItem) {
  return {
    id: i.id, listId: i.listId, title: i.title, notes: i.notes, url: i.url, priority: i.priority,
    recurrence: i.recurrence as RecurrenceRule, timeOfDay: i.timeOfDay, carryOver: i.carryOver,
    startDate: i.startDate, sortOrder: i.sortOrder, active: i.active,
  };
}

// ── Lists ───────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const today = londonDateString();
  const includeArchived = req.query.archived === "1";
  const all = await db.select().from(teamListsTable)
    .where(includeArchived ? undefined : isNull(teamListsTable.archivedAt))
    .orderBy(asc(teamListsTable.sortOrder), asc(teamListsTable.name));
  const lists = all.filter(l => canAccessList(me(req), l));
  const openActive = lists.filter(l => l.archivedAt == null).length;
  const ids = lists.map(l => l.id);
  const items = ids.length
    ? await db.select().from(teamListItemsTable).where(and(inArray(teamListItemsTable.listId, ids), eq(teamListItemsTable.active, true)))
    : [];
  const dayItems = items.map(toDayItem);
  const completions = await loadCompletions(occurrencesToLoad(dayItems, today));
  res.json({
    today,
    canCreate: canCreateList(me(req)),
    visible: teamListsVisible(me(req), openActive),
    lists: lists.map(l => {
      const mine = items.filter(i => i.listId === l.id).map(toDayItem);
      return { ...serialiseList(l, me(req)), itemCount: mine.length, progress: buildDay(mine, completions, today).progress };
    }),
  });
});

// Everyone active, any role (Graeme, 2026-10-14: "just have everyone
// available in the list"). Only for the people who can set members.
router.get("/people", async (req: Request, res: Response) => {
  if (!requireCanCreate(req, res)) return;
  const rows = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.isActive, true))
    .orderBy(asc(usersTable.name));
  res.json(rows);
});

router.post("/", validate(listBody), async (req: Request, res: Response) => {
  if (!requireCanCreate(req, res)) return;
  const body = req.body as z.infer<typeof listBody>;
  body.memberIds = membersForNewList(me(req), body.memberIds);
  const [{ next }] = (await db.execute<{ next: number }>(sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM team_lists`)).rows;
  const [row] = await db.insert(teamListsTable).values({
    ...body, sortOrder: Number(next) || 0, createdById: req.session.userId!,
  }).returning();
  res.status(201).json(serialiseList(row, me(req)));
});

router.get("/:id", async (req: Request, res: Response) => {
  const list = await listFor(req, res, intParam(req.params.id), "open");
  if (!list) return;
  const today = londonDateString();
  const items = await db.select().from(teamListItemsTable)
    .where(and(eq(teamListItemsTable.listId, list.id), eq(teamListItemsTable.active, true)))
    .orderBy(asc(teamListItemsTable.sortOrder), asc(teamListItemsTable.id));
  const dayItems = items.map(toDayItem);
  const completions = await loadCompletions(occurrencesToLoad(dayItems, today));
  const day = buildDay(dayItems, completions, today);
  res.json({
    today,
    list: serialiseList(list, me(req)),
    items: items.map(serialiseItem),
    entries: day.entries,
    progress: day.progress,
    comingUp: comingUp(dayItems, today, 7),
  });
});

router.patch("/:id", validate(listPatch), async (req: Request, res: Response) => {
  const list = await listFor(req, res, intParam(req.params.id), "edit");
  if (!list) return;
  const { archived, ...fields } = req.body as z.infer<typeof listPatch>;
  if (fields.memberIds) fields.memberIds = dedupe(fields.memberIds);
  const [row] = await db.update(teamListsTable).set({
    ...fields,
    ...(archived === undefined ? {} : archived
      ? { archivedAt: new Date(), archivedById: req.session.userId! }
      : { archivedAt: null, archivedById: null }),
    updatedAt: new Date(),
  }).where(eq(teamListsTable.id, list.id)).returning();
  res.json(serialiseList(row, me(req)));
});

// ── Items ───────────────────────────────────────────────────────────────────
router.post("/:id/items", validate(itemBody), async (req: Request, res: Response) => {
  const list = await listFor(req, res, intParam(req.params.id), "edit");
  if (!list) return;
  const body = req.body as z.infer<typeof itemBody>;
  const rule = normaliseRule(body.recurrence as RecurrenceRule);
  const [{ next }] = (await db.execute<{ next: number }>(
    sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM team_list_items WHERE list_id = ${list.id}`,
  )).rows;
  const [row] = await db.insert(teamListItemsTable).values({
    listId: list.id,
    title: body.title,
    notes: body.notes,
    url: body.url,
    priority: body.priority,
    recurrence: rule,
    timeOfDay: body.timeOfDay,
    carryOver: body.carryOver ?? !isDailyRhythm(rule),
    startDate: londonDateString(),
    sortOrder: Number(next) || 0,
    createdById: req.session.userId!,
  }).returning();
  res.status(201).json(serialiseItem(row));
});

router.post("/:id/reorder", validate(reorderBody), async (req: Request, res: Response) => {
  const list = await listFor(req, res, intParam(req.params.id), "edit");
  if (!list) return;
  const { itemIds } = req.body as z.infer<typeof reorderBody>;
  await db.transaction(async tx => {
    for (const [i, id] of itemIds.entries()) {
      await tx.update(teamListItemsTable).set({ sortOrder: i + 1, updatedAt: new Date() })
        .where(and(eq(teamListItemsTable.id, id), eq(teamListItemsTable.listId, list.id)));
    }
  });
  res.json({ ok: true });
});

router.post("/:id/import", validate(importBody), async (req: Request, res: Response) => {
  const list = await listFor(req, res, intParam(req.params.id), "edit");
  if (!list) return;
  const today = londonDateString();
  const parsed = parseTodoistTemplate((req.body as z.infer<typeof importBody>).csv, today);
  if (parsed.error) { res.status(400).json({ error: parsed.error }); return; }
  if (!parsed.items.length) { res.status(400).json({ error: "No tasks found in that file." }); return; }
  const [{ next }] = (await db.execute<{ next: number }>(
    sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM team_list_items WHERE list_id = ${list.id}`,
  )).rows;
  const rows = await db.insert(teamListItemsTable).values(parsed.items.map((it, i) => ({
    listId: list.id,
    title: it.title,
    notes: it.notes,
    priority: it.priority,
    recurrence: normaliseRule(it.recurrence),
    timeOfDay: it.timeOfDay,
    carryOver: !isDailyRhythm(it.recurrence),
    startDate: today,
    sortOrder: (Number(next) || 0) + i,
    createdById: req.session.userId!,
  }))).returning();
  res.status(201).json({
    created: rows.length,
    skipped: parsed.skipped,
    warnings: parsed.items
      .map((it, i) => (it.warning ? { itemId: rows[i]?.id, title: it.title, warning: it.warning } : null))
      .filter(Boolean),
  });
});

router.patch("/items/:itemId", validate(itemPatch), async (req: Request, res: Response) => {
  const found = await itemFor(req, res, "edit");
  if (!found) return;
  const body = req.body as z.infer<typeof itemPatch>;
  const updates: Partial<typeof teamListItemsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  // zod turns a missing notes/url into null, so ask what was actually sent.
  const sent = rawBody<Record<string, unknown>>(req);
  if ("notes" in sent) updates.notes = body.notes ?? null;
  if ("url" in sent) updates.url = body.url ?? null;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.timeOfDay !== undefined) updates.timeOfDay = body.timeOfDay;
  if (body.carryOver !== undefined) updates.carryOver = body.carryOver;
  if (body.active !== undefined) updates.active = body.active;
  if (body.recurrence !== undefined && !sameRule(body.recurrence as RecurrenceRule, found.item.recurrence as RecurrenceRule)) {
    updates.recurrence = normaliseRule(body.recurrence as RecurrenceRule);
    // A new rhythm starts today: no "overdue" from days the old rule chose.
    updates.startDate = londonDateString();
  }
  const [row] = await db.update(teamListItemsTable).set(updates).where(eq(teamListItemsTable.id, found.item.id)).returning();
  res.json(serialiseItem(row));
});

router.post("/items/:itemId/tick", validate(tickBody), async (req: Request, res: Response) => {
  const found = await itemFor(req, res, "open");
  if (!found) return;
  const { dueDate, status } = req.body as z.infer<typeof tickBody>;
  if (!canTickOccurrence(toDayItem(found.item), dueDate, londonDateString())) {
    res.status(409).json({ error: "That day's task has already moved on — refresh the list" });
    return;
  }
  const name = await myName(req);
  const [row] = await db.insert(teamListCompletionsTable)
    .values({ itemId: found.item.id, dueDate, status, byUserId: req.session.userId!, byName: name })
    .onConflictDoUpdate({
      target: [teamListCompletionsTable.itemId, teamListCompletionsTable.dueDate],
      set: { status, byUserId: req.session.userId!, byName: name, at: new Date() },
    })
    .returning();
  res.json({ itemId: row.itemId, dueDate: row.dueDate, status: row.status, byName: row.byName, at: row.at });
});

router.post("/items/:itemId/untick", validate(untickBody), async (req: Request, res: Response) => {
  const found = await itemFor(req, res, "open");
  if (!found) return;
  const { dueDate } = req.body as z.infer<typeof untickBody>;
  if (!canTickOccurrence(toDayItem(found.item), dueDate, londonDateString())) {
    res.status(409).json({ error: "That day's task has already moved on — refresh the list" });
    return;
  }
  await db.delete(teamListCompletionsTable)
    .where(and(eq(teamListCompletionsTable.itemId, found.item.id), eq(teamListCompletionsTable.dueDate, dueDate)));
  res.json({ ok: true });
});

export default router;
