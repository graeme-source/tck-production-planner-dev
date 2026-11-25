/**
 * Today's Factory Number count, and whether the team has signed it off
 * (Graeme, 24 Nov 2026). Shared by the Packing/Wrapping 3pm reminder
 * (GET /api/stock-control/factory-count-today) and the checklist item that
 * shows the count (dynamic type FACTORY_COUNT_CHECKLIST_TYPE), so both read
 * the same figures. Rules: lib/factory-count.ts.
 *
 * Signed off = the checklist item of that type ticked today (not marked
 * "can't do"). The team often update only the products whose number changed
 * and then tick the item — "it's implying that they haven't done it when
 * they have" — so the tick is their approval and the reminder stands down.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { londonDaysWindowUtc } from "../lib/london-time";
import { expectedCountProducts, factoryCountStatus, FACTORY_COUNT_CHECKLIST_TYPE, type CountProduct, type FactoryCountStatus } from "../lib/factory-count";

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

export interface FactoryCountToday extends FactoryCountStatus {
  date: string;
  /** The count checklist item ticked today, or null. */
  signedOff: { at: string; by: string | null } | null;
}

export async function loadFactoryCountToday(date: string): Promise<FactoryCountToday> {
  const { start, end } = londonDaysWindowUtc(date, date);
  const core = rowsOf<{ recipe_id: number; name: string }>(await db.execute(sql`
    SELECT id AS recipe_id, name FROM recipes WHERE is_core_menu = true
  `));
  // Latest 2-pack production-fridge level per recipe — the panel lists a
  // recipe for counting while it holds stock, core menu or not.
  const stocked = rowsOf<{ recipe_id: number; name: string }>(await db.execute(sql`
    SELECT r.id AS recipe_id, r.name
    FROM (
      SELECT DISTINCT ON (recipe_id) recipe_id, quantity
      FROM stock_entries
      WHERE item_type = 'recipe' AND location = 'production_fridge'
        AND recipe_id IS NOT NULL AND COALESCE(pack_size, 2) <> 8
      ORDER BY recipe_id, checked_at DESC
    ) latest
    JOIN recipes r ON r.id = latest.recipe_id
    WHERE latest.quantity::numeric > 0
  `));
  const counted = rowsOf<{ recipe_id: number }>(await db.execute(sql`
    SELECT DISTINCT recipe_id FROM fridge_stock_changes
    WHERE source = 'manual' AND pack_size <> 8
      AND created_at >= ${start} AND created_at < ${end}
  `));
  const [tick] = rowsOf<{ completed_at: string; completed_by_name: string | null }>(await db.execute(sql`
    SELECT c.completed_at, c.completed_by_name
      FROM checklist_completions c
      JOIN checklist_templates t ON t.id = c.template_id
     WHERE t.dynamic_data_type = ${FACTORY_COUNT_CHECKLIST_TYPE}
       AND c.skipped_reason IS NULL
       AND c.completed_at >= ${start} AND c.completed_at < ${end}
     ORDER BY c.completed_at LIMIT 1
  `));
  const toProduct = (r: { recipe_id: number; name: string }): CountProduct => ({ recipeId: Number(r.recipe_id), name: r.name });
  const expected = expectedCountProducts(core.map(toProduct), stocked.map(toProduct));
  return {
    date,
    ...factoryCountStatus(expected, counted.map(r => Number(r.recipe_id))),
    signedOff: tick ? { at: new Date(tick.completed_at).toISOString(), by: tick.completed_by_name } : null,
  };
}
