import { Router, type IRouter } from "express";
import { db, dptSettingsTable, recipesTable, stockEntriesTable, dispatchOrdersTable } from "@workspace/db";
import { eq, gt, and, sql, ne, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  const { date } = req.query;
  const planDate = date ? String(date) : new Date().toISOString().split("T")[0];

  const dptSettings = await db
    .select({
      id: dptSettingsTable.id,
      recipeId: dptSettingsTable.recipeId,
      recipeName: recipesTable.name,
      defaultBatchesPerDay: dptSettingsTable.defaultBatchesPerDay,
      isActive: dptSettingsTable.isActive,
      portionsPerBatch: recipesTable.portionsPerBatch,
      tinSize: recipesTable.tinSize,
      maxBatchesPerTin: recipesTable.maxBatchesPerTin,
      sopUrl: recipesTable.sopUrl,
    })
    .from(dptSettingsTable)
    .leftJoin(recipesTable, eq(dptSettingsTable.recipeId, recipesTable.id))
    .where(eq(dptSettingsTable.isActive, true));

  if (dptSettings.length === 0) {
    res.json([]);
    return;
  }

  const recipeIds = dptSettings.map(d => d.recipeId);

  // Get all stock entries for these recipes, most recent first
  const stockRows = await db
    .select({
      recipeId: stockEntriesTable.recipeId,
      quantity: stockEntriesTable.quantity,
      checkedAt: stockEntriesTable.checkedAt,
    })
    .from(stockEntriesTable)
    .where(
      and(
        sql`${stockEntriesTable.recipeId} = ANY(${recipeIds})`,
        eq(stockEntriesTable.itemType, "recipe")
      )
    )
    .orderBy(desc(stockEntriesTable.checkedAt));

  // Build map: latest stock per recipe
  const stockMap: Record<number, number> = {};
  for (const s of stockRows) {
    if (s.recipeId && !(s.recipeId in stockMap)) {
      stockMap[s.recipeId] = Number(s.quantity);
    }
  }

  // Get dispatch orders after planDate, not cancelled
  const futureDispatchRows = await db
    .select({
      recipeId: dispatchOrdersTable.recipeId,
      quantity: dispatchOrdersTable.quantity,
      dispatchDate: dispatchOrdersTable.dispatchDate,
    })
    .from(dispatchOrdersTable)
    .where(
      and(
        sql`${dispatchOrdersTable.recipeId} = ANY(${recipeIds})`,
        gt(dispatchOrdersTable.dispatchDate, planDate),
        ne(dispatchOrdersTable.status, "cancelled")
      )
    )
    .orderBy(dispatchOrdersTable.dispatchDate);

  // Establish a global demand horizon: next 3 unique dispatch dates across all recipes
  const allFutureDates = [...new Set(futureDispatchRows.map(r => r.dispatchDate))].sort();
  const horizonDates = new Set(allFutureDates.slice(0, 3));

  // For each recipe, sum dispatch quantities that fall within the 3-date global horizon
  const demandMap: Record<number, number> = {};
  for (const rId of recipeIds) {
    const rows = futureDispatchRows.filter(r => r.recipeId === rId && horizonDates.has(r.dispatchDate));
    const demand = rows.reduce((sum, r) => sum + Number(r.quantity), 0);
    demandMap[rId] = demand;
  }

  const suggestions = dptSettings.map(d => {
    const currentStock = stockMap[d.recipeId] ?? 0;
    const demand = demandMap[d.recipeId] ?? 0;
    const defaultBatchesPerDay = Number(d.defaultBatchesPerDay);
    const portionsPerBatch = Number(d.portionsPerBatch) || 10;
    const maxBatchesPerTin = d.maxBatchesPerTin;

    // Portions needed beyond current stock
    const portionsNeeded = Math.max(0, demand - currentStock);
    // Convert to batches (always round up)
    const batchesForDemand = portionsNeeded > 0 ? Math.ceil(portionsNeeded / portionsPerBatch) : 0;
    // Add daily surplus target
    const suggestedBatches = batchesForDemand + defaultBatchesPerDay;
    // Tin count
    const tinCount = maxBatchesPerTin && suggestedBatches > 0
      ? Math.ceil(suggestedBatches / maxBatchesPerTin)
      : null;

    return {
      recipeId: d.recipeId,
      recipeName: d.recipeName,
      portionsPerBatch,
      tinSize: d.tinSize,
      maxBatchesPerTin: d.maxBatchesPerTin,
      sopUrl: d.sopUrl,
      currentStock,
      demand,
      batchesForDemand,
      defaultBatchesPerDay,
      suggestedBatches,
      tinCount,
      isActive: d.isActive,
    };
  });

  res.json(suggestions);
});

export default router;
