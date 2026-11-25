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
 *   POST   /items/:itemId/tick  done / skipped for an occurrence (today's,
 *                                a carried-over one, or one in Coming up —
 *                                ticked early, Graeme 2026-10-14)
 *   POST   /items/:itemId/untick
 *   POST   /items/:itemId/subtasks          add a sub-task (Graeme, 25 Nov 2026)
 *   POST   /items/:itemId/subtasks/reorder  set the sub-tasks' order
 *   PATCH  /subtasks/:subId                 edit a sub-task
 *   DELETE /subtasks/:subId                 remove a sub-task
 *   POST   /items/:itemId/start             "Start now": copy a When-needed
 *                                            process and its sub-tasks onto a
 *                                            to-do list for today (a snapshot)
 *
 * Sub-tasks on a team list belong to the master task and have no ticks of
 * their own; they're ticked on the to-do a Start now makes. Changing them is
 * "changing the list" (everyone who can open it). Starting a process is
 * "ticking" (everyone who can open it) — onto your own list; managers and
 * admins may start it onto anyone's, as with to-dos.
 *
 * Access (lib/team-lists-day.ts, Graeme 2026-10-14 — "if I tick, you've got
 * access"): admins always; anyone else, any role, only when ticked on the
 * list. Everyone who can open a list can tick / skip / undo its tasks and
 * change the list itself — name, tasks, people, archive, import (Graeme,
 * 2026-11-12: "anyone that's got access to a list should be able to manage
 * that list fully"). Creating a new list is for managers and admins.
 * Enforced here on every endpoint. The rules for what shows today are pure and tested there too.
 */
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  db, usersTable, teamListsTable, teamListItemsTable, teamListCompletionsTable, teamListSubtasksTable,
  type TeamList, type TeamListItem, type TeamListSubtask,
} from "@workspace/db";
import { isDailyRhythm, isOnDemand, normaliseRule, sameRule, type RecurrenceRule } from "@workspace/recurrence";
import { isSameIdSet, processRuns, snapshotFromMaster, type ProcessCopy } from "@workspace/subtasks";
import { rawBody, validate } from "../middleware/validate";
import { resolveRole } from "../middleware/roles";
import { londonDateString } from "../lib/london-time";
import {
  buildDay, canAccessList, canCreateList, canEditList, canTickOccurrence, comingUp, membersForNewList,
  occurrencesToLoad, teamListsVisible, tickRefusal, upcomingOccurrencesToLoad, UPCOMING_DAYS,
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
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(d => { const t = new Date(`${d}T12:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d); }, "Not a real date");
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
  z.object({
    kind: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(31),
    // Every N months (2026-10-15): quarterly, six-monthly, yearly…
    interval: z.number().int().min(1).max(12).optional(),
    anchor: isoDate.nullish(),
  }),
  // One-off items the app adds (short-delivery reports, lib/short-delivery-report.ts).
  // Accepted here so editing such an item (title, priority…) still saves.
  z.object({ kind: z.literal("once"), date: isoDate }),
  // "Start when needed" processes (Graeme, 25 Nov 2026): never due by
  // themselves — started from the list onto someone's to-do list.
  z.object({ kind: z.literal("on_demand") }),
]).and(z.object({ from: isoDate.nullish() })); // optional start date (2026-10-15)
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
const subtaskBody = z.object({
  title: z.string().trim().min(1, "A sub-task needs a title").max(300),
  notes: optionalText(2000),
  url: urlField,
});
const subtaskPatch = z.object({
  title: z.string().trim().min(1, "A sub-task needs a title").max(300).optional(),
  notes: optionalText(2000),
  url: urlField,
});
const subtaskReorderBody = z.object({ subtaskIds: z.array(z.number().int().positive()).min(1).max(200) });
const startBody = z.object({
  /** Whose to-do list; default the starter's own. Others: managers/admins. */
  assigneeId: z.number().int().positive().optional(),
  /** Start another even though that person already has one open. */
  confirmDuplicate: z.boolean().optional(),
});
const MAX_SUBTASKS = 100;

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

async function itemFor(req: Request, res: Response, need: Need, itemId?: number): Promise<{ item: TeamListItem; list: TeamList } | null> {
  const id = itemId ?? intParam(req.params.itemId);
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

function serialiseSubtask(s: TeamListSubtask) {
  return { id: s.id, itemId: s.itemId, title: s.title, notes: s.notes, url: s.url, sortOrder: s.sortOrder };
}

async function loadSubtasks(itemIds: number[]): Promise<Map<number, TeamListSubtask[]>> {
  const out = new Map<number, TeamListSubtask[]>();
  if (!itemIds.length) return out;
  const rows = await db.select().from(teamListSubtasksTable)
    .where(inArray(teamListSubtasksTable.itemId, itemIds))
    .orderBy(asc(teamListSubtasksTable.sortOrder), asc(teamListSubtasksTable.id));
  for (const r of rows) {
    const list = out.get(r.itemId) ?? [];
    list.push(r);
    out.set(r.itemId, list);
  }
  return out;
}

/** todo_tasks timestamps are TIMESTAMP without a zone, in the database's own
 *  zone — as an ISO UTC string, whatever that zone is. */
function isoTs(col: SQL) {
  return sql`to_char((${col} AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

/** Every to-do started from these processes, for "Last run … by …". */
async function loadCopies(itemIds: number[]): Promise<Map<number, ProcessCopy[]>> {
  const out = new Map<number, ProcessCopy[]>();
  if (!itemIds.length) return out;
  const rows = await db.execute<{ item_id: number; assignee_id: number; assignee_name: string | null; status: "open" | "done"; created_at: string; completed_at: string | null }>(sql`
    SELECT t.source_team_list_item_id AS item_id, t.assignee_id, au.name AS assignee_name, t.status,
           ${isoTs(sql.raw("t.created_at"))} AS created_at,
           ${isoTs(sql.raw("t.completed_at"))} AS completed_at
    FROM todo_tasks t
    LEFT JOIN app_users au ON au.id = t.assignee_id
    WHERE t.source_team_list_item_id IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})
  `);
  for (const r of rows.rows) {
    const list = out.get(r.item_id) ?? [];
    list.push({ assigneeId: r.assignee_id, assigneeName: r.assignee_name, status: r.status, createdAt: r.created_at, completedAt: r.completed_at });
    out.set(r.item_id, list);
  }
  return out;
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
// available in the list"). For the people who can set members: managers and
// admins, and anyone on a list (they manage it, people included).
router.get("/people", async (req: Request, res: Response) => {
  if (!canCreateList(me(req))) {
    const lists = await db.select({ memberIds: teamListsTable.memberIds }).from(teamListsTable).where(isNull(teamListsTable.archivedAt));
    if (!lists.some(l => canEditList(me(req), l))) { res.status(403).json({ error: "You're not on any list" }); return; }
  }
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
  // Today's occurrences and Coming up's (early ticks), in one query.
  const completions = await loadCompletions([
    ...occurrencesToLoad(dayItems, today),
    ...upcomingOccurrencesToLoad(dayItems, today, UPCOMING_DAYS),
  ]);
  const day = buildDay(dayItems, completions, today);
  const subtasks = await loadSubtasks(items.map(i => i.id));
  // "When needed" processes: who ran them last, and who has one open.
  const copies = await loadCopies(items.filter(i => isOnDemand(i.recurrence as RecurrenceRule)).map(i => i.id));
  res.json({
    today,
    list: serialiseList(list, me(req)),
    items: items.map(i => ({
      ...serialiseItem(i),
      subtasks: (subtasks.get(i.id) ?? []).map(serialiseSubtask),
      runs: isOnDemand(i.recurrence as RecurrenceRule) ? processRuns(copies.get(i.id) ?? [], req.session.userId) : null,
    })),
    entries: day.entries,
    progress: day.progress,
    comingUp: comingUp(dayItems, today, UPCOMING_DAYS, completions),
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
  const today = londonDateString();
  if (!canTickOccurrence(toDayItem(found.item), dueDate, today)) {
    res.status(409).json({ error: tickRefusal(dueDate, today) });
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
  const today = londonDateString();
  if (!canTickOccurrence(toDayItem(found.item), dueDate, today)) {
    res.status(409).json({ error: tickRefusal(dueDate, today) });
    return;
  }
  await db.delete(teamListCompletionsTable)
    .where(and(eq(teamListCompletionsTable.itemId, found.item.id), eq(teamListCompletionsTable.dueDate, dueDate)));
  res.json({ ok: true });
});

// ── Sub-tasks (the master copy) ─────────────────────────────────────────────
async function subtaskFor(req: Request, res: Response): Promise<{ sub: TeamListSubtask; item: TeamListItem } | null> {
  const id = intParam(req.params.subId);
  if (!id) { res.status(404).json({ error: "Sub-task not found" }); return null; }
  const [sub] = await db.select().from(teamListSubtasksTable).where(eq(teamListSubtasksTable.id, id));
  if (!sub) { res.status(404).json({ error: "Sub-task not found" }); return null; }
  const found = await itemFor(req, res, "edit", sub.itemId);
  return found ? { sub, item: found.item } : null;
}

router.post("/items/:itemId/subtasks", validate(subtaskBody), async (req: Request, res: Response) => {
  const found = await itemFor(req, res, "edit");
  if (!found) return;
  const body = req.body as z.infer<typeof subtaskBody>;
  const [{ n, next }] = (await db.execute<{ n: number; next: number }>(
    sql`SELECT COUNT(*)::int AS n, COALESCE(MAX(sort_order), 0) + 1 AS next FROM team_list_subtasks WHERE item_id = ${found.item.id}`,
  )).rows;
  if (Number(n) >= MAX_SUBTASKS) { res.status(400).json({ error: `A task can have up to ${MAX_SUBTASKS} sub-tasks` }); return; }
  const [row] = await db.insert(teamListSubtasksTable).values({
    itemId: found.item.id, title: body.title, notes: body.notes, url: body.url,
    sortOrder: Number(next) || 1, createdById: req.session.userId!,
  }).returning();
  res.status(201).json(serialiseSubtask(row));
});

router.post("/items/:itemId/subtasks/reorder", validate(subtaskReorderBody), async (req: Request, res: Response) => {
  const found = await itemFor(req, res, "edit");
  if (!found) return;
  const { subtaskIds } = req.body as z.infer<typeof subtaskReorderBody>;
  const current = await db.select({ id: teamListSubtasksTable.id }).from(teamListSubtasksTable)
    .where(eq(teamListSubtasksTable.itemId, found.item.id));
  if (!isSameIdSet(current.map(c => c.id), subtaskIds)) {
    res.status(409).json({ error: "The sub-tasks have changed since you opened this — refresh and try again" });
    return;
  }
  await db.transaction(async tx => {
    for (const [i, id] of subtaskIds.entries()) {
      await tx.update(teamListSubtasksTable).set({ sortOrder: i + 1, updatedAt: new Date() })
        .where(and(eq(teamListSubtasksTable.id, id), eq(teamListSubtasksTable.itemId, found.item.id)));
    }
  });
  res.json({ ok: true });
});

router.patch("/subtasks/:subId", validate(subtaskPatch), async (req: Request, res: Response) => {
  const found = await subtaskFor(req, res);
  if (!found) return;
  const body = req.body as z.infer<typeof subtaskPatch>;
  const sent = rawBody<Record<string, unknown>>(req);
  const updates: Partial<typeof teamListSubtasksTable.$inferInsert> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if ("notes" in sent) updates.notes = body.notes ?? null;
  if ("url" in sent) updates.url = body.url ?? null;
  const [row] = await db.update(teamListSubtasksTable).set(updates).where(eq(teamListSubtasksTable.id, found.sub.id)).returning();
  res.json(serialiseSubtask(row));
});

router.delete("/subtasks/:subId", async (req: Request, res: Response) => {
  const found = await subtaskFor(req, res);
  if (!found) return;
  // Only the master's step goes; copies already started keep theirs.
  await db.delete(teamListSubtasksTable).where(eq(teamListSubtasksTable.id, found.sub.id));
  res.json({ ok: true });
});

// ── Start now ───────────────────────────────────────────────────────────────
// "Choose one of these top-level processes and start it for use today. That
// adds the top-level item to the person who started it's personal to-do
// list" (Graeme, 25 Nov 2026). A snapshot: editing the master afterwards
// never changes a copy that's been started.
router.post("/items/:itemId/start", validate(startBody), async (req: Request, res: Response) => {
  const found = await itemFor(req, res, "open");
  if (!found) return;
  const { item, list } = found;
  if (!item.active) { res.status(404).json({ error: "That task has been removed from the list" }); return; }
  if (list.archivedAt) { res.status(409).json({ error: "This list is archived — restore it to start its processes" }); return; }
  if (!isOnDemand(item.recurrence as RecurrenceRule)) {
    res.status(409).json({ error: "Only \"When needed\" tasks can be started — this one comes round by itself" });
    return;
  }
  const { assigneeId: wanted, confirmDuplicate } = req.body as z.infer<typeof startBody>;
  const starterId = req.session.userId!;
  const assigneeId = wanted ?? starterId;
  if (assigneeId !== starterId && !canCreateList(me(req))) {
    res.status(403).json({ error: "Only managers can start it on someone else's list" });
    return;
  }
  const [assignee] = await db.select({ id: usersTable.id, name: usersTable.name, isActive: usersTable.isActive })
    .from(usersTable).where(eq(usersTable.id, assigneeId));
  if (!assignee || !assignee.isActive) { res.status(400).json({ error: "That person isn't active" }); return; }

  const [{ open }] = (await db.execute<{ open: number }>(sql`
    SELECT COUNT(*)::int AS open FROM todo_tasks
    WHERE source_team_list_item_id = ${item.id} AND assignee_id = ${assigneeId} AND status = 'open'
  `)).rows;
  if (Number(open) > 0 && !confirmDuplicate) {
    res.status(409).json({
      code: "ALREADY_OPEN",
      openCount: Number(open),
      error: assigneeId === starterId
        ? "You already have one open — start another?"
        : `${assignee.name.split(" ")[0]} already has one open — start another?`,
    });
    return;
  }

  const today = londonDateString();
  const subtasks = (await loadSubtasks([item.id])).get(item.id) ?? [];
  const snap = snapshotFromMaster(
    { id: item.id, title: item.title, notes: item.notes, url: item.url, priority: item.priority, timeOfDay: item.timeOfDay },
    subtasks, today,
  );
  const starterName = (await myName(req)) ?? "Someone";
  const forSelf = assigneeId === starterId;
  const todoId = await db.transaction(async tx => {
    const rows = await tx.execute<{ id: number }>(sql`
      INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, scheduled_for, due_date,
                              recurrence, time_of_day, acknowledged_at, source_team_list_item_id)
      VALUES (${assigneeId}, ${starterId}, ${starterName}, ${snap.title}, ${snap.notes}, ${snap.url}, ${snap.priority},
              ${snap.scheduledFor}, ${snap.dueDate}, NULL, ${snap.timeOfDay}, ${forSelf ? sql`NOW()` : null}, ${snap.sourceTeamListItemId})
      RETURNING id
    `);
    const id = rows.rows[0].id;
    for (const s of snap.subtasks) {
      await tx.execute(sql`
        INSERT INTO todo_subtasks (task_id, title, notes, url, sort_order)
        VALUES (${id}, ${s.title}, ${s.notes}, ${s.url}, ${s.sortOrder})
      `);
    }
    const event = forSelf
      ? `Started from the team list (${list.name} → ${item.title}) by ${starterName}`
      : `Started from the team list (${list.name} → ${item.title}) by ${starterName}, for ${assignee.name}`;
    await tx.execute(sql`
      INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
      VALUES (${id}, ${starterId}, ${starterName}, 'event', ${event})
    `);
    return id;
  });
  if (!forSelf) {
    // Like any to-do put on someone else's list: a bell, and the "you've been
    // asked to…" takeover until they've seen it (acknowledged_at is NULL).
    try {
      await db.execute(sql`
        INSERT INTO notifications (user_id, type, message, read)
        VALUES (${assigneeId}, 'todo', ${`New to-do from ${starterName}: ${snap.title}`.slice(0, 500)}, false)
      `);
    } catch (err) {
      console.warn("[TeamLists] start notification failed:", err instanceof Error ? err.message : err);
    }
  }
  res.status(201).json({ todoId, subtaskCount: snap.subtasks.length, assigneeId, assigneeName: assignee.name });
});

export default router;
