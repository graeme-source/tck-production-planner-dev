/**
 * End-of-week factory number for the Dispatch Orders panel (Graeme,
 * 16 Oct 2026). Objective C — see where the fridge lands on Sunday night.
 *
 *   GET /week-end-stock?weekStart=YYYY-MM-DD   (the Monday)
 *
 * This week (or next): the inputs for weekEndFactoryNumber() in
 * @workspace/stock-prediction — the panel adds the orders already placed per
 * day from the SAME Shopify weekly-orders feed its green bars use, and runs
 * the maths:
 *   stock         calzone 2-packs in the production fridge now (latest
 *                 stock_entries reading per recipe, as Create Plan reads it)
 *   stillToWrap   today's production not yet in the fridge (loadStillToWrapToday)
 *   stillToDispatchToday  today's orders not yet scanned out (remainingFulfilmentPacks)
 *   days          today → Sunday: despatch day?, 2-packs planned net of 8-pack
 *                 bags, and the further orders normally still to come before
 *                 each despatch's cut-off (forecastLateOrders — the Create
 *                 Plan factory-number forecast, same orders + emails).
 * A finished week: what the fridge actually held at midnight on Sunday,
 * from the fridge change log (each recipe's last resulting count before
 * then), or null before the log began.
 *
 * "Calzone" = recipes on the calzone line (kitchenLine) packed in 2s — the
 * factory number's own unit — so mac cheese, fried chicken and 6-pack
 * desserts stay out, matching the panel's "calzone packs".
 *
 * READ ONLY: database, Shopify order reads, Klaviyo campaign reads.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, recipesTable, stockEntriesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { kitchenLine } from "@workspace/production-schedule";
import {
  addDays, forecastLateOrders, indexOrdersByDate, londonWallTimeMs, orderCutoffMs,
} from "@workspace/stock-prediction";
import { loadEmailWindow, loadForecastOrders } from "../lib/factory-forecast-data";
import { loadPlannedTwoPacksByDate, loadStillToWrapToday } from "../lib/plan-start-stock-inputs";
import { remainingFulfilmentPacks } from "../lib/remaining-fulfilment";
import { londonDateString } from "../lib/london-time";
import { getNonDispatchDates } from "./production-plans";

const router: IRouter = Router();

/** The factory number counts 2-packs (stock_entries pack_size 2). */
const FACTORY_PACK_SIZE = 2;
/** Further ahead than next week the panel has no orders feed to pair with. */
const MAX_DAYS_AHEAD = 14;
/** forecastLateOrders needs this many past same-weekday days to predict. */
const MIN_FORECAST_SAMPLES = 4;

const Query = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(d => new Date(`${d}T12:00:00Z`).getUTCDay() === 1, "weekStart must be a Monday"),
});

async function calzoneRecipeIds(): Promise<number[]> {
  const rows = await db.select({ id: recipesTable.id, category: recipesTable.category, packSize: recipesTable.packSize }).from(recipesTable);
  return rows.filter(r => kitchenLine(r.category) === "calzone" && Number(r.packSize) === FACTORY_PACK_SIZE).map(r => r.id);
}

/** Sum of each recipe's latest 2-pack production-fridge reading; null when
 *  none has ever been counted. */
async function stockNow(ids: number[]): Promise<{ packs: number; countedAt: string | null } | null> {
  if (ids.length === 0) return null;
  const rows = await db
    .select({ recipeId: stockEntriesTable.recipeId, quantity: stockEntriesTable.quantity, checkedAt: stockEntriesTable.checkedAt })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
      eq(stockEntriesTable.packSize, FACTORY_PACK_SIZE),
      inArray(stockEntriesTable.recipeId, ids),
    ));
  if (rows.length === 0) return null;
  const latest = new Map<number, { q: number; at: Date }>();
  for (const r of rows) {
    if (r.recipeId == null) continue;
    const cur = latest.get(r.recipeId);
    if (!cur || r.checkedAt > cur.at) latest.set(r.recipeId, { q: Number(r.quantity) || 0, at: r.checkedAt });
  }
  let packs = 0;
  let newest: Date | null = null;
  for (const v of latest.values()) {
    packs += v.q;
    if (!newest || v.at > newest) newest = v.at;
  }
  return { packs: Math.round(packs), countedAt: newest ? newest.toISOString() : null };
}

/** What the fridge held at instant `at`: each recipe's last logged count
 *  before it (fridge_stock_changes), else its last reading before it. Null
 *  when `at` is before the change log began. Timestamps are stored as UTC
 *  wall-clock, so compare against the UTC wall-clock of `at`. */
async function stockAt(ids: number[], at: Date): Promise<number | null> {
  if (ids.length === 0) return null;
  const utcWall = at.toISOString().replace("Z", "");
  const first = await db.execute<{ first: string | null }>(sql`SELECT min(created_at)::text AS first FROM fridge_stock_changes`);
  const firstLog = first.rows[0]?.first;
  if (!firstLog || firstLog >= utcWall.replace("T", " ")) return null;
  const res = await db.execute<{ packs: string | null }>(sql`
    WITH ids AS (SELECT unnest(${`{${ids.map(Number).join(",")}}`}::int[]) AS recipe_id),
    logged AS (
      SELECT DISTINCT ON (recipe_id) recipe_id, resulting_qty
        FROM fridge_stock_changes
       WHERE pack_size = ${FACTORY_PACK_SIZE} AND created_at < ${utcWall}::timestamp
         AND recipe_id IN (SELECT recipe_id FROM ids)
       ORDER BY recipe_id, created_at DESC, id DESC
    ),
    entered AS (
      SELECT DISTINCT ON (recipe_id) recipe_id, quantity
        FROM stock_entries
       WHERE item_type = 'recipe' AND location = 'production_fridge' AND pack_size = ${FACTORY_PACK_SIZE}
         AND checked_at < ${utcWall}::timestamp AND recipe_id IN (SELECT recipe_id FROM ids)
       ORDER BY recipe_id, checked_at DESC
    )
    SELECT SUM(COALESCE(l.resulting_qty, e.quantity, 0))::text AS packs
      FROM ids LEFT JOIN logged l USING (recipe_id) LEFT JOIN entered e USING (recipe_id)
  `);
  return Math.round(Number(res.rows[0]?.packs ?? 0));
}

router.get("/", async (req, res) => {
  const q = Query.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.issues[0]?.message ?? "weekStart (a Monday, YYYY-MM-DD) required" }); return; }
  const { weekStart } = q.data;
  const weekEnd = addDays(weekStart, 6);
  const now = Date.now();
  const today = londonDateString(new Date(now));
  try {
    const ids = await calzoneRecipeIds();

    if (weekEnd < today) {
      const at = new Date(londonWallTimeMs(addDays(weekEnd, 1), "00:00"));
      const packs = at.getTime() <= now ? await stockAt(ids, at) : null;
      res.json({ phase: "past", weekStart, weekEnd, today, actualEnd: packs == null ? null : { packs, at: at.toISOString() } });
      return;
    }
    if (addDays(today, MAX_DAYS_AHEAD) < weekEnd) {
      res.json({ phase: "too-far", weekStart, weekEnd, today });
      return;
    }

    const dates: string[] = [];
    for (let d = today; d <= weekEnd; d = addDays(d, 1)) dates.push(d);
    const skip = await getNonDispatchDates();
    const isDispatchDay = (d: string) => {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      return wd >= 1 && wd <= 5 && !skip.has(d);
    };
    const dispatchDates = dates.filter(isDispatchDay);
    const lastCutoff = Math.max(now, ...dispatchDates.map(d => orderCutoffMs(addDays(d, 1))));

    const [stock, wrapByRecipe, planned, fulfilment, { orders }, emailWindow] = await Promise.all([
      stockNow(ids),
      loadStillToWrapToday(today, ids),
      loadPlannedTwoPacksByDate(dates.filter(d => d > today), ids),
      isDispatchDay(today) ? remainingFulfilmentPacks(addDays(today, 1), { limitToRecipeIds: ids }) : Promise.resolve(null),
      loadForecastOrders(),
      loadEmailWindow(now, lastCutoff),
    ]);
    const byDate = indexOrdersByDate(orders);
    const sum = (rec: Record<number, number>) => Object.values(rec).reduce((s, n) => s + (Number(n) || 0), 0);

    const days = dates.map(date => {
      const deliveryDate = addDays(date, 1);
      const dispatch = isDispatchDay(date);
      let late: null | { latePacks: number; low: number; high: number; closed: boolean; samples: number; typicalDayPacks: number } = null;
      if (dispatch) {
        const cutoff = orderCutoffMs(deliveryDate);
        const f = forecastLateOrders({
          byDate, deliveryDate, now,
          emailsInWindow: emailWindow.emails.filter(e => e.at <= cutoff).length,
          typicalEmailsPerHour: emailWindow.typicalPerHour,
        });
        if (f.closed || f.samples >= MIN_FORECAST_SAMPLES) {
          late = { latePacks: f.latePacks, low: f.low, high: f.high, closed: f.closed, samples: f.samples, typicalDayPacks: f.typicalDayPacks };
        }
      }
      return {
        date,
        deliveryDate,
        isDispatchDay: dispatch,
        plannedPacks: Math.round(planned[date] ?? 0),
        hasPlan: date in planned,
        late,
      };
    });

    res.json({
      phase: weekStart <= today ? "current" : "future",
      weekStart,
      weekEnd,
      today,
      generatedAt: new Date(now).toISOString(),
      stock,
      stillToWrapToday: Math.round(sum(wrapByRecipe)),
      stillToDispatchToday: fulfilment == null ? 0 : fulfilment.diagnostics.error ? null : Math.round(sum(fulfilment.byRecipe)),
      todayDispatchError: fulfilment?.diagnostics.error ?? null,
      days,
      klaviyoConnected: emailWindow.klaviyoConnected,
    });
  } catch (err) {
    console.error("[week-end-stock]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
