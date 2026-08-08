/**
 * Append-only audit log for production-fridge stock changes.
 *
 * Every change to a recipe's production-fridge level — manual stock checks /
 * adjustments, wrapping additions, despatch decrements — records one row here
 * with the signed delta, the resulting level, and where it came from. The
 * aggregate `stock_entries` row remains the live factory number; this is the
 * history the Stock Control page shows so the team can see what built the
 * number up day to day.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type FridgeChangeSource = "manual" | "wrapping" | "fulfilment" | "reset" | "freeze";

export interface FridgeStockChange {
  recipeId: number;
  packSize: number;
  delta: number;
  resultingQty: number;
  source: FridgeChangeSource;
  userId?: number | null;
  note?: string | null;
}

/** Insert one change-log row. Accepts a transaction or the base db so it can
 *  run inside the same transaction as the stock_entries write. No-ops on a
 *  zero delta (nothing actually changed). */
export async function logFridgeStockChange(
  tx: Pick<typeof db, "execute">,
  change: FridgeStockChange,
): Promise<void> {
  if (!Math.round(change.delta)) return;
  await tx.execute(sql`
    INSERT INTO fridge_stock_changes (recipe_id, pack_size, delta, resulting_qty, source, user_id, note)
    VALUES (
      ${change.recipeId},
      ${change.packSize},
      ${Math.round(change.delta)},
      ${Math.round(change.resultingQty)},
      ${change.source},
      ${change.userId ?? null},
      ${change.note ?? null}
    )
  `);
}
