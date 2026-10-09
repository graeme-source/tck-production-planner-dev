/**
 * Per-builder building progress lives in building_station_progress (each
 * builder's own loose extra packs). The item-level extra_packs_built cache is
 * DERIVED as the SUM across both builders, so the whole downstream pipeline
 * (ovens, wrapping, dispatch) keeps reading production_plan_items unchanged and
 * sees the combined total. Nothing here touches builder_marked_complete_at —
 * "moving on" is pure navigation and no recipe is ever auto-marked complete.
 *
 * Moved out of routes/production-plans.ts (2026-10-09) so the building
 * station's Edit (routes/building-edit.ts) recomputes the cache the same way,
 * inside its own transaction.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recomputeItemFromProgress(planItemId: number, executor: typeof db | Tx = db): Promise<void> {
  await executor.execute(sql`
    UPDATE production_plan_items SET
      extra_packs_built = COALESCE((
        SELECT SUM(extra_packs)::int FROM building_station_progress
        WHERE plan_item_id = ${planItemId}
      ), 0)
    WHERE id = ${planItemId}
  `);
}
