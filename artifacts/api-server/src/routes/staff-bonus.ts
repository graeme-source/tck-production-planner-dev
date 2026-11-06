/**
 * The Business → Bonus calculator (Graeme, 29 Oct 2026): the founder's own,
 * behind his private PIN — "I don't want Tommy to have access to it".
 * requireFounder (no grant opens it, not even founder.sales) and
 * requirePeopleUnlock (423 until the private PIN is entered) on every route.
 *
 * The scheme's numbers live in founder_settings (key staff_bonus_scheme),
 * which only founder routes read — never app_settings, whose GET is open to
 * every signed-in user. The maths is client-side (lib/staff-bonus.ts); this
 * only stores the numbers and hands over the month targets. Objective I.
 *
 * 6 Nov 2026: each month's revenue is that month's sales, the same as Month to
 * Date on Numbers (GET /month/:month). Its net operating profit comes from the
 * QuickBooks Profit and Loss report for finished months; a typed figure wins
 * (PUT /month/:month, autosaved).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { addMonths, isMonthKey, monthOf, targetsForMonths } from "@workspace/revenue-targets";
import { getOrdersByLondonDays } from "../services/shopify";
import { monthDays, monthRevenue } from "../lib/bonus-month-revenue";
import { qboProfitForMonth } from "../lib/finance/qbo-profit";
import { requireFounder } from "../middleware/founder-access";
import { requirePeopleUnlock } from "../middleware/people-unlock";
import { validate } from "../middleware/validate";
import { loadRevenueTargetsState } from "../lib/revenue-targets-store";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();
router.use(requireFounder, requirePeopleUnlock);

const KEY = "staff_bonus_scheme";

export const SchemeBody = z.object({
  atMinimum: z.number().min(0).max(100_000),
  atStretch: z.number().min(0).max(100_000),
  curve: z.number().min(0.1).max(5),
  step: z.number().min(0).max(10_000_000),
  perStep: z.number().min(0).max(100_000),
  maxBonus: z.number().min(0).max(100_000),
  profitFloorPct: z.number().min(0).max(100),
  employerNiPct: z.number().min(0).max(100),
}).strict();

router.get("/scheme", async (_req: Request, res: Response) => {
  const row = (await db.execute<{ value: string; updated_at: string | null }>(
    sql`SELECT value, updated_at FROM founder_settings WHERE key = ${KEY} LIMIT 1`,
  )).rows[0];
  let scheme: unknown = null;
  try { scheme = row ? JSON.parse(row.value) : null; } catch { scheme = null; }
  const targets = await loadRevenueTargetsState();
  const thisMonth = monthOf(londonDateString());
  const months = [-2, -1, 0, 1, 2, 3].map(n => addMonths(thisMonth, n));
  const finished = months.filter(m => m < thisMonth);
  const today = londonDateString();
  const qboProfits = Object.fromEntries(await Promise.all(finished.map(async m => [m, (await readQboProfit(m, today)).profit] as const)));
  res.json({
    scheme,
    savedAt: row?.updated_at ?? null,
    thisMonth,
    months: targetsForMonths(months, targets.minimum, targets.rows, targets.minimums).map(t => ({ month: t.month, minimum: t.minimum, stretch: t.stretch })),
    // What's been typed for each month (profit, any revenue override), so
    // the page can show which finished months still await their profit.
    entries: await readMonthEntries(months),
    qboProfits,
  });
});

// ── One month: revenue + profit, each with a typed figure on top ─────────
//
// Revenue is the month's sales (lib/bonus-month-revenue.ts). Net operating
// profit is read from QuickBooks once the month has finished, and can keep
// moving until the books are signed off. A typed figure, if any, is used
// instead of either. Both are kept per month in founder_settings
// ("staff_bonus_month:YYYY-MM"), founder-only like the scheme.

async function readQboProfit(month: string, today: string): Promise<{ profit: number | null; error: string | null }> {
  try {
    return { profit: await qboProfitForMonth(month, today), error: null };
  } catch (err) {
    console.warn(`[staff-bonus] QuickBooks profit for ${month} failed:`, err instanceof Error ? err.message : err);
    return { profit: null, error: "Couldn't reach QuickBooks" };
  }
}

const MONTH_KEY_PREFIX = "staff_bonus_month:";

export interface MonthEntry {
  profit: number | null;
  profitSavedAt: string | null;
  revenueOverride: number | null;
  revenueOverrideSavedAt: string | null;
}

const EMPTY_ENTRY: MonthEntry = { profit: null, profitSavedAt: null, revenueOverride: null, revenueOverrideSavedAt: null };

function parseEntry(raw: string | null | undefined): MonthEntry {
  if (!raw) return { ...EMPTY_ENTRY };
  try {
    const v = JSON.parse(raw) as Partial<MonthEntry>;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const s = (x: unknown) => (typeof x === "string" ? x : null);
    return { profit: n(v.profit), profitSavedAt: s(v.profitSavedAt), revenueOverride: n(v.revenueOverride), revenueOverrideSavedAt: s(v.revenueOverrideSavedAt) };
  } catch {
    return { ...EMPTY_ENTRY };
  }
}

async function readMonthEntries(months: readonly string[]): Promise<Record<string, MonthEntry>> {
  const keys = months.map(m => `${MONTH_KEY_PREFIX}${m}`);
  const rows = (await db.execute<{ key: string; value: string }>(
    sql`SELECT key, value FROM founder_settings WHERE key IN (${sql.join(keys.map(k => sql`${k}`), sql`, `)})`,
  )).rows;
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  return Object.fromEntries(months.map(m => [m, parseEntry(byKey.get(`${MONTH_KEY_PREFIX}${m}`))]));
}

const MonthParam = z.string().refine(isMonthKey, "month must be YYYY-MM");
const money = z.number().finite().min(-100_000_000).max(100_000_000).nullable();
export const MonthEntryBody = z.object({
  profit: money.optional(),
  revenueOverride: money.optional(),
}).strict().refine(b => b.profit !== undefined || b.revenueOverride !== undefined, "Nothing to save");

router.get("/month/:month", async (req: Request, res: Response) => {
  const month = MonthParam.safeParse(req.params.month);
  if (!month.success) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
  const m = month.data;
  const today = londonDateString();
  const entry = (await readMonthEntries([m]))[m]!;
  const none = { qboProfit: null, qboError: null };
  if (m > monthOf(today)) { res.json({ month: m, revenue: null, revenueError: null, ...none, entry }); return; }
  const days = monthDays(m, today);
  let revenue: (ReturnType<typeof monthRevenue> & { complete: boolean }) | null = null;
  let revenueError: string | null = null;
  try {
    revenue = { ...monthRevenue(await getOrdersByLondonDays(days.from, days.to)), complete: days.complete };
  } catch (err) {
    console.error("[staff-bonus] month revenue failed:", err);
    revenueError = "Couldn't reach Shopify just now. Try again, or type a figure";
  }
  const profit = days.complete ? await readQboProfit(m, today) : { profit: null, error: null };
  res.json({ month: m, revenue, revenueError, qboProfit: profit.profit, qboError: profit.error, entry });
});

router.put("/month/:month", validate(MonthEntryBody), async (req: Request, res: Response) => {
  const month = MonthParam.safeParse(req.params.month);
  if (!month.success) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
  const body = MonthEntryBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid figures", details: body.error.flatten() }); return; }
  const now = new Date().toISOString();
  const patch: Partial<MonthEntry> = {};
  if (body.data.profit !== undefined) { patch.profit = body.data.profit; patch.profitSavedAt = now; }
  if (body.data.revenueOverride !== undefined) { patch.revenueOverride = body.data.revenueOverride; patch.revenueOverrideSavedAt = now; }
  // Merge in the database, so saving profit never overwrites an override
  // saved a moment earlier (and the other way round).
  const key = `${MONTH_KEY_PREFIX}${month.data}`;
  const row = (await db.execute<{ value: string }>(sql`
    INSERT INTO founder_settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(patch)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = (founder_settings.value::jsonb || EXCLUDED.value::jsonb)::text, updated_at = NOW()
    RETURNING value
  `)).rows[0];
  res.json({ ok: true, entry: parseEntry(row?.value) });
});

router.put("/scheme", validate(SchemeBody), async (req: Request, res: Response) => {
  const parsed = SchemeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid scheme", details: parsed.error.flatten() }); return; }
  await db.execute(sql`
    INSERT INTO founder_settings (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(parsed.data)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

export default router;
