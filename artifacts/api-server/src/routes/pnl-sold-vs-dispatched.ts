/**
 * /api/pnl-sold-vs-dispatched — "Orders sold vs dispatched" on the founder
 * P&L page, for balancing the P&L each month (Objective I, finance &
 * reporting). Founder only.
 *
 *   GET ?fromMonth=2026-08&toMonth=2026-11   one row per whole month
 *   GET ?from=2026-10-03&to=2026-11-18       one row for a custom range
 *   (neither → the last 3 complete months plus this month so far)
 *
 * Read-only: Shopify orders come from the mirror (lib/orders-cache.ts),
 * APC scans from apc_consignments. The counting rules live in
 * lib/pnl-sold-vs-dispatched.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { requireFounder } from "../middleware/founder-access";
import { validateQuery } from "../middleware/validate";
import { londonDateString, addDaysToDateString } from "../lib/london-time";
import { getCachedOrderSummaries } from "../lib/orders-cache";
import {
  defaultMonths, monthPeriods, ordersWindow, periodKeyForDay, rangePeriod, soldVsDispatched,
  VALUE_BASIS, type Period,
} from "../lib/pnl-sold-vs-dispatched";

const router: IRouter = Router();
router.use(requireFounder);

/** First APC scan was 06:45 on 30 Jul 2026 — no cross-check before that. */
const APC_FROM = "2026-07-30";
/** At most this many months in one request (keeps the order read bounded). */
const MAX_MONTHS = 24;

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()), "Not a date");

export const SoldVsDispatchedQuery = z.object({
  fromMonth: MONTH.optional(),
  toMonth: MONTH.optional(),
  from: DATE.optional(),
  to: DATE.optional(),
})
  .refine(q => (q.from == null) === (q.to == null), "from and to go together")
  .refine(q => (q.fromMonth == null) === (q.toMonth == null), "fromMonth and toMonth go together")
  .refine(q => !(q.from && q.fromMonth), "Use months or dates, not both")
  .refine(q => !q.from || !q.to || q.from <= q.to, "from must be on or before to")
  .refine(q => !q.fromMonth || !q.toMonth || q.fromMonth <= q.toMonth, "fromMonth must be on or before toMonth");

type Query = z.infer<typeof SoldVsDispatchedQuery>;

function periodsFor(q: Query, today: string): Period[] {
  if (q.from && q.to) return [rangePeriod(q.from, q.to, today)];
  const m = q.fromMonth && q.toMonth ? { fromMonth: q.fromMonth, toMonth: q.toMonth } : defaultMonths(today);
  return monthPeriods(m.fromMonth, m.toMonth, today);
}

/** Distinct orders scanned onto APC per period (verified_at is naive UTC). */
async function apcScannedByPeriod(periods: readonly Period[]): Promise<Map<string, number>> {
  const from = periods[0]!.from;
  const to = periods[periods.length - 1]!.to;
  const r = await db.execute<{ day: string; order_id: string }>(sql`
    SELECT DISTINCT ((verified_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date::text AS day,
           shopify_order_id::text AS order_id
    FROM apc_consignments
    WHERE shopify_order_id IS NOT NULL
      AND verified_at >= ${`${addDaysToDateString(from, -1)}T00:00:00`}::timestamp
      AND verified_at <  ${`${addDaysToDateString(to, 2)}T00:00:00`}::timestamp
  `);
  const sets = new Map<string, Set<string>>();
  for (const row of r.rows) {
    const key = periodKeyForDay(row.day, periods);
    if (!key) continue;
    if (!sets.has(key)) sets.set(key, new Set());
    sets.get(key)!.add(row.order_id);
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}

router.get("/", validateQuery(SoldVsDispatchedQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as Query;
  const today = londonDateString();
  const periods = periodsFor(q, today);
  if (periods.length === 0 || periods.length > MAX_MONTHS) {
    res.status(400).json({ error: `Pick between 1 and ${MAX_MONTHS} months` });
    return;
  }
  try {
    // A day either side: the mirror reads UTC days, the rules London days.
    const w = ordersWindow(periods);
    const orders = await getCachedOrderSummaries(addDaysToDateString(w.from, -1), addDaysToDateString(w.to, 1));
    const scannedByPeriod = await apcScannedByPeriod(periods);
    const report = soldVsDispatched(orders, periods, { scannedByPeriod, apcFrom: APC_FROM }, today);
    res.json({ ...report, valueBasis: VALUE_BASIS, apcFrom: APC_FROM, today });
  } catch (err) {
    console.error("[pnl-sold-vs-dispatched] failed:", err instanceof Error ? err.message : String(err));
    res.status(502).json({ error: "Couldn't count sold and dispatched orders — try again" });
  }
});

export default router;
