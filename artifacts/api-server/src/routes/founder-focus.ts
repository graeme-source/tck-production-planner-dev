import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  founderPillarsTable,
  founderGoalsTable,
  founderBlocksTable,
  founderBlockTemplatesTable,
  founderParkingLotTable,
  founderRecurringItemsTable,
  founderRecurringTicksTable,
  founderTasksTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { verifyCaldav, getDayEvents, resetCaldavCache, type CalendarEvent } from "../lib/caldav";
import { getClaudeClient, isClaudeConfigured, CLAUDE_MODELS } from "../lib/ai/claude";

const router: IRouter = Router();

// ── Founder settings k/v (founder_settings table — NOT app_settings, which
// ordinary users can read). Secrets never leave the server: status endpoints
// only say whether a value exists.
const CALDAV_ID_KEY = "caldav_apple_id";
const CALDAV_PW_KEY = "caldav_app_password";
// Inclusion list (2026-07-30, by request): only calendars on this list show
// in the day view, so anything newly created in Apple stays hidden until
// explicitly switched on. `null` = no choice saved yet → show everything,
// so a fresh connection isn't an empty day view.
const CALDAV_ENABLED_KEY = "caldav_enabled_calendars";

async function getEnabledCalendarUrls(): Promise<Set<string> | null> {
  const raw = await getFounderSetting(CALDAV_ENABLED_KEY);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return null;
  }
}

async function getFounderSetting(key: string): Promise<string | null> {
  const rows = await db.execute<{ value: string }>(sql`SELECT value FROM founder_settings WHERE key = ${key} LIMIT 1`);
  return rows.rows[0]?.value ?? null;
}

async function setFounderSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO founder_settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `);
}

async function deleteFounderSetting(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM founder_settings WHERE key = ${key}`);
}

// Same founder gate as founder-panels: these tables hold the founder's
// personal plan, so role checks aren't enough — the account itself must be
// the founder's.
const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";

async function requireFounder(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const rows = await db.execute<{ email: string }>(sql`SELECT email FROM app_users WHERE id = ${userId} LIMIT 1`);
  if (rows.rows[0]?.email !== FOUNDER_EMAIL) { res.status(403).json({ error: "Founder only" }); return; }
  next();
}

router.use(requireFounder);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayLondonStr(): string {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

// The weekly template materialises into a day automatically the FIRST time
// that day is opened (today or future — past days stay the historical
// record). The once-per-date marker means deliberately clearing a day
// sticks; the manual "Fill from template" button still works after that.
async function autofillFromTemplate(dateStr: string, weekday: number): Promise<boolean> {
  if (dateStr < todayLondonStr()) return false;
  const marker = `autofill_done:${dateStr}`;
  if (await getFounderSetting(marker)) return false;

  const [existing, templates] = await Promise.all([
    db.select({ id: founderBlocksTable.id }).from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)).limit(1),
    db.select().from(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, weekday)),
  ]);
  await setFounderSetting(marker, "1");
  // Old markers are one-per-day noise — sweep anything before today.
  await db.execute(sql`DELETE FROM founder_settings WHERE key LIKE 'autofill_done:%' AND key < ${"autofill_done:" + todayLondonStr()}`);
  if (existing.length > 0 || templates.length === 0) return false;

  for (const t of templates) {
    await db.insert(founderBlocksTable).values({
      date: dateStr,
      startMin: t.startMin,
      endMin: t.endMin,
      pillarId: t.pillarId,
      title: t.title,
      source: "template",
    });
  }
  return true;
}

// ── Overview ───────────────────────────────────────────────────────────────
// One fetch for the Focus page: pillars+goals, the day's blocks, that
// weekday's template rows, and the open parking lot.
router.get("/overview", async (req: Request, res: Response) => {
  const dateStr = typeof req.query.date === "string" && DATE_RE.test(req.query.date)
    ? req.query.date
    : null;
  if (!dateStr) { res.status(400).json({ error: "date=YYYY-MM-DD required" }); return; }
  // Weekday from the plain date string — no TZ conversion (see blocks note).
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

  try {
    await autofillFromTemplate(dateStr, weekday);

    const [pillars, goals, blocks, templates, parkingLot, recurringItems, ticks, tasks, overdueTasks, appleId, appPassword] = await Promise.all([
      // (appleId/appPassword only decide calendarConfigured — the actual
      // iCloud fetch moved to GET /events so it can't block this response.)
      db.select().from(founderPillarsTable).where(isNull(founderPillarsTable.archivedAt)).orderBy(asc(founderPillarsTable.sort), asc(founderPillarsTable.id)),
      db.select().from(founderGoalsTable).orderBy(asc(founderGoalsTable.sort), asc(founderGoalsTable.id)),
      db.select().from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)).orderBy(asc(founderBlocksTable.startMin)),
      db.select().from(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, weekday)).orderBy(asc(founderBlockTemplatesTable.startMin)),
      db.select().from(founderParkingLotTable).where(isNull(founderParkingLotTable.resolvedAt)).orderBy(asc(founderParkingLotTable.createdAt)),
      db.select().from(founderRecurringItemsTable).where(isNull(founderRecurringItemsTable.archivedAt)).orderBy(asc(founderRecurringItemsTable.sort), asc(founderRecurringItemsTable.id)),
      db.select().from(founderRecurringTicksTable).where(eq(founderRecurringTicksTable.date, dateStr)),
      db.select().from(founderTasksTable).where(eq(founderTasksTable.date, dateStr)).orderBy(asc(founderTasksTable.sort), asc(founderTasksTable.id)),
      // Anything still open on a date before TODAY — not before the date being
      // viewed, so paging back through the week doesn't invent overdue work
      // that was fine at the time.
      db.select().from(founderTasksTable)
        .where(and(eq(founderTasksTable.status, "open"), lt(founderTasksTable.date, todayLondonStr())))
        .orderBy(asc(founderTasksTable.date), asc(founderTasksTable.id)),
      getFounderSetting(CALDAV_ID_KEY),
      getFounderSetting(CALDAV_PW_KEY),
    ]);

    const tickedItemIds = new Set(ticks.map(t => t.itemId));
    const calendarConfigured = !!(appleId && appPassword);

    res.json({
      date: dateStr,
      weekday,
      pillars: pillars.map(p => ({ ...p, goals: goals.filter(g => g.pillarId === p.id) })),
      blocks,
      templates,
      parkingLot,
      // All items (the pillar card manages them whatever the day); dueOnDate
      // says whether each one falls on the requested date, so only due items
      // appear as tickboxes in the day's blocks.
      recurringItems: recurringItems.map(i => ({
        ...i,
        ticked: tickedItemIds.has(i.id),
        dueOnDate: recurringMatchesDate(i, dateStr, weekday),
      })),
      tasks,
      // Open tasks left behind on earlier days. The day view shows these in a
      // review strip so they get rescheduled on purpose rather than rolling
      // forward silently (Graeme, 2026-08-12).
      overdueTasks,
      objectives: await listObjectives(),
      calendarConfigured,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Day events (Apple Calendar) ────────────────────────────────────────────
// Split from /overview (2026-08-18): a cold iCloud CalDAV round-trip took
// seconds and used to hold the WHOLE page blank. Now the page paints from
// the DB instantly and meetings drop in when Apple answers. Best-effort as
// before: failures degrade to an inline warning, never a 500.
router.get("/events", async (req: Request, res: Response) => {
  const dateStr = typeof req.query.date === "string" && DATE_RE.test(req.query.date)
    ? req.query.date
    : null;
  if (!dateStr) { res.status(400).json({ error: "date=YYYY-MM-DD required" }); return; }

  const [appleId, appPassword] = await Promise.all([
    getFounderSetting(CALDAV_ID_KEY),
    getFounderSetting(CALDAV_PW_KEY),
  ]);
  if (!appleId || !appPassword) {
    res.json({ calendarConfigured: false, events: [], calendarError: null });
    return;
  }
  let events: CalendarEvent[] = [];
  let calendarError: string | null = null;
  try {
    events = await getDayEvents(appleId, appPassword, dateStr, await getEnabledCalendarUrls());
  } catch (err) {
    calendarError = err instanceof Error ? err.message : String(err);
  }
  res.json({ calendarConfigured: true, events, calendarError });
});

// ── Apple Calendar (CalDAV, read-only) ─────────────────────────────────────
router.get("/caldav", async (_req: Request, res: Response) => {
  const appleId = await getFounderSetting(CALDAV_ID_KEY);
  const password = await getFounderSetting(CALDAV_PW_KEY);
  if (!appleId || !password) { res.json({ configured: false }); return; }
  try {
    const [calendars, enabled] = await Promise.all([verifyCaldav(appleId, password), getEnabledCalendarUrls()]);
    res.json({
      configured: true,
      appleId,
      calendars: calendars.map(c => ({ ...c, enabled: enabled ? enabled.has(c.url) : true })),
    });
  } catch (err) {
    res.json({ configured: true, appleId, calendars: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// Per-calendar on/off. Stored as an ENABLED list so calendars added in
// Apple later stay hidden until explicitly switched on.
router.put("/caldav/calendars", async (req: Request, res: Response) => {
  const parsed = z.object({ enabledUrls: z.array(z.string().min(1)).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "enabledUrls: string[] required" }); return; }
  await setFounderSetting(CALDAV_ENABLED_KEY, JSON.stringify(parsed.data.enabledUrls));
  res.json({ ok: true });
});

router.post("/caldav", async (req: Request, res: Response) => {
  const parsed = z.object({
    appleId: z.string().trim().email(),
    appPassword: z.string().trim().min(8).max(100),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "appleId (email) and appPassword required" }); return; }
  const { appleId, appPassword } = parsed.data;
  try {
    // Verify before saving so a typo'd password is caught immediately.
    const calendars = await verifyCaldav(appleId, appPassword);
    await setFounderSetting(CALDAV_ID_KEY, appleId);
    await setFounderSetting(CALDAV_PW_KEY, appPassword);
    resetCaldavCache();
    res.json({ configured: true, appleId, calendars });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/caldav", async (_req: Request, res: Response) => {
  await deleteFounderSetting(CALDAV_ID_KEY);
  await deleteFounderSetting(CALDAV_PW_KEY);
  await deleteFounderSetting(CALDAV_ENABLED_KEY);
  resetCaldavCache();
  res.json({ configured: false });
});

// ── Objectives (Moonshot / Mission / Stepping Stones) ──────────────────────
// The top of the goal pyramid: moonshot (10yr) → mission (3–5yr) →
// stepping stones (next ~3 months, measurable). Raw-SQL rows — the table
// is founder-only and tiny.
const HORIZONS = ["moonshot", "mission", "stepping_stone"] as const;

async function listObjectives() {
  const rows = await db.execute<{
    id: number; horizon: string; title: string; detail: string | null;
    metric: string | null; target_date: string | null; sort: number; achieved_at: string | null;
  }>(sql`
    SELECT id, horizon, title, detail, metric, target_date::text, sort, achieved_at::text
    FROM founder_objectives ORDER BY sort, id
  `);
  return rows.rows.map(r => ({
    id: r.id, horizon: r.horizon, title: r.title, detail: r.detail,
    metric: r.metric, targetDate: r.target_date, sort: r.sort, achieved: r.achieved_at != null,
  }));
}

router.post("/objectives", async (req: Request, res: Response) => {
  const parsed = z.object({
    horizon: z.enum(HORIZONS),
    title: z.string().trim().min(1).max(300),
    detail: z.string().trim().max(2000).nullish(),
    metric: z.string().trim().max(200).nullish(),
    targetDate: z.string().regex(DATE_RE).nullish(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const b = parsed.data;
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO founder_objectives (horizon, title, detail, metric, target_date)
    VALUES (${b.horizon}, ${b.title}, ${b.detail ?? null}, ${b.metric ?? null}, ${b.targetDate ?? null})
    RETURNING id
  `);
  res.status(201).json({ id: rows.rows[0].id });
});

router.patch("/objectives/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    title: z.string().trim().min(1).max(300).optional(),
    detail: z.string().trim().max(2000).nullish(),
    metric: z.string().trim().max(200).nullish(),
    targetDate: z.string().regex(DATE_RE).nullish(),
    achieved: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const b = parsed.data;
  await db.execute(sql`
    UPDATE founder_objectives SET
      title = COALESCE(${b.title ?? null}, title),
      detail = CASE WHEN ${b.detail !== undefined} THEN ${b.detail ?? null} ELSE detail END,
      metric = CASE WHEN ${b.metric !== undefined} THEN ${b.metric ?? null} ELSE metric END,
      target_date = CASE WHEN ${b.targetDate !== undefined} THEN ${b.targetDate ?? null}::date ELSE target_date END,
      achieved_at = CASE WHEN ${b.achieved === undefined} THEN achieved_at WHEN ${b.achieved === true} THEN NOW() ELSE NULL END
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

router.delete("/objectives/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM founder_objectives WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── Pillars ────────────────────────────────────────────────────────────────
const PillarBody = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().max(20).nullish(),
  targetSharePct: z.number().int().min(0).max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  sort: z.number().int().optional(),
});

router.post("/pillars", async (req: Request, res: Response) => {
  const parsed = PillarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const { name, color, targetSharePct, notes, sort } = parsed.data;
  const [row] = await db.insert(founderPillarsTable).values({
    name,
    color: color ?? null,
    targetSharePct: targetSharePct ?? null,
    notes: notes ?? null,
    sort: sort ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/pillars/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = PillarBody.partial().extend({ archived: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const { archived, ...fields } = parsed.data;
  const [row] = await db.update(founderPillarsTable)
    .set({
      ...fields,
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    })
    .where(eq(founderPillarsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Pillar not found" }); return; }
  res.json(row);
});

router.delete("/pillars/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderPillarsTable).where(eq(founderPillarsTable.id, id));
  res.json({ ok: true });
});

// ── Goals ──────────────────────────────────────────────────────────────────
const UrlField = z.string().trim().max(1000)
  .refine(u => u === "" || /^https?:\/\//i.test(u), { message: "URL must start with http(s)://" })
  .nullish();

const GoalBody = z.object({
  pillarId: z.number().int(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).nullish(),
  url: UrlField,
  sort: z.number().int().optional(),
});

router.post("/goals", async (req: Request, res: Response) => {
  const parsed = GoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const [row] = await db.insert(founderGoalsTable).values({
    pillarId: parsed.data.pillarId,
    title: parsed.data.title,
    detail: parsed.data.detail ?? null,
    url: parsed.data.url || null,
    sort: parsed.data.sort ?? 0,
  }).returning();
  res.status(201).json(row);
});

router.patch("/goals/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = GoalBody.partial().extend({
    status: z.enum(["active", "done", "parked"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const { status, url, ...fields } = parsed.data;
  const [row] = await db.update(founderGoalsTable)
    .set({
      ...fields,
      ...(url !== undefined ? { url: url || null } : {}),
      ...(status !== undefined ? { status, doneAt: status === "done" ? new Date() : null } : {}),
    })
    .where(eq(founderGoalsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Goal not found" }); return; }
  res.json(row);
});

router.delete("/goals/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderGoalsTable).where(eq(founderGoalsTable.id, id));
  res.json({ ok: true });
});

// ── Tasks ──────────────────────────────────────────────────────────────────
// Day-to-day to-dos. A task belongs to a DATE; pillar and block are optional
// (an unrouted task shows in the day's "Unassigned" tray). Ticking one hides
// it behind the day's "show completed" toggle; leaving one undone keeps it on
// its own date, where the overdue strip picks it up the next morning.
const TaskBody = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(2000).nullish(),
  url: z.string().trim().max(500).nullish(),
  date: z.string().regex(DATE_RE),
  pillarId: z.number().int().nullish(),
  blockId: z.number().int().nullish(),
  source: z.enum(["manual", "ai", "parking"]).optional(),
});

router.post("/tasks", async (req: Request, res: Response) => {
  const parsed = TaskBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const t = parsed.data;
  const [row] = await db.insert(founderTasksTable).values({
    title: t.title,
    detail: t.detail ?? null,
    url: t.url || null,
    date: t.date,
    pillarId: t.pillarId ?? null,
    blockId: t.blockId ?? null,
    source: t.source ?? "manual",
  }).returning();
  res.status(201).json(row);
});

router.patch("/tasks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = TaskBody.partial().extend({
    status: z.enum(["open", "done"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const { status, url, date, pillarId, blockId, ...fields } = parsed.data;
  // Moving a task to another day drops its block pin — block ids belong to a
  // single date, so keeping one would point at yesterday's timeline. Callers
  // that mean to re-pin send blockId explicitly in the same request.
  const movedDay = date !== undefined;
  const [row] = await db.update(founderTasksTable)
    .set({
      ...fields,
      ...(url !== undefined ? { url: url || null } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(pillarId !== undefined ? { pillarId: pillarId ?? null } : {}),
      ...(blockId !== undefined ? { blockId: blockId ?? null } : movedDay ? { blockId: null } : {}),
      ...(status !== undefined ? { status, doneAt: status === "done" ? new Date() : null } : {}),
    })
    .where(eq(founderTasksTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(row);
});

router.delete("/tasks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderTasksTable).where(eq(founderTasksTable.id, id));
  res.json({ ok: true });
});

// Where should a typed task go? Reads the pillars and the day's blocks and
// proposes a home for it. This ONLY suggests — nothing is written until the
// founder confirms in the quick-add bar, so a bad guess costs one dropdown.
const CLASSIFY_TOOL = {
  name: "route_task",
  description: "Choose which pillar and time block a new task belongs to.",
  input_schema: {
    type: "object" as const,
    properties: {
      pillarId: { type: ["integer", "null"], description: "Pillar id from the provided list, or null if it fits none of them" },
      blockId: { type: ["integer", "null"], description: "Block id from the day's list, or null to leave it unpinned" },
      recurring: { type: "boolean", description: "True only if the founder's wording says this repeats (every day, weekly, each morning…)" },
      reason: { type: "string", description: "A short phrase, max 12 words, saying why — shown next to the confirm button." },
    },
    required: ["pillarId", "blockId", "recurring", "reason"],
  },
};

router.post("/tasks/classify", async (req: Request, res: Response) => {
  const parsed = z.object({
    title: z.string().trim().min(1).max(300),
    date: z.string().regex(DATE_RE),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "title and date required" }); return; }
  const { title, date: dateStr } = parsed.data;

  const [pillars, blocks] = await Promise.all([
    db.select().from(founderPillarsTable).where(isNull(founderPillarsTable.archivedAt)).orderBy(asc(founderPillarsTable.sort)),
    db.select().from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)).orderBy(asc(founderBlocksTable.startMin)),
  ]);

  // No AI configured is not an error — quick-add still works, it just doesn't
  // pre-fill. Same for any failure below.
  if (!isClaudeConfigured()) { res.json({ pillarId: null, blockId: null, recurring: false, reason: null, available: false }); return; }

  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const context = [
    `Pillars (id · name):`,
    ...pillars.map(p => `  ${p.id} · ${p.name}${p.notes ? ` — ${p.notes}` : ""}`),
    blocks.length ? `Blocks on ${dateStr} (id · time · title · pillar):` : `No blocks on ${dateStr}.`,
    ...blocks.map(b => `  ${b.id} · ${fmt(b.startMin)}-${fmt(b.endMin)} · ${b.title} · pillar ${b.pillarId ?? "none"}`),
  ].join("\n");

  try {
    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 300,
      system: [
        "You route a new to-do into The Calzone Kitchen founder's day planner.",
        "Pick the pillar whose remit the task falls under, and the block on that pillar it best fits.",
        "Prefer a block belonging to the chosen pillar; if the pillar has no block today, return blockId null.",
        "If the task matches no pillar, return null rather than forcing a fit.",
        "Set recurring true ONLY when the wording itself says it repeats.",
      ].join(" "),
      messages: [{ role: "user", content: `${context}\n\nNew task: ${title}` }],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "route_task" },
    });
    const toolUse = response.content.find(c => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") { res.json({ pillarId: null, blockId: null, recurring: false, reason: null, available: true }); return; }
    const out = toolUse.input as { pillarId?: number | null; blockId?: number | null; recurring?: boolean; reason?: string };

    // Never trust the ids back — a hallucinated pillar would silently file the
    // task under nothing, and a stale block id would pin it to another day.
    const pillarId = out.pillarId != null && pillars.some(p => p.id === out.pillarId) ? out.pillarId : null;
    const block = out.blockId != null ? blocks.find(b => b.id === out.blockId) : undefined;
    res.json({
      pillarId,
      blockId: block ? block.id : null,
      recurring: !!out.recurring,
      reason: out.reason?.trim() || null,
      available: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[founder-focus] task classify error:", msg);
    res.json({ pillarId: null, blockId: null, recurring: false, reason: null, available: false });
  }
});

// Completed-task history, newest first. Separate from /overview because the
// day view only ever needs its own date.
router.get("/tasks/history", async (req: Request, res: Response) => {
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(founderTasksTable)
    .where(and(eq(founderTasksTable.status, "done"), gte(founderTasksTable.date, from)))
    .orderBy(desc(founderTasksTable.doneAt));
  res.json(rows);
});

// ── Blocks ─────────────────────────────────────────────────────────────────
// The pillar IS the block (2026-07-30): title is optional and defaults to
// the pillar's name, so "add a Sales & Marketing block 8-9" is one tap.
const BlockBody = z.object({
  date: z.string().regex(DATE_RE),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  pillarId: z.number().int().nullish(),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).nullish(),
}).refine(b => b.endMin > b.startMin, { message: "endMin must be after startMin" })
  .refine(b => (b.title && b.title.length > 0) || b.pillarId != null, { message: "Pick a pillar or give the block a title" });

async function pillarNameById(id: number): Promise<string | null> {
  const [row] = await db.select({ name: founderPillarsTable.name }).from(founderPillarsTable).where(eq(founderPillarsTable.id, id));
  return row?.name ?? null;
}

router.post("/blocks", async (req: Request, res: Response) => {
  const parsed = BlockBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const b = parsed.data;
  const title = b.title?.trim() || (b.pillarId != null ? await pillarNameById(b.pillarId) : null) || "Focus";
  const [row] = await db.insert(founderBlocksTable).values({
    date: b.date,
    startMin: b.startMin,
    endMin: b.endMin,
    pillarId: b.pillarId ?? null,
    title,
    notes: b.notes ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/blocks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    startMin: z.number().int().min(0).max(1439).optional(),
    endMin: z.number().int().min(1).max(1440).optional(),
    pillarId: z.number().int().nullish(),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2000).nullish(),
    status: z.enum(["planned", "done", "skipped"]).optional(),
    date: z.string().regex(DATE_RE).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const [row] = await db.update(founderBlocksTable)
    .set(parsed.data)
    .where(eq(founderBlocksTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Block not found" }); return; }
  res.json(row);
});

router.delete("/blocks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderBlocksTable).where(eq(founderBlocksTable.id, id));
  res.json({ ok: true });
});

// Instantiate the weekday's template into a date. Skips template rows that
// overlap an existing block so re-running never doubles the day up.
router.post("/blocks/apply-template", async (req: Request, res: Response) => {
  const parsed = z.object({ date: z.string().regex(DATE_RE) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "date=YYYY-MM-DD required" }); return; }
  const dateStr = parsed.data.date;
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

  const [templates, existing] = await Promise.all([
    db.select().from(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, weekday)).orderBy(asc(founderBlockTemplatesTable.startMin)),
    db.select().from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)),
  ]);

  const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
  let created = 0;
  for (const t of templates) {
    if (existing.some(b => overlaps(t.startMin, t.endMin, b.startMin, b.endMin))) continue;
    await db.insert(founderBlocksTable).values({
      date: dateStr,
      startMin: t.startMin,
      endMin: t.endMin,
      pillarId: t.pillarId,
      title: t.title,
      source: "template",
    });
    created++;
  }
  res.json({ created, skipped: templates.length - created });
});

// ── Templates ──────────────────────────────────────────────────────────────
router.get("/templates", async (_req: Request, res: Response) => {
  const rows = await db.select().from(founderBlockTemplatesTable)
    .orderBy(asc(founderBlockTemplatesTable.weekday), asc(founderBlockTemplatesTable.startMin));
  res.json(rows);
});

const TemplateBody = z.object({
  weekday: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  pillarId: z.number().int().nullish(),
  title: z.string().trim().max(200).optional(),
}).refine(t => t.endMin > t.startMin, { message: "endMin must be after startMin" })
  .refine(t => (t.title && t.title.length > 0) || t.pillarId != null, { message: "Pick a pillar or give the block a title" });

router.post("/templates", async (req: Request, res: Response) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const t = parsed.data;
  const title = t.title?.trim() || (t.pillarId != null ? await pillarNameById(t.pillarId) : null) || "Focus";
  const [row] = await db.insert(founderBlockTemplatesTable).values({
    weekday: t.weekday,
    startMin: t.startMin,
    endMin: t.endMin,
    pillarId: t.pillarId ?? null,
    title,
  }).returning();
  res.status(201).json(row);
});

// Copy one weekday's template rows over other weekdays (replacing them).
// "Edit Monday, copy to the week, then tweak Tuesday" is the intended flow.
router.post("/templates/copy-day", async (req: Request, res: Response) => {
  const parsed = z.object({
    fromWeekday: z.number().int().min(0).max(6),
    toWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "fromWeekday and toWeekdays[] required" }); return; }
  const { fromWeekday, toWeekdays } = parsed.data;
  const targets = [...new Set(toWeekdays)].filter(d => d !== fromWeekday);

  const sourceRows = await db.select().from(founderBlockTemplatesTable)
    .where(eq(founderBlockTemplatesTable.weekday, fromWeekday));

  for (const day of targets) {
    await db.delete(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, day));
    for (const r of sourceRows) {
      await db.insert(founderBlockTemplatesTable).values({
        weekday: day,
        startMin: r.startMin,
        endMin: r.endMin,
        pillarId: r.pillarId,
        title: r.title,
        sort: r.sort,
      });
    }
  }
  res.json({ copied: sourceRows.length, days: targets });
});

router.patch("/templates/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    startMin: z.number().int().min(0).max(1439).optional(),
    endMin: z.number().int().min(1).max(1440).optional(),
    pillarId: z.number().int().nullish(),
    title: z.string().trim().min(1).max(200).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const [row] = await db.update(founderBlockTemplatesTable)
    .set(parsed.data)
    .where(eq(founderBlockTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Template row not found" }); return; }
  res.json(row);
});

router.delete("/templates/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.id, id));
  res.json({ ok: true });
});

// ── Recurring items (per-pillar rituals with Todoist-style recurrence) ─────
const RecurringSchedule = z.enum(["daily", "weekdays", "weekly", "biweekly"]);

/** For biweekly items, fix parity to the NEXT occurrence of scheduleDay so
 *  "every second Friday" starts from the first Friday after creation. */
function nextDateForWeekday(scheduleDay: number): string {
  const today = londonTodayStr();
  const base = new Date(`${today}T12:00:00Z`);
  const delta = (scheduleDay - base.getUTCDay() + 7) % 7;
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/** Does a recurring item fall on this date? (Pillar-blocked rule applies
 *  separately on the client.) */
function recurringMatchesDate(item: { schedule: string; scheduleDay: number | null; anchorDate: string | null }, dateStr: string, weekday: number): boolean {
  switch (item.schedule) {
    case "weekdays":
      return weekday >= 1 && weekday <= 5;
    case "weekly":
      return item.scheduleDay === weekday;
    case "biweekly": {
      if (item.scheduleDay !== weekday) return false;
      if (!item.anchorDate) return true;
      const diffDays = Math.round((Date.parse(`${dateStr}T12:00:00Z`) - Date.parse(`${item.anchorDate}T12:00:00Z`)) / 86_400_000);
      return ((Math.floor(diffDays / 7) % 2) + 2) % 2 === 0;
    }
    default:
      return true; // daily
  }
}

router.post("/recurring-items", async (req: Request, res: Response) => {
  const parsed = z.object({
    pillarId: z.number().int(),
    title: z.string().trim().min(1).max(200),
    url: UrlField,
    schedule: RecurringSchedule.optional(),
    scheduleDay: z.number().int().min(0).max(6).nullish(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "pillarId and title required" }); return; }
  const { pillarId, title, url, schedule = "daily", scheduleDay } = parsed.data;
  if ((schedule === "weekly" || schedule === "biweekly") && scheduleDay == null) {
    res.status(400).json({ error: "scheduleDay required for weekly/biweekly items" });
    return;
  }
  const [row] = await db.insert(founderRecurringItemsTable).values({
    pillarId,
    title,
    url: url || null,
    schedule,
    scheduleDay: schedule === "daily" || schedule === "weekdays" ? null : scheduleDay,
    anchorDate: schedule === "biweekly" && scheduleDay != null ? nextDateForWeekday(scheduleDay) : null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/recurring-items/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    url: UrlField,
    schedule: RecurringSchedule.optional(),
    scheduleDay: z.number().int().min(0).max(6).nullish(),
    archived: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { archived, url, schedule, scheduleDay, ...fields } = parsed.data;
  const [row] = await db.update(founderRecurringItemsTable)
    .set({
      ...fields,
      ...(url !== undefined ? { url: url || null } : {}),
      ...(schedule !== undefined ? {
        schedule,
        scheduleDay: schedule === "daily" || schedule === "weekdays" ? null : scheduleDay ?? null,
        anchorDate: schedule === "biweekly" && scheduleDay != null ? nextDateForWeekday(scheduleDay) : null,
      } : {}),
      ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
    })
    .where(eq(founderRecurringItemsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(row);
});

router.delete("/recurring-items/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderRecurringItemsTable).where(eq(founderRecurringItemsTable.id, id));
  res.json({ ok: true });
});

// Tick / untick for a given date. One row per (item, date).
router.post("/recurring-items/:id/tick", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    date: z.string().regex(DATE_RE),
    ticked: z.boolean(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "date and ticked required" }); return; }
  if (parsed.data.ticked) {
    await db.insert(founderRecurringTicksTable)
      .values({ itemId: id, date: parsed.data.date })
      .onConflictDoNothing();
  } else {
    await db.delete(founderRecurringTicksTable).where(and(
      eq(founderRecurringTicksTable.itemId, id),
      eq(founderRecurringTicksTable.date, parsed.data.date),
    ));
  }
  res.json({ ok: true });
});

// ── AI replan ──────────────────────────────────────────────────────────────
// "Finishing at midday today — reschedule around that, and fit in two hours
// of sales." Rebuilds the movable part of a day from the founder's prompt:
// done/skipped blocks and anything already finished stay put, meetings are
// immovable, and the weekly template + pillars give the model its defaults.
function londonNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find(p => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function londonTodayStr(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

const REPLAN_TOOL = {
  name: "set_day_plan",
  description: "Replace the movable time blocks of the founder's day with a new plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      explanation: {
        type: "string",
        description: "One or two sentences, spoken to the founder, explaining the shape of the new plan and any trade-offs made.",
      },
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            startMin: { type: "integer", description: "Start, minutes from midnight local time" },
            endMin: { type: "integer", description: "End, minutes from midnight local time" },
            pillarId: { type: ["integer", "null"], description: "Pillar id from the provided list, or null for a one-off" },
            title: { type: "string", description: "Optional title; omit to use the pillar name" },
          },
          required: ["startMin", "endMin"],
        },
      },
    },
    required: ["explanation", "blocks"],
  },
};

router.post("/replan", async (req: Request, res: Response) => {
  const parsed = z.object({
    date: z.string().regex(DATE_RE),
    prompt: z.string().trim().min(1).max(2000),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "date and prompt required" }); return; }
  if (!isClaudeConfigured()) { res.status(503).json({ error: "AI is not configured on this server." }); return; }
  const { date: dateStr, prompt } = parsed.data;

  try {
    const isToday = dateStr === londonTodayStr();
    const now = isToday ? londonNowMinutes() : 0;
    const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

    const [pillars, recurringItems, blocks, templates, appleId, appPassword] = await Promise.all([
      db.select().from(founderPillarsTable).where(isNull(founderPillarsTable.archivedAt)).orderBy(asc(founderPillarsTable.sort)),
      db.select().from(founderRecurringItemsTable).where(isNull(founderRecurringItemsTable.archivedAt)),
      db.select().from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)).orderBy(asc(founderBlocksTable.startMin)),
      db.select().from(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, weekday)).orderBy(asc(founderBlockTemplatesTable.startMin)),
      getFounderSetting(CALDAV_ID_KEY),
      getFounderSetting(CALDAV_PW_KEY),
    ]);

    let events: CalendarEvent[] = [];
    if (appleId && appPassword) {
      try {
        events = await getDayEvents(appleId, appPassword, dateStr, await getEnabledCalendarUrls());
      } catch { /* replan still works without the diary */ }
    }

    // Blocks the model may not touch: finished/skipped, or already over.
    const locked = blocks.filter(b => b.status !== "planned" || (isToday && b.endMin <= now));
    const movable = blocks.filter(b => !locked.includes(b));

    const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    const objectives = await listObjectives();
    const horizonLabel: Record<string, string> = { moonshot: "MOONSHOT (10-year)", mission: "MISSION (3-5 year)", stepping_stone: "STEPPING STONE (next ~3 months)" };
    const context = [
      objectives.length
        ? [
            "North-star objectives — when trading off what fits in the day, favour work that advances the stepping stones:",
            ...objectives.filter(o => !o.achieved).map(o =>
              `  ${horizonLabel[o.horizon] ?? o.horizon}: ${o.title}${o.metric ? ` [target: ${o.metric}]` : ""}${o.targetDate ? ` (by ${o.targetDate})` : ""}`),
          ].join("\n")
        : "",
      `Date: ${dateStr}${isToday ? ` (today — current time ${fmt(now)}; nothing may be scheduled before now)` : ""}`,
      `Pillars (id · name · weekly target %):`,
      ...pillars.map(p => `  ${p.id} · ${p.name}${p.targetSharePct != null ? ` · ${p.targetSharePct}%` : ""}`),
      (() => {
        const due = recurringItems.filter(r => recurringMatchesDate(r, dateStr, weekday));
        return due.length ? `Rituals due this date (need their pillar blocked): ${due.map(r => `"${r.title}" (pillar ${r.pillarId})`).join(", ")}` : "";
      })(),
      `Normal template for this weekday:`,
      ...(templates.length ? templates.map(t => `  ${fmt(t.startMin)}-${fmt(t.endMin)} ${t.title} (pillar ${t.pillarId ?? "none"})`) : ["  (none)"]),
      events.length ? `Immovable diary events:` : "No diary events.",
      ...events.filter(e => !e.allDay).map(e => `  ${fmt(e.startMin)}-${fmt(e.endMin)} ${e.title}`),
      locked.length ? `Locked blocks (already done/skipped/past — do NOT include, plan around them):` : "",
      ...locked.map(b => `  ${fmt(b.startMin)}-${fmt(b.endMin)} ${b.title} [${b.status}]`),
      movable.length ? `Existing movable blocks (these will be REPLACED by your plan):` : "No existing movable blocks.",
      ...movable.map(b => `  ${fmt(b.startMin)}-${fmt(b.endMin)} ${b.title} (pillar ${b.pillarId ?? "none"})`),
    ].filter(Boolean).join("\n");

    const client = getClaudeClient();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      system: [
        "You are the scheduling assistant inside The Calzone Kitchen founder's day planner.",
        "Produce a realistic time-blocked plan for the REMAINDER of the day via the set_day_plan tool only.",
        "Rules: never overlap diary events or locked blocks; blocks must not overlap each other;",
        "5-minute granularity; respect the founder's stated constraints above all;",
        "otherwise follow the weekday template's shape and the pillars' intent;",
        "if a daily ritual's pillar can be fitted, keep at least one block for that pillar;",
        "don't fill every minute — leave small gaps between long stretches.",
      ].join(" "),
      messages: [{
        role: "user",
        content: `${context}\n\nFounder's instruction: ${prompt}`,
      }],
      tools: [REPLAN_TOOL],
      tool_choice: { type: "tool", name: "set_day_plan" },
    });

    const toolUse = response.content.find(c => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      res.status(502).json({ error: "AI did not return a plan — try again." });
      return;
    }
    const plan = toolUse.input as { explanation?: string; blocks?: Array<{ startMin: number; endMin: number; pillarId?: number | null; title?: string }> };
    const pillarIds = new Set(pillars.map(p => p.id));
    const newBlocks = (plan.blocks ?? [])
      .filter(b => Number.isInteger(b.startMin) && Number.isInteger(b.endMin) && b.endMin > b.startMin && b.startMin >= 0 && b.endMin <= 1440)
      .filter(b => !isToday || b.endMin > now)
      .map(b => ({
        startMin: b.startMin,
        endMin: b.endMin,
        pillarId: b.pillarId != null && pillarIds.has(b.pillarId) ? b.pillarId : null,
        title: b.title?.trim() || (b.pillarId != null ? pillars.find(p => p.id === b.pillarId)?.name : null) || "Focus",
      }));

    if (newBlocks.length === 0) {
      res.status(422).json({ error: "The AI returned an empty plan — nothing was changed. Try rephrasing." });
      return;
    }

    // Swap the movable blocks for the new plan.
    for (const b of movable) {
      await db.delete(founderBlocksTable).where(eq(founderBlocksTable.id, b.id));
    }
    for (const b of newBlocks) {
      await db.insert(founderBlocksTable).values({
        date: dateStr,
        startMin: b.startMin,
        endMin: b.endMin,
        pillarId: b.pillarId,
        title: b.title,
        source: "caz",
      });
    }

    res.json({ explanation: plan.explanation ?? "Day replanned.", replaced: movable.length, created: newBlocks.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[founder-focus] replan error:", msg);
    res.status(502).json({ error: `Replan failed: ${msg}` });
  }
});

// ── Parking lot ────────────────────────────────────────────────────────────
router.post("/parking-lot", async (req: Request, res: Response) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "text required" }); return; }
  const [row] = await db.insert(founderParkingLotTable).values({ text: parsed.data.text }).returning();
  res.status(201).json(row);
});

router.patch("/parking-lot/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({ resolved: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "resolved boolean required" }); return; }
  const [row] = await db.update(founderParkingLotTable)
    .set({ resolvedAt: parsed.data.resolved ? new Date() : null })
    .where(eq(founderParkingLotTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(row);
});

router.delete("/parking-lot/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderParkingLotTable).where(eq(founderParkingLotTable.id, id));
  res.json({ ok: true });
});

export default router;
