import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  founderPillarsTable,
  founderGoalsTable,
  founderBlocksTable,
  founderBlockTemplatesTable,
  founderParkingLotTable,
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
const CALDAV_DISABLED_KEY = "caldav_disabled_calendars";

async function getDisabledCalendarUrls(): Promise<Set<string>> {
  const raw = await getFounderSetting(CALDAV_DISABLED_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
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
    const [pillars, goals, blocks, templates, parkingLot, appleId, appPassword] = await Promise.all([
      db.select().from(founderPillarsTable).where(isNull(founderPillarsTable.archivedAt)).orderBy(asc(founderPillarsTable.sort), asc(founderPillarsTable.id)),
      db.select().from(founderGoalsTable).orderBy(asc(founderGoalsTable.sort), asc(founderGoalsTable.id)),
      db.select().from(founderBlocksTable).where(eq(founderBlocksTable.date, dateStr)).orderBy(asc(founderBlocksTable.startMin)),
      db.select().from(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.weekday, weekday)).orderBy(asc(founderBlockTemplatesTable.startMin)),
      db.select().from(founderParkingLotTable).where(isNull(founderParkingLotTable.resolvedAt)).orderBy(asc(founderParkingLotTable.createdAt)),
      getFounderSetting(CALDAV_ID_KEY),
      getFounderSetting(CALDAV_PW_KEY),
    ]);

    // Apple Calendar is best-effort: an iCloud wobble must never take the
    // whole Focus page down, so failures degrade to an inline warning.
    let events: CalendarEvent[] = [];
    let calendarError: string | null = null;
    const calendarConfigured = !!(appleId && appPassword);
    if (calendarConfigured) {
      try {
        events = await getDayEvents(appleId, appPassword, dateStr, await getDisabledCalendarUrls());
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
    const [calendars, disabled] = await Promise.all([verifyCaldav(appleId, password), getDisabledCalendarUrls()]);
    res.json({
      configured: true,
      appleId,
      calendars: calendars.map(c => ({ ...c, enabled: !disabled.has(c.url) })),
    });
  } catch (err) {
    res.json({ configured: true, appleId, calendars: [], error: err instanceof Error ? err.message : String(err) });
  }
});

// Per-calendar on/off. Stored as a DISABLED list so calendars added in
// Apple later default to visible.
router.put("/caldav/calendars", async (req: Request, res: Response) => {
  const parsed = z.object({ disabledUrls: z.array(z.string().min(1)).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "disabledUrls: string[] required" }); return; }
  await setFounderSetting(CALDAV_DISABLED_KEY, JSON.stringify(parsed.data.disabledUrls));
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
  await deleteFounderSetting(CALDAV_DISABLED_KEY);
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
const BlockBody = z.object({
  date: z.string().regex(DATE_RE),
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  pillarId: z.number().int().nullish(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
}).refine(b => b.endMin > b.startMin, { message: "endMin must be after startMin" });

router.post("/blocks", async (req: Request, res: Response) => {
  const parsed = BlockBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const b = parsed.data;
  const [row] = await db.insert(founderBlocksTable).values({
    date: b.date,
    startMin: b.startMin,
    endMin: b.endMin,
    pillarId: b.pillarId ?? null,
    title: b.title,
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
  title: z.string().trim().min(1).max(200),
}).refine(t => t.endMin > t.startMin, { message: "endMin must be after startMin" });

router.post("/templates", async (req: Request, res: Response) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }); return; }
  const t = parsed.data;
  const [row] = await db.insert(founderBlockTemplatesTable).values({
    weekday: t.weekday,
    startMin: t.startMin,
    endMin: t.endMin,
    pillarId: t.pillarId ?? null,
    title: t.title,
  }).returning();
  res.status(201).json(row);
});

router.delete("/templates/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(founderBlockTemplatesTable).where(eq(founderBlockTemplatesTable.id, id));
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
