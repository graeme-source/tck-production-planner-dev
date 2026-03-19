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
      surplusPercent: dptSettingsTable.surplusPercent,
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

  // Get dispatch orders after planDate, not cancelled, ordered by date
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

  // For each recipe, take the next 3 dispatch entries and sum their quantities
  const demandMap: Record<number, number> = {};
  for (const rId of recipeIds) {
    const rows = futureDispatchRows.filter(r => r.recipeId === rId).slice(0, 3);
    const demand = rows.reduce((sum, r) => sum + Number(r.quantity), 0);
    demandMap[rId] = demand;
  }

  // ─── DPT Capacity-sharing formula ─────────────────────────────────────────
  // 1. Total daily batch capacity = defaultBatchesPerDay (shared across all recipes)
  // 2. Per recipe: must-make = ceil(max(0, demand - stock) / portionsPerBatch)
  // 3. Remaining capacity = totalCapacity - sum(must-make batches)
  // 4. Remaining capacity is split by each recipe's surplusPercent weight
  // 5. suggestedBatches = must-make + floor of that recipe's surplus share
  // ──────────────────────────────────────────────────────────────────────────

  // We treat defaultBatchesPerDay as the TOTAL capacity for the day (shared)
  // All active DPT recipes share the same daily capacity value.
  const totalDailyCapacity = dptSettings.length > 0
    ? Number(dptSettings[0].defaultBatchesPerDay)  // single shared capacity
    : 0;

  // Step 1: compute must-make batches per recipe
  interface RecipeCalc {
    recipeId: number;
    recipeName: string | null;
    portionsPerBatch: number;
    tinSize: string | null;
    maxBatchesPerTin: number | null;
    sopUrl: string | null;
    currentStock: number;
    demand: number;
    defaultBatchesPerDay: number;
    surplusPercent: number;
    batchesForDemand: number;
    isActive: boolean;
  }

  const calcs: RecipeCalc[] = dptSettings.map(d => {
    const currentStock = stockMap[d.recipeId] ?? 0;
    const demand = demandMap[d.recipeId] ?? 0;
    const portionsPerBatch = Number(d.portionsPerBatch) || 10;
    const portionsNeeded = Math.max(0, demand - currentStock);
    const batchesForDemand = portionsNeeded > 0 ? Math.ceil(portionsNeeded / portionsPerBatch) : 0;
    return {
      recipeId: d.recipeId,
      recipeName: d.recipeName,
      portionsPerBatch,
      tinSize: d.tinSize,
      maxBatchesPerTin: d.maxBatchesPerTin,
      sopUrl: d.sopUrl,
      currentStock,
      demand,
      defaultBatchesPerDay: Number(d.defaultBatchesPerDay),
      surplusPercent: Number(d.surplusPercent ?? 20),
      batchesForDemand,
      isActive: d.isActive,
    };
  });

  // Step 2: total must-make batches across all recipes
  const totalMustMake = calcs.reduce((sum, c) => sum + c.batchesForDemand, 0);

  // Step 3: remaining capacity to split as surplus
  const remainingCapacity = Math.max(0, totalDailyCapacity - totalMustMake);

  // Step 4: total surplusPercent weight across all recipes (for proportional split)
  const totalSurplusWeight = calcs.reduce((sum, c) => sum + c.surplusPercent, 0);

  // Step 5: build final suggestions
  const suggestions = calcs.map(c => {
    // Each recipe gets a share of remaining capacity proportional to its surplusPercent
    const surplusShare = totalSurplusWeight > 0
      ? Math.floor(remainingCapacity * (c.surplusPercent / totalSurplusWeight))
      : 0;

    const suggestedBatches = c.batchesForDemand + surplusShare;

    const tinCount = c.maxBatchesPerTin && suggestedBatches > 0
      ? Math.ceil(suggestedBatches / c.maxBatchesPerTin)
      : null;

    return {
      recipeId: c.recipeId,
      recipeName: c.recipeName,
      portionsPerBatch: c.portionsPerBatch,
      tinSize: c.tinSize,
      maxBatchesPerTin: c.maxBatchesPerTin,
      sopUrl: c.sopUrl,
      currentStock: c.currentStock,
      demand: c.demand,
      batchesForDemand: c.batchesForDemand,
      surplusPercent: c.surplusPercent,
      defaultBatchesPerDay: c.defaultBatchesPerDay,
      totalDailyCapacity,
      remainingCapacity,
      surplusShare,
      suggestedBatches,
      tinCount,
      isActive: c.isActive,
    };
  });

  res.json(suggestions);
});

export default router;
