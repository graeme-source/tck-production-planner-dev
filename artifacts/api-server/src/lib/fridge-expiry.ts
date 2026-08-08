/**
 * Which production-fridge packs are running out of sellable life?
 *
 * Shares the shelf-life rules with the Create Plan calculation
 * (production-plans.ts /calculate): a pack must reach the customer with a
 * minimum shelf life left — calzones 3 days, mac cheese 2 — and delivery is
 * dispatch + 1 calendar day (APC overnight), so the last dispatch that can
 * sell a batch is use-by − minDays − 1.
 *
 * Use-by is computed from the julian batch number (YYDDD = production date)
 * + the recipe's CURRENT shelf_life_days, never the stored use_by column, so
 * shelf-life edits correct stock already in the fridge. Unknown-batch
 * sentinel rows (batch 0 — manual count corrections) and recipes without a
 * positive shelf life are skipped. The aggregate count is attributed to the
 * NEWEST batch rows first — real dispatch is FIFO and the batch table is
 * known to drift, so ghost old rows must not cry wolf (see the same logic
 * inline in /calculate).
 */
import { sql, and, eq, gt } from "drizzle-orm";
import { db, recipesTable, stockEntriesTable, fridgeStockBatchesTable } from "@workspace/db";
import { productionDateFromJulianBatch } from "./julian-batch";

export interface ClosingFridgeBatch {
  batchNumber: number;
  packs: number;
  useByDate: string;
  lastDispatchDate: string;
  lastDeliveryDate: string;
}

export interface ClosingFridgeAction {
  recipeId: number;
  recipeName: string;
  recipeColor: string | null;
  recipeCategory: string | null;
  fridgeQty: number;
  /** Packs whose last valid dispatch is on or before `asOfDispatchDate` —
   *  if they're still in the fridge at close, they must be frozen. */
  actionPacks: number;
  batches: ClosingFridgeBatch[];
}

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function minShelfDaysAtCustomer(category: string | null): number {
  return (category ?? "").toLowerCase() === "macaroni cheese" ? 2 : 3;
}

/**
 * List, per recipe, the fridge packs whose LAST valid dispatch date is on or
 * before `asOfDispatchDate` (normally today): after that day's dispatches
 * have gone out, any of these packs still in the fridge can never be sold
 * chilled and need freezing / moving to Wonky stock.
 */
export async function computeClosingFridgeActions(asOfDispatchDate: string): Promise<ClosingFridgeAction[]> {
  const recipeRows = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      color: recipesTable.color,
      category: recipesTable.category,
      shelfLifeDays: recipesTable.shelfLifeDays,
    })
    .from(recipesTable);
  const recipeById = new Map(recipeRows.map(r => [r.id, r]));

  // Latest aggregate production_fridge reading per recipe (2-packs).
  const aggRows = await db.execute<{ recipe_id: number; quantity: string }>(sql`
    SELECT DISTINCT ON (recipe_id) recipe_id, quantity
    FROM stock_entries
    WHERE item_type = 'recipe' AND location = 'production_fridge' AND pack_size = 2
    ORDER BY recipe_id, checked_at DESC
  `);
  const aggregateByRecipe = new Map<number, number>();
  for (const r of (aggRows.rows ?? aggRows)) {
    aggregateByRecipe.set(r.recipe_id, Math.max(0, Math.round(Number(r.quantity))));
  }

  const batchRows = await db
    .select({
      recipeId: fridgeStockBatchesTable.recipeId,
      batchNumber: fridgeStockBatchesTable.batchNumber,
      quantity: fridgeStockBatchesTable.quantity,
    })
    .from(fridgeStockBatchesTable)
    .where(and(eq(fridgeStockBatchesTable.packSize, 2), gt(fridgeStockBatchesTable.quantity, 0)));

  const batchesByRecipe = new Map<number, Array<{ packs: number; useBy: string; batchNumber: number }>>();
  for (const b of batchRows) {
    if (b.batchNumber === 0) continue; // unknown-age sentinel
    const info = recipeById.get(b.recipeId);
    if (!info || info.shelfLifeDays == null || Number(info.shelfLifeDays) <= 0) continue;
    const prodDate = productionDateFromJulianBatch(b.batchNumber);
    if (!prodDate) continue;
    const useBy = addCalendarDays(prodDate, Number(info.shelfLifeDays));
    const list = batchesByRecipe.get(b.recipeId) ?? [];
    list.push({ packs: b.quantity, useBy, batchNumber: b.batchNumber });
    batchesByRecipe.set(b.recipeId, list);
  }

  const actions: ClosingFridgeAction[] = [];
  for (const [recipeId, rows] of batchesByRecipe) {
    const info = recipeById.get(recipeId);
    if (!info) continue;
    const aggregate = aggregateByRecipe.get(recipeId) ?? 0;
    if (aggregate <= 0) continue;
    rows.sort((a, b) => a.useBy.localeCompare(b.useBy));
    // Newest-first attribution of the physical count.
    let remaining = aggregate;
    const layers: Array<{ packs: number; useBy: string; batchNumber: number }> = [];
    for (let i = rows.length - 1; i >= 0 && remaining > 0; i--) {
      const take = Math.min(rows[i].packs, remaining);
      layers.push({ packs: take, useBy: rows[i].useBy, batchNumber: rows[i].batchNumber });
      remaining -= take;
    }
    layers.reverse();
    const minDays = minShelfDaysAtCustomer(info.category ?? null);
    let actionPacks = 0;
    const batches: ClosingFridgeBatch[] = [];
    for (const layer of layers) {
      const lastDeliveryDate = addCalendarDays(layer.useBy, -minDays);
      const lastDispatchDate = addCalendarDays(lastDeliveryDate, -1);
      if (lastDispatchDate <= asOfDispatchDate) {
        actionPacks += layer.packs;
        batches.push({
          batchNumber: layer.batchNumber,
          packs: layer.packs,
          useByDate: layer.useBy,
          lastDispatchDate,
          lastDeliveryDate,
        });
      }
    }
    if (actionPacks > 0) {
      actions.push({
        recipeId,
        recipeName: info.name,
        recipeColor: info.color ?? null,
        recipeCategory: info.category ?? null,
        fridgeQty: aggregate,
        actionPacks,
        batches,
      });
    }
  }
  actions.sort((a, b) =>
    (a.batches[0]?.lastDispatchDate ?? "").localeCompare(b.batches[0]?.lastDispatchDate ?? "")
    || a.recipeName.localeCompare(b.recipeName));
  return actions;
}
