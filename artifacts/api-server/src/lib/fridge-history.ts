/**
 * What the calzone fridge held in the past, from the production-fridge change
 * log (fridge_stock_changes — every count, wrapping add and despatch, with the
 * resulting level). Objective C. READ ONLY.
 *
 *   calzoneRecipeIds()            recipes on the calzone line packed in 2s —
 *                                 the factory number's own unit
 *   stockAt(ids, at)              the fridge at an instant (each recipe's last
 *                                 logged count before it, else its last
 *                                 reading); null before the log began
 *   recentPlanDayFactoryNumbers() the fridge at the end of each of the last
 *                                 few plan days — the history behind "time to
 *                                 pull back" on Create Plan (Graeme, 16 Oct 2026)
 *
 * Moved out of routes/week-end-stock.ts (its "finished week" figure) so the
 * plan screens read the same history.
 */
import { db, recipesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { kitchenLine } from "@workspace/production-schedule";
import { addDays, londonWallTimeMs, type FactoryHistoryDay } from "@workspace/stock-prediction";

/** The factory number counts 2-packs (stock_entries pack_size 2). */
export const FACTORY_PACK_SIZE = 2;

export async function calzoneRecipeIds(): Promise<number[]> {
  const rows = await db.select({ id: recipesTable.id, category: recipesTable.category, packSize: recipesTable.packSize }).from(recipesTable);
  return rows.filter(r => kitchenLine(r.category) === "calzone" && Number(r.packSize) === FACTORY_PACK_SIZE).map(r => r.id);
}

/** What the fridge held at instant `at`: each recipe's last logged count
 *  before it (fridge_stock_changes), else its last reading before it. Null
 *  when `at` is before the change log began. Timestamps are stored as UTC
 *  wall-clock, so compare against the UTC wall-clock of `at`. */
export async function stockAt(ids: number[], at: Date): Promise<number | null> {
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
         AND location = 'production_fridge'
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

/** How many past plan days the plan screens look back over. */
const HISTORY_PLAN_DAYS = 7;

/**
 * The fridge at midnight after each of the last few saved (non-draft) plan
 * days before both `today` and `planDate` — finished days only. Days before
 * the change log began are left out. Oldest first.
 */
export async function recentPlanDayFactoryNumbers(today: string, planDate: string): Promise<FactoryHistoryDay[]> {
  const before = planDate < today ? planDate : today;
  const plans = await db.execute<{ plan_date: string }>(sql`
    SELECT DISTINCT to_char(plan_date, 'YYYY-MM-DD') AS plan_date
      FROM production_plans
     WHERE status <> 'draft' AND plan_date < ${before}::date
     ORDER BY 1 DESC
     LIMIT ${HISTORY_PLAN_DAYS}
  `);
  const ids = await calzoneRecipeIds();
  const out: FactoryHistoryDay[] = [];
  for (const { plan_date } of plans.rows) {
    const packs = await stockAt(ids, new Date(londonWallTimeMs(addDays(plan_date, 1), "00:00")));
    if (packs != null) out.push({ date: plan_date, packs });
  }
  return out.reverse();
}
