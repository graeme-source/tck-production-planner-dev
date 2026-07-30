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
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { verifyCaldav, getDayEvents, resetCaldavCache, type CalendarEvent } from "../lib/caldav";

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

    const [pillars, goals, blocks, templates, parkingLot, recurringItems, ticks, appleId, appPassword] = await Promise.all([
      db.select().from(founderPillarsTable).where(isNull(founderPillarsTable.archivedAt)).orderBy(asc(founderPillarsTable.sort), asc(founderPillarsTable.id)),
      db.select().from(founderGoalsTable).orderBy(asc(founderGoalsTable.sort), asc(founderGoalsTable.id)),
      db.select().from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)).orderBy(asc(founderBlocksTable.startMin)),
      db.select().from(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, weekday)).orderBy(asc(founderBlockTemplatesTable.startMin)),
      db.select().from(founderParkingLotTable).where(isNull(founderParkingLotTable.resolvedAt)).orderBy(asc(founderParkingLotTable.createdAt)),
      db.select().from(founderRecurringItemsTable).where(isNull(founderRecurringItemsTable.archivedAt)).orderBy(asc(founderRecurringItemsTable.sort), asc(founderRecurringItemsTable.id)),
      db.select().from(founderRecurringTicksTable).where(eq(founderRecurringTicksTable.date, dateStr)),
      getFounderSetting(CALDAV_ID_KEY),
      getFounderSetting(CALDAV_PW_KEY),
    ]);

    const tickedItemIds = new Set(ticks.map(t => t.itemId));

    // Apple Calendar is best-effort: an iCloud wobble must never take the
    // whole Focus page down, so failures degrade to an inline warning.
    let events: CalendarEvent[] = [];
    let calendarError: string | null = null;
    const calendarConfigured = !!(appleId && appPassword);
    if (calendarConfigured) {
      try {
        events = await getDayEvents(appleId, appPassword, dateStr, await getEnabledCalendarUrls());
      } catch (err) {
        calendarError = err instanceof Error ? err.message : String(err);
      }
    }

    res.json({
      date: dateStr,
      weekday,
      pillars: pillars.map(p => ({ ...p, goals: goals.filter(g => g.pillarId === p.id) })),
      blocks,
      templates,
      parkingLot,
      recurringItems: recurringItems.map(i => ({ ...i, ticked: tickedItemIds.has(i.id) })),
      calendarConfigured,
      events,
      calendarError,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
const GoalBody = z.object({
  pillarId: z.number().int(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).nullish(),
  sort: z.number().int().optional(),
});

router.post("/goals", async (req: Request, res: Response) => {
  const parsed = GoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const [row] = await db.insert(founderGoalsTable).values({
    pillarId: parsed.data.pillarId,
    title: parsed.data.title,
    detail: parsed.data.detail ?? null,
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
  const { status, ...fields } = parsed.data;
  const [row] = await db.update(founderGoalsTable)
    .set({
      ...fields,
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

router.delete("/templates/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.id, id));
  res.json({ ok: true });
});

// ── Recurring items (per-pillar daily rituals) ─────────────────────────────
router.post("/recurring-items", async (req: Request, res: Response) => {
  const parsed = z.object({
    pillarId: z.number().int(),
    title: z.string().trim().min(1).max(200),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "pillarId and title required" }); return; }
  const [row] = await db.insert(founderRecurringItemsTable).values({
    pillarId: parsed.data.pillarId,
    title: parsed.data.title,
  }).returning();
  res.status(201).json(row);
});

router.patch("/recurring-items/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { archived, ...fields } = parsed.data;
  const [row] = await db.update(founderRecurringItemsTable)
    .set({
      ...fields,
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
