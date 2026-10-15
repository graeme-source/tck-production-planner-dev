/**
 * The email plan's cycle (Graeme, 2026-10-14), mounted at
 * /api/marketing-calendar/cycle. Objective I.
 *
 *   GET  /                    the cycle config, key dates and week products
 *   GET  /results             Klaviyo results per sent email (read-only)
 *   POST /slots/:date         make the cycle slot on that day a stored
 *                             planned email (idempotent) — then it is edited,
 *                             linked, approved and ticked like any other
 *   POST /days/:date/remove   delete an email from that day (and the day's
 *                             cycle email, which then stays gone)
 *   PUT  /weeks/:monday       the product added that week
 *   Calendar setup (FOUNDER only — "Calendar setup panel (founder)"):
 *   PUT  /settings            start Monday, weekly plan, Saturday ideas
 *   POST/PATCH/DELETE /offers, /key-dates, /pauses   (deletes are soft)
 *
 * Seeing the plan and the day-to-day writes need Sales & Marketing
 * (founder.sales), same as the rest of the calendar. Nothing here writes to
 * Klaviyo.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db, marketingCycleOffersTable, marketingCyclePausesTable, marketingCycleSettingsTable, marketingCycleWeeksTable,
  marketingKeyDatesTable, usersTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { OFFER_EMAIL_TYPES, PLAN_DAY_TYPES, mondayIndex, startOfWeek } from "@workspace/marketing-calendar";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { loadCycle, materialiseSlot, offerJson, removeDayEmail } from "../lib/email-cycle-data";
import { klaviyoCampaignResults } from "../lib/klaviyo-campaign-calendar";
import { forgetAutoLinkRun } from "../lib/klaviyo-auto-link-run";

const router: IRouter = Router();
router.use(requireFounderArea("founder.sales"));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IsoDate = z.string().regex(DATE_RE, "Use YYYY-MM-DD");
const Monday = IsoDate.refine(d => mondayIndex(d) === 0, { message: "Pick a Monday" });
export const OFFER_COLOURS = ["green", "rust", "plum", "blue", "gold", "teal", "rose", "slate"] as const;

async function sessionUser(req: Request): Promise<{ id: number; name: string; email: string | null }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone", email: u?.email ?? null };
}

function idParam(req: Request): number | null {
  const id = Number(req.params["id"]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── Read ───────────────────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const [cycle, settingsRow, products, me] = await Promise.all([
    loadCycle(),
    db.select().from(marketingCycleSettingsTable).where(eq(marketingCycleSettingsTable.id, 1)),
    db.select().from(marketingCycleWeeksTable),
    sessionUser(req),
  ]);
  res.json({
    ...cycle,
    // Anyone with Sales & Marketing access edits the setup too — Graeme and
    // whoever he grants it to (Graeme, 2026-10-14: "Tommy to be able to edit
    // the setup as well"). The router already requires that grant.
    canEditSetup: true,
    settings: settingsRow[0] ? { updatedBy: settingsRow[0].updatedByName, updatedAt: settingsRow[0].updatedAt.toISOString() } : null,
    products: Object.fromEntries(products.filter(p => p.product).map(p => [p.weekStart, p.product])),
  });
});

router.get("/results", async (_req: Request, res: Response) => {
  try {
    res.json(await klaviyoCampaignResults());
  } catch (err) {
    console.error("[email-cycle] results failed:", err instanceof Error ? err.message : String(err));
    res.json({ connected: true, results: [], updatedAt: null, error: "Couldn't load Klaviyo results just now" });
  }
});

// ── A slot becomes a stored planned email ──────────────────────────────────
router.post("/slots/:date", validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const date = String(req.params["date"] ?? "");
  if (!DATE_RE.test(date)) { res.status(400).json({ error: "Use YYYY-MM-DD" }); return; }
  const user = await sessionUser(req);
  const r = await db.transaction(tx => materialiseSlot(tx, date, { id: user.id, name: user.name }));
  if (r.status === 404) { res.status(404).json({ error: r.error }); return; }
  if (r.created) forgetAutoLinkRun();
  res.status(r.created ? 201 : 200).json({ emailId: r.row.id, created: r.created });
});

// ── Delete an email from a day (Graeme, 2026-10-15) ───────────────────────
// emailId: the stored email to delete; slot: the day's cycle email goes too
// and stays gone (removeDayEmail). Soft — history kept.
const RemoveBody = z.object({ emailId: z.number().int().positive().nullable(), slot: z.boolean() })
  .refine(b => b.emailId != null || b.slot, { message: "Nothing to delete" });

router.post("/days/:date/remove", validate(RemoveBody), async (req: Request, res: Response) => {
  const date = String(req.params["date"] ?? "");
  if (!DATE_RE.test(date)) { res.status(400).json({ error: "Use YYYY-MM-DD" }); return; }
  const b = req.body as z.infer<typeof RemoveBody>;
  const user = await sessionUser(req);
  const r = await db.transaction(tx => removeDayEmail(tx, date, b, { id: user.id, name: user.name }));
  forgetAutoLinkRun();
  res.json(r);
});

// ── Product of the week (day-to-day: anyone on the page) ───────────────────
const WeekBody = z.object({ product: z.string().trim().max(120).nullable() });

router.put("/weeks/:monday", validate(WeekBody), async (req: Request, res: Response) => {
  const parsed = Monday.safeParse(String(req.params["monday"] ?? ""));
  if (!parsed.success) { res.status(400).json({ error: "Pick a Monday" }); return; }
  const { product } = req.body as z.infer<typeof WeekBody>;
  const user = await sessionUser(req);
  const value = product || null;
  await db.insert(marketingCycleWeeksTable).values({
    weekStart: parsed.data, product: value, updatedById: user.id, updatedByName: user.name,
  }).onConflictDoUpdate({
    target: marketingCycleWeeksTable.weekStart,
    set: { product: value, updatedById: user.id, updatedByName: user.name, updatedAt: new Date() },
  });
  res.json({ weekStart: parsed.data, product: value });
});

// ── Calendar setup (founder only) ──────────────────────────────────────────
const PlanDay = z.enum(PLAN_DAY_TYPES as unknown as [string, ...string[]]).nullable();
const Idea = z.object({ idea: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(200) });
const SettingsBody = z.object({
  startDate: Monday.optional(),
  weeklyPlan: z.array(PlanDay).length(7).optional(),
  freeSlotIdeas: z.array(Idea).max(52).optional(),
});

router.put("/settings", validate(SettingsBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof SettingsBody>;
  const user = await sessionUser(req);
  const [current] = await db.select().from(marketingCycleSettingsTable).where(eq(marketingCycleSettingsTable.id, 1));
  const values = {
    startDate: b.startDate ?? current?.startDate ?? startOfWeek(new Date().toISOString().slice(0, 10)),
    weeklyPlan: (b.weeklyPlan ?? current?.weeklyPlan ?? Array(7).fill(null)) as string[],
    freeSlotIdeas: b.freeSlotIdeas ?? current?.freeSlotIdeas ?? [],
    updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  };
  await db.insert(marketingCycleSettingsTable).values({ id: 1, ...values })
    .onConflictDoUpdate({ target: marketingCycleSettingsTable.id, set: values });
  forgetAutoLinkRun();
  res.json({ ok: true });
});

const Subjects = z.object(Object.fromEntries(OFFER_EMAIL_TYPES.map(t => [t, z.string().trim().max(200).nullable().optional()])) as Record<(typeof OFFER_EMAIL_TYPES)[number], z.ZodOptional<z.ZodNullable<z.ZodString>>>);
const OfferFields = {
  code: z.string().trim().min(1, "Give it a short code").max(80),
  name: z.string().trim().min(1, "Say what the offer is").max(200),
  tag: z.string().trim().max(40).nullable(),
  colour: z.enum(OFFER_COLOURS),
  featuresProduct: z.boolean(),
  subjects: Subjects,
  position: z.number().int().min(0).max(1000),
};
const OfferCreate = z.object(OfferFields).partial().extend({ code: OfferFields.code, name: OfferFields.name });
const OfferPatch = z.object(OfferFields).partial();

router.post("/offers", validate(OfferCreate), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof OfferCreate>;
  const user = await sessionUser(req);
  const [{ next }] = (await db.execute<{ next: number }>(sql`SELECT COALESCE(MAX(position), 0) + 1 AS next FROM marketing_cycle_offers WHERE deleted_at IS NULL`)).rows;
  const [row] = await db.insert(marketingCycleOffersTable).values({
    code: b.code, name: b.name, tag: b.tag ?? null, colour: b.colour ?? "green", featuresProduct: b.featuresProduct ?? false,
    subjects: b.subjects ?? {}, position: b.position ?? Number(next),
    createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
  }).returning();
  forgetAutoLinkRun();
  res.status(201).json({ offer: offerJson(row) });
});

router.patch("/offers/:id", validate(OfferPatch), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof OfferPatch>;
  const user = await sessionUser(req);
  const [before] = await db.select().from(marketingCycleOffersTable).where(and(eq(marketingCycleOffersTable.id, id), isNull(marketingCycleOffersTable.deletedAt)));
  if (!before) { res.status(404).json({ error: "Offer not found" }); return; }
  const subjects = b.subjects ? { ...(before.subjects as object), ...b.subjects } : undefined;
  const [row] = await db.update(marketingCycleOffersTable).set({
    ...(b.code !== undefined ? { code: b.code } : {}),
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.tag !== undefined ? { tag: b.tag || null } : {}),
    ...(b.colour !== undefined ? { colour: b.colour } : {}),
    ...(b.featuresProduct !== undefined ? { featuresProduct: b.featuresProduct } : {}),
    ...(subjects ? { subjects } : {}),
    ...(b.position !== undefined ? { position: b.position } : {}),
    updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(eq(marketingCycleOffersTable.id, id)).returning();
  forgetAutoLinkRun();
  res.json({ offer: offerJson(row) });
});

router.delete("/offers/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const r = await db.update(marketingCycleOffersTable).set({ deletedAt: new Date(), updatedById: user.id, updatedByName: user.name, updatedAt: new Date() })
    .where(and(eq(marketingCycleOffersTable.id, id), isNull(marketingCycleOffersTable.deletedAt))).returning({ id: marketingCycleOffersTable.id });
  if (!r.length) { res.status(404).json({ error: "Offer not found" }); return; }
  res.json({ ok: true });
});

// Key dates
const KeyDateFields = { date: IsoDate, name: z.string().trim().min(1, "Name the day").max(120), big: z.boolean() };
const KeyDateCreate = z.object(KeyDateFields).partial({ big: true });
const KeyDatePatch = z.object(KeyDateFields).partial();

router.post("/key-dates", validate(KeyDateCreate), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof KeyDateCreate>;
  const user = await sessionUser(req);
  const [row] = await db.insert(marketingKeyDatesTable).values({ date: b.date, name: b.name, big: b.big ?? false, updatedById: user.id, updatedByName: user.name }).returning();
  res.status(201).json({ keyDate: { id: row.id, date: row.date, name: row.name, big: row.big } });
});

router.patch("/key-dates/:id", validate(KeyDatePatch), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof KeyDatePatch>;
  const user = await sessionUser(req);
  const [row] = await db.update(marketingKeyDatesTable).set({ ...b, updatedById: user.id, updatedByName: user.name, updatedAt: new Date() })
    .where(and(eq(marketingKeyDatesTable.id, id), isNull(marketingKeyDatesTable.deletedAt))).returning();
  if (!row) { res.status(404).json({ error: "Key date not found" }); return; }
  res.json({ keyDate: { id: row.id, date: row.date, name: row.name, big: row.big } });
});

router.delete("/key-dates/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const r = await db.update(marketingKeyDatesTable).set({ deletedAt: new Date(), updatedById: user.id, updatedByName: user.name, updatedAt: new Date() })
    .where(and(eq(marketingKeyDatesTable.id, id), isNull(marketingKeyDatesTable.deletedAt))).returning({ id: marketingKeyDatesTable.id });
  if (!r.length) { res.status(404).json({ error: "Key date not found" }); return; }
  res.json({ ok: true });
});

// Pauses
const PauseFields = { name: z.string().trim().min(1, "Name the pause").max(120), startDate: IsoDate, endDate: IsoDate };
const PauseCreate = z.object(PauseFields).refine(b => b.endDate >= b.startDate, { message: "The end can't be before the start" });
const PausePatch = z.object(PauseFields).partial();

router.post("/pauses", validate(PauseCreate), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof PauseCreate>;
  const user = await sessionUser(req);
  const [row] = await db.insert(marketingCyclePausesTable).values({ ...b, updatedById: user.id, updatedByName: user.name }).returning();
  forgetAutoLinkRun();
  res.status(201).json({ pause: { id: row.id, name: row.name, startDate: row.startDate, endDate: row.endDate } });
});

router.patch("/pauses/:id", validate(PausePatch), async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as z.infer<typeof PausePatch>;
  const user = await sessionUser(req);
  const [before] = await db.select().from(marketingCyclePausesTable).where(and(eq(marketingCyclePausesTable.id, id), isNull(marketingCyclePausesTable.deletedAt)));
  if (!before) { res.status(404).json({ error: "Pause not found" }); return; }
  const start = b.startDate ?? before.startDate, end = b.endDate ?? before.endDate;
  if (end < start) { res.status(400).json({ error: "The end can't be before the start" }); return; }
  const [row] = await db.update(marketingCyclePausesTable).set({ ...b, updatedById: user.id, updatedByName: user.name, updatedAt: new Date() })
    .where(eq(marketingCyclePausesTable.id, id)).returning();
  forgetAutoLinkRun();
  res.json({ pause: { id: row.id, name: row.name, startDate: row.startDate, endDate: row.endDate } });
});

router.delete("/pauses/:id", async (req: Request, res: Response) => {
  const id = idParam(req);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = await sessionUser(req);
  const r = await db.update(marketingCyclePausesTable).set({ deletedAt: new Date(), updatedById: user.id, updatedByName: user.name, updatedAt: new Date() })
    .where(and(eq(marketingCyclePausesTable.id, id), isNull(marketingCyclePausesTable.deletedAt))).returning({ id: marketingCyclePausesTable.id });
  if (!r.length) { res.status(404).json({ error: "Pause not found" }); return; }
  res.json({ ok: true });
});

export default router;
