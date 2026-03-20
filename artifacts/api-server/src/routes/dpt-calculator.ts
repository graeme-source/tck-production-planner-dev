import { Router, type IRouter } from "express";
import { db, dptSettingsTable, recipesTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const [totalBatchesSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "total_daily_batches"));
  const totalDailyBatches = totalBatchesSetting ? Number(totalBatchesSetting.value) : 0;

  const rows = await db
    .select({
      id: dptSettingsTable.id,
      recipeId: dptSettingsTable.recipeId,
      recipeName: recipesTable.name,
      packsSold: dptSettingsTable.packsSold,
      isActive: dptSettingsTable.isActive,
      portionsPerBatch: recipesTable.portionsPerBatch,
      tinSize: recipesTable.tinSize,
      maxBatchesPerTin: recipesTable.maxBatchesPerTin,
      sopUrl: recipesTable.sopUrl,
    })
    .from(dptSettingsTable)
    .leftJoin(recipesTable, eq(dptSettingsTable.recipeId, recipesTable.id))
    .where(eq(dptSettingsTable.isActive, true));

  const totalPacksSold = rows.reduce((sum, r) => sum + (r.packsSold ?? 0), 0);

  const rawItems = rows.map(r => {
    const packsSold = r.packsSold ?? 0;
    const salesPercent = totalPacksSold > 0 ? (packsSold / totalPacksSold) * 100 : 0;
    const exact = totalDailyBatches > 0 && totalPacksSold > 0
      ? (salesPercent / 100) * totalDailyBatches
      : 0;
    return { row: r, packsSold, salesPercent, exact, floor: Math.floor(exact) };
  });

  let remaining = totalDailyBatches - rawItems.reduce((s, i) => s + i.floor, 0);
  const sorted = rawItems
    .map((item, idx) => ({ idx, remainder: item.exact - item.floor }))
    .sort((a, b) => b.remainder - a.remainder);
  const bonus = new Set<number>();
  for (const { idx } of sorted) {
    if (remaining <= 0) break;
    bonus.add(idx);
    remaining--;
  }

  const suggestions = rawItems.map((item, idx) => {
    const suggestedBatches = item.floor + (bonus.has(idx) ? 1 : 0);
    const maxBatchesPerTin = item.row.maxBatchesPerTin ? Number(item.row.maxBatchesPerTin) : null;
    const tinCount = maxBatchesPerTin && suggestedBatches > 0
      ? Math.ceil(suggestedBatches / maxBatchesPerTin)
      : null;

    return {
      recipeId: item.row.recipeId,
      recipeName: item.row.recipeName,
      portionsPerBatch: Number(item.row.portionsPerBatch) || 10,
      tinSize: item.row.tinSize,
      maxBatchesPerTin,
      sopUrl: item.row.sopUrl,
      packsSold: item.packsSold,
      salesPercent: Math.round(item.salesPercent * 10) / 10,
      suggestedBatches,
      tinCount,
      totalDailyBatches,
      totalPacksSold,
      isActive: item.row.isActive,
    };
  });

  res.json(suggestions);
});

export default router;
