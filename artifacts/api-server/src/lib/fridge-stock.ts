/**
 * Single chokepoint for every write that changes how many packs are in
 * the production fridge.
 *
 * Background: production-fridge state lives in TWO tables that have to
 * stay in lockstep —
 *   - stock_entries (location='production_fridge'): the aggregate count
 *     read by the factory-number calc (production-plans.ts /calculate)
 *   - fridge_stock_batches: per-batch rows used for FIFO consumption on
 *     fulfilment, and used to suggest the oldest batch on the packing
 *     opening check.
 *
 * Wrapping and Shopify fulfilment already update both tables together.
 * Manual stock-control adjustments historically updated stock_entries
 * only, which is the main source of drift between the two. This helper
 * exists so every writer goes through one path.
 *
 * Positive delta = packs added to the fridge. Caller MUST supply
 * batchNumber/useByDate when it knows them (e.g. operator typed the
 * number off the pack label). If batchNumber is omitted, we record an
 * "unknown batch" with use-by = today so FIFO consumes it first — the
 * safest default since unknown packs may actually be old stock the
 * operator couldn't read a label off.
 *
 * Negative delta = packs removed from the fridge. We consume
 * fridge_stock_batches FIFO (oldest use-by first), matching the
 * Shopify fulfilment path.
 */
import { sql, and, eq, gt, asc, desc } from "drizzle-orm";
import {
  db,
  stockEntriesTable,
  fridgeStockBatchesTable,
  recipesTable,
} from "@workspace/db";

/** Sentinel batch number used when an operator adds packs to the fridge
 *  but doesn't supply a real batch number. Stored as a real row in
 *  fridge_stock_batches with use-by = today so it's consumed first. */
export const UNKNOWN_BATCH_NUMBER = 0;

export interface AdjustFridgeStockInput {
  recipeId: number;
  /** Positive = add to fridge, negative = remove. Zero is a no-op. */
  delta: number;
  /** Only used when delta > 0. Omit when unknown — we'll record an
   *  "unknown" batch (sentinel 0) with use-by = today. */
  batchNumber?: number | null;
  /** Only used when delta > 0. Required if batchNumber is supplied;
   *  otherwise computed from today + recipe.shelfLifeDays. */
  useByDate?: string | null;
  packSize?: number;
  reason: string;
}

export interface AdjustFridgeStockResult {
  recipeId: number;
  newAggregateQty: number;
  /** When delta > 0: the batch row that was inserted/updated. */
  added?: { batchNumber: number; useByDate: string; quantity: number };
  /** When delta < 0: the batches FIFO-consumed, in order. */
  consumed?: Array<{ batchNumber: number; useByDate: string; quantity: number }>;
  /** When delta < 0 and we ran out of batch rows before satisfying the
   *  removal. stock_entries aggregate still floors at 0; this flags the
   *  shortfall so callers can warn. */
  shortfall?: number;
  /** True when we wrote against the UNKNOWN_BATCH_NUMBER sentinel. */
  unknownBatchUsed?: boolean;
}

/**
 * Apply a delta to a recipe's production-fridge stock, keeping both
 * stock_entries and fridge_stock_batches in sync. Always wrapped in a
 * transaction so a crash mid-write can't leave the two tables drifted.
 */
export async function adjustFridgeStock(
  input: AdjustFridgeStockInput,
): Promise<AdjustFridgeStockResult> {
  const { recipeId, reason } = input;
  const delta = Math.trunc(input.delta);
  const packSize = input.packSize ?? 2;

  if (delta === 0) {
    const currentAgg = await readAggregate(recipeId, packSize);
    return { recipeId, newAggregateQty: currentAgg };
  }

  return await db.transaction(async (tx) => {
    // ── Aggregate stock_entries update (mirrors syncRecipeFridgeStock) ──
    const existing = await tx
      .select({ id: stockEntriesTable.id, quantity: stockEntriesTable.quantity })
      .from(stockEntriesTable)
      .where(and(
        eq(stockEntriesTable.recipeId, recipeId),
        eq(stockEntriesTable.itemType, "recipe"),
        eq(stockEntriesTable.location, "production_fridge"),
        eq(stockEntriesTable.packSize, packSize),
      ))
      .orderBy(desc(stockEntriesTable.checkedAt))
      .limit(1);

    let newAggregateQty: number;
    if (existing.length > 0) {
      newAggregateQty = Math.max(0, Number(existing[0].quantity) + delta);
      await tx.update(stockEntriesTable)
        .set({
          quantity: String(newAggregateQty),
          checkedAt: new Date(),
          notes: reason,
        })
        .where(eq(stockEntriesTable.id, existing[0].id));
    } else {
      newAggregateQty = Math.max(0, delta);
      await tx.insert(stockEntriesTable).values({
        recipeId,
        itemType: "recipe",
        quantity: String(newAggregateQty),
        unit: packSize === 8 ? "8-pack bags" : "packs",
        location: "production_fridge",
        packSize,
        notes: reason,
      });
    }

    // ── Batch-level update ───────────────────────────────────────────
    if (delta > 0) {
      let batchNumber: number;
      let useByDate: string;
      let unknownBatchUsed: boolean;
      if (input.batchNumber != null) {
        batchNumber = input.batchNumber;
        unknownBatchUsed = false;
        if (input.useByDate != null) {
          useByDate = input.useByDate;
        } else {
          const [recipe] = await tx
            .select({ shelfLifeDays: recipesTable.shelfLifeDays })
            .from(recipesTable)
            .where(eq(recipesTable.id, recipeId));
          const shelfDays = recipe?.shelfLifeDays ?? 14;
          const useBy = new Date();
          useBy.setDate(useBy.getDate() + shelfDays);
          useByDate = useBy.toISOString().split("T")[0];
        }
      } else {
        batchNumber = UNKNOWN_BATCH_NUMBER;
        useByDate = input.useByDate ?? new Date().toISOString().split("T")[0];
        unknownBatchUsed = true;
      }

      await tx.execute(sql`
        INSERT INTO fridge_stock_batches (recipe_id, batch_number, pack_size, quantity, use_by_date)
        VALUES (${recipeId}, ${batchNumber}, ${packSize}, ${delta}, ${useByDate})
        ON CONFLICT (recipe_id, batch_number, pack_size)
        DO UPDATE SET quantity = fridge_stock_batches.quantity + ${delta}
      `);

      return {
        recipeId,
        newAggregateQty,
        added: { batchNumber, useByDate, quantity: delta },
        unknownBatchUsed,
      };
    }

    // delta < 0 → FIFO consume from fridge_stock_batches
    let remaining = -delta;
    const consumed: AdjustFridgeStockResult["consumed"] = [];

    const batches = await tx
      .select()
      .from(fridgeStockBatchesTable)
      .where(and(
        eq(fridgeStockBatchesTable.recipeId, recipeId),
        eq(fridgeStockBatchesTable.packSize, packSize),
        gt(fridgeStockBatchesTable.quantity, 0),
      ))
      .orderBy(asc(fridgeStockBatchesTable.useByDate));

    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.quantity);
      if (take >= batch.quantity) {
        await tx.delete(fridgeStockBatchesTable)
          .where(eq(fridgeStockBatchesTable.id, batch.id));
      } else {
        await tx.update(fridgeStockBatchesTable)
          .set({ quantity: batch.quantity - take })
          .where(eq(fridgeStockBatchesTable.id, batch.id));
      }
      consumed.push({
        batchNumber: batch.batchNumber,
        useByDate: batch.useByDate,
        quantity: take,
      });
      remaining -= take;
    }

    return {
      recipeId,
      newAggregateQty,
      consumed,
      shortfall: remaining > 0 ? remaining : undefined,
    };
  });
}

async function readAggregate(recipeId: number, packSize: number): Promise<number> {
  const [row] = await db
    .select({ quantity: stockEntriesTable.quantity })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.recipeId, recipeId),
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
      eq(stockEntriesTable.packSize, packSize),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt))
    .limit(1);
  return row ? Number(row.quantity) : 0;
}
