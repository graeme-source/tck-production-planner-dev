/**
 * Queued test production on the Orders page (Graeme, 30 Oct 2026): "send
 * those to the order page (as if a kanban's been pulled for that item with
 * that quantity), not just generate orders into the deliveries". The queue
 * page puts ticked ingredients on today's supplier cards (mark 'queued',
 * with packs and supplier); /orders/calculate adds them to the card like a
 * split from another supplier — a fixed number of packs on top of the
 * normal order — until that supplier's order is placed, which marks them
 * 'ordered'. "Not today" clears the mark, so the item goes back on the test
 * list and comes up again. Objective B.
 */
import { db, queuedIngredientMarksTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
export { packsFor } from "./queued-production-rules";

export interface QueuedOrderItem {
  ingredientId: number;
  supplierId: number;
  packs: number;
  productionDate: string;
}

/** Everything waiting on a supplier card (not yet ordered), any production day. */
export async function loadQueuedOrderItems(): Promise<QueuedOrderItem[]> {
  const rows = await db.select({
    ingredientId: queuedIngredientMarksTable.ingredientId,
    supplierId: queuedIngredientMarksTable.supplierId,
    packs: queuedIngredientMarksTable.packs,
    productionDate: queuedIngredientMarksTable.productionDate,
  }).from(queuedIngredientMarksTable).where(eq(queuedIngredientMarksTable.mark, "queued"));
  return rows
    .filter(r => r.supplierId != null && (r.packs ?? 0) > 0)
    .map(r => ({ ingredientId: r.ingredientId, supplierId: r.supplierId!, packs: r.packs!, productionDate: r.productionDate }));
}

/** A supplier's order was placed: its queued test items are now ordered. */
export async function markQueuedOrdered(poId: number, supplierId: number, ingredientIds: number[]): Promise<void> {
  if (ingredientIds.length === 0) return;
  await db.update(queuedIngredientMarksTable)
    .set({ mark: "ordered", poId })
    .where(and(
      eq(queuedIngredientMarksTable.mark, "queued"),
      eq(queuedIngredientMarksTable.supplierId, supplierId),
      inArray(queuedIngredientMarksTable.ingredientId, ingredientIds),
    ));
}
