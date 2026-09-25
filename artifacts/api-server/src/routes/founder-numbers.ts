/**
 * Founder Numbers page — trend graphs behind the tiles (Objective I).
 *
 *   GET /api/founder-numbers/trend?from=YYYY-MM-DD&to=YYYY-MM-DD[&granularity=hour|day|week]
 *
 * One read returns EVERY graphed metric per bucket for the period — sales,
 * orders, AOV, new-customer revenue/count, subscription counts/revenue, ad
 * spend and ROAS — so opening a second graph costs nothing. Orders come
 * from the same London-day mirror read as the tiles (getOrdersByLondonDays)
 * and are valued by the same rules (lib/order-revenue.ts); the bucketing
 * and maths are pure and tested in lib/sales-trend.ts.
 *
 * Founder account only — exact email match (middleware/founder-access.ts),
 * the same gate as the other Numbers endpoints. An admin is not the founder.
 *
 * Cached for a minute per period+grain: the mirror syncs at most every 30s
 * anyway, and flicking between graphs shouldn't re-read a year of orders.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireFounder } from "../middleware/founder-access";
import { validateQuery } from "../middleware/validate";
import { getOrdersByLondonDays } from "../services/shopify";
import {
  buildTrendSeries, dayCountBetween, resolveGranularity, MAX_TREND_DAYS,
  type Granularity, type SpendDay, type TrendSeries,
} from "../lib/sales-trend";

const router: IRouter = Router();
router.use(requireFounder);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const trendQuery = z.object({
  from: z.string().regex(DATE_RE, "from must be YYYY-MM-DD"),
  to: z.string().regex(DATE_RE, "to must be YYYY-MM-DD"),
  granularity: z.enum(["hour", "day", "week"]).optional(),
})
  .refine(q => q.from <= q.to, { message: "from must not be after to", path: ["from"] })
  .refine(q => dayCountBetween(q.from, q.to) <= MAX_TREND_DAYS, { message: `${MAX_TREND_DAYS} days maximum`, path: ["to"] });

type TrendQuery = z.infer<typeof trendQuery>;

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 40;
const cache = new Map<string, { at: number; data: TrendSeries }>();

function cached(key: string): TrendSeries | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.data;
}

function remember(key: string, data: TrendSeries): void {
  cache.set(key, { at: Date.now(), data });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function spendDays(from: string, to: string): Promise<SpendDay[]> {
  const rows = await db.execute<{ spend_date: string | Date; amount: string | null }>(sql`
    SELECT spend_date, amount FROM founder_ad_spend
    WHERE spend_date >= ${from} AND spend_date <= ${to}
    ORDER BY spend_date ASC
  `);
  return rows.rows.map(row => ({
    // DATE column: node-postgres may return a Date — normalise to YYYY-MM-DD.
    date: typeof row.spend_date === "string" ? row.spend_date.slice(0, 10) : new Date(row.spend_date).toISOString().slice(0, 10),
    amount: row.amount != null ? Number(row.amount) : null,
  }));
}

router.get("/trend", validateQuery(trendQuery), async (_req: Request, res: Response) => {
  const { from, to, granularity: requested } = res.locals["query"] as TrendQuery;
  const granularity: Granularity = resolveGranularity(dayCountBetween(from, to), requested);
  const key = `${from}|${to}|${granularity}`;
  const hit = cached(key);
  if (hit) { res.json(hit); return; }
  try {
    const [orders, spend] = await Promise.all([getOrdersByLondonDays(from, to), spendDays(from, to)]);
    const series = buildTrendSeries({ from, to, granularity, orders, spend, now: new Date() });
    if (series.outsideOrders > 0) {
      console.warn(`[founder-numbers] trend ${from}→${to}: ${series.outsideOrders} order(s) outside the London days read — check the mirror bounds`);
    }
    remember(key, series);
    res.json(series);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[founder-numbers] trend error:", msg);
    res.status(502).json({ error: msg });
  }
});

export default router;
