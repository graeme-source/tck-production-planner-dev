/**
 * Sales drivers API (Graeme, 2026-10-16) — the website changelog and the
 * daily facts behind sales: delivery lead time, sessions, conversion.
 * Objective I. Read by Sales & Marketing (the full view) and Numbers (the
 * "what else is going on" notes under the spend advice), so either grant
 * opens the reads; changing the changelog needs Sales & Marketing.
 *
 *   GET    /overview?days=N     daily series, findings, changes with impact
 *   GET    /context?from&to     notes for the spend advice
 *   GET    /export?from&to      everything, as JSON, for AI analysis
 *   POST   /changes             quick-add a change
 *   PATCH  /changes/:id         edit a change
 *   DELETE /changes/:id         remove a manual change
 *   POST   /refresh             run the daily refresh + a delivery check now
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { londonDateString, addDaysToDateString } from "../lib/london-time";
import { buildFindings, withImpacts, contextNotes, type DailyRow, type ChangeRow } from "../lib/sales-drivers/report";
import { CHANGE_CATEGORIES } from "../lib/sales-drivers/changes";
import { runDailyRefresh, recordDeliveryAvailability } from "../lib/sales-drivers/collect";

const router: IRouter = Router();
const readAccess = requireFounderArea(["founder.sales", "founder.numbers"]);
const writeAccess = requireFounderArea("founder.sales");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** History used for findings — long enough for slow weeks to recur. */
const HISTORY_DAYS = 365;

async function loadDaily(from: string, to: string): Promise<DailyRow[]> {
  const r = await db.execute<{
    day: string; sessions: number | null; conversion_rate: string | null; orders: number | null;
    new_customer_orders: number | null; revenue: string | null; lead_days: number | null;
    next_day_available: boolean | null; lead_source: string | null; sample_orders: number | null;
  }>(sql`
    SELECT d.day::text AS day, m.sessions, m.conversion_rate::text, m.orders, m.new_customer_orders, m.revenue::text,
           a.lead_days, a.next_day_available, a.source AS lead_source, a.sample_orders
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d(day)
      LEFT JOIN store_daily_metrics m ON m.day = d.day::date
      LEFT JOIN delivery_availability_daily a ON a.day = d.day::date
     ORDER BY d.day
  `);
  return r.rows.map(x => ({
    day: x.day.slice(0, 10),
    sessions: x.sessions,
    conversionRate: x.conversion_rate == null ? null : Number(x.conversion_rate),
    orders: x.orders,
    newCustomerOrders: x.new_customer_orders,
    revenue: x.revenue == null ? null : Number(x.revenue),
    leadDays: x.lead_days,
    nextDayAvailable: x.next_day_available,
    leadSource: x.lead_source,
    sampleOrders: x.sample_orders,
  }));
}

async function loadChanges(from: string, to: string): Promise<ChangeRow[]> {
  const r = await db.execute<{ id: number; effective_at: string; category: string; title: string; detail: string | null; source: string }>(sql`
    SELECT id, effective_at, category, title, detail, source FROM site_changes
     WHERE effective_at >= ${`${from}T00:00:00Z`}::timestamptz AND effective_at < (${to}::date + 1)
     ORDER BY effective_at
  `);
  return r.rows.map(x => ({
    id: x.id, effectiveAt: new Date(x.effective_at).toISOString(), category: x.category,
    title: x.title, detail: x.detail, source: x.source,
  }));
}

function range(req: Request): { from: string; to: string } | null {
  const today = londonDateString();
  const to = typeof req.query.to === "string" ? req.query.to : addDaysToDateString(today, -1);
  const from = typeof req.query.from === "string" ? req.query.from : addDaysToDateString(to, -6);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return null;
  return { from, to };
}

router.get("/overview", readAccess, async (req: Request, res: Response) => {
  const n = Math.min(Math.max(Number(req.query.days) || 120, 14), HISTORY_DAYS);
  const today = londonDateString();
  const to = addDaysToDateString(today, -1);
  try {
    const history = await loadDaily(addDaysToDateString(to, -(HISTORY_DAYS - 1)), today);
    const shownFrom = addDaysToDateString(to, -(n - 1));
    const changes = await loadChanges(shownFrom, today);
    const latestCheck = await db.execute<{ day: string; checked_at: string; earliest_date: string | null; lead_days: number | null; next_day_available: boolean | null; source: string }>(sql`
      SELECT day::text, checked_at, earliest_date::text, lead_days, next_day_available, source
        FROM delivery_availability_daily WHERE source LIKE 'zapiet%' ORDER BY day DESC LIMIT 1
    `);
    // Findings use complete days only — today's sessions are still coming in.
    const complete = history.filter(r => r.day <= to);
    res.json({
      from: shownFrom,
      to,
      series: history.filter(r => r.day >= shownFrom),
      findings: buildFindings(complete),
      changes: withImpacts(changes, complete).reverse(),
      latestCheck: latestCheck.rows[0] ?? null,
    });
  } catch (err) {
    console.error("[sales-drivers] overview failed:", err);
    res.status(500).json({ error: "Couldn't load the sales drivers" });
  }
});

router.get("/context", readAccess, async (req: Request, res: Response) => {
  const r = range(req);
  if (!r) { res.status(400).json({ error: "from/to must be YYYY-MM-DD, from ≤ to" }); return; }
  try {
    const history = await loadDaily(addDaysToDateString(r.to, -(HISTORY_DAYS - 1)), r.to);
    const changes = await loadChanges(r.from, r.to);
    res.json({ from: r.from, to: r.to, notes: contextNotes(history, changes, r.from, r.to, buildFindings(history)) });
  } catch (err) {
    console.error("[sales-drivers] context failed:", err);
    res.status(500).json({ error: "Couldn't load what else was going on" });
  }
});

router.get("/export", readAccess, async (req: Request, res: Response) => {
  const today = londonDateString();
  const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : today;
  const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : addDaysToDateString(to, -(HISTORY_DAYS - 1));
  if (from > to) { res.status(400).json({ error: "from must be on or before to" }); return; }
  try {
    const daily = await loadDaily(from, to);
    const changes = await loadChanges(from, to);
    res.setHeader("Content-Disposition", `attachment; filename="tck-sales-drivers-${from}-to-${to}.json"`);
    res.json({
      about: "TCK daily sales drivers. conversionRate is Shopify's online-store rate (fraction). leadDays = calendar days from that day to the earliest bookable delivery; leadSource zapiet_1pm is the exact 1pm check, orders_estimate is inferred from the shortest wait booked before 1pm (sampleOrders = how many orders it rests on). changes = the website changelog (effectiveAt = when it went live).",
      from, to, daily, changes, findings: buildFindings(daily.filter(d => d.day < today)),
    });
  } catch (err) {
    console.error("[sales-drivers] export failed:", err);
    res.status(500).json({ error: "Couldn't build the export" });
  }
});

const changeBody = z.object({
  effectiveAt: z.string().datetime({ offset: true }),
  category: z.enum(CHANGE_CATEGORIES),
  title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(2000).nullable().optional(),
});

async function userName(req: Request): Promise<string | null> {
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId} LIMIT 1`);
  return r.rows[0]?.name ?? null;
}

router.post("/changes", writeAccess, validate(changeBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof changeBody>;
  try {
    const r = await db.execute<{ id: number }>(sql`
      INSERT INTO site_changes (effective_at, category, title, detail, source, created_by)
      VALUES (${b.effectiveAt}::timestamptz, ${b.category}, ${b.title}, ${b.detail ?? null}, 'manual', ${await userName(req)})
      RETURNING id
    `);
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    console.error("[sales-drivers] add change failed:", err);
    res.status(500).json({ error: "Couldn't save the change" });
  }
});

const changePatch = changeBody.partial();

router.patch("/changes/:id", writeAccess, validate(changePatch), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const b = req.body as z.infer<typeof changePatch>;
  try {
    const r = await db.execute(sql`
      UPDATE site_changes SET
        effective_at = COALESCE(${b.effectiveAt ?? null}::timestamptz, effective_at),
        category = COALESCE(${b.category ?? null}, category),
        title = COALESCE(${b.title ?? null}, title),
        detail = CASE WHEN ${b.detail !== undefined} THEN ${b.detail ?? null} ELSE detail END
      WHERE id = ${id}
    `);
    if (!r.rowCount) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error("[sales-drivers] edit change failed:", err);
    res.status(500).json({ error: "Couldn't save the change" });
  }
});

router.delete("/changes/:id", writeAccess, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  // Imported rows (theme, Klaviyo) would just come back on the next sync;
  // only hand-added entries can be removed.
  const r = await db.execute(sql`DELETE FROM site_changes WHERE id = ${id} AND source = 'manual'`);
  if (!r.rowCount) { res.status(404).json({ error: "Only hand-added changes can be removed" }); return; }
  res.json({ ok: true });
});

router.post("/refresh", writeAccess, validate(z.object({})), async (_req: Request, res: Response) => {
  try {
    const delivery = await recordDeliveryAvailability("zapiet_check");
    const refresh = await runDailyRefresh();
    res.json({ delivery, refresh });
  } catch (err) {
    console.error("[sales-drivers] refresh failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Refresh failed" });
  }
});

export default router;
