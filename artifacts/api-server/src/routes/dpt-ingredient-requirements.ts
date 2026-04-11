import { Router, type IRouter } from "express";
import { db, dptSettingsTable, dptIngredientRequirementsTable, recipesTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveRecipeIngredients, aggregateIngredients } from "../lib/ingredient-resolver";

const router: IRouter = Router();

export async function recalculateDptRequirements() {
  // Fetch total daily batches from app settings — this is the master number
  // the admin sets on the DPT settings page.
  const [totalBatchesSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "total_daily_batches"));
  const totalDailyBatches = totalBatchesSetting ? Number(totalBatchesSetting.value) : 0;

  const dptRows = await db
    .select({
      recipeId: dptSettingsTable.recipeId,
      defaultBatchesPerDay: dptSettingsTable.defaultBatchesPerDay,
      packsSold: dptSettingsTable.packsSold,
      isActive: dptSettingsTable.isActive,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(dptSettingsTable)
    .leftJoin(recipesTable, eq(dptSettingsTable.recipeId, recipesTable.id));

  const activeRows = dptRows.filter(r => r.isActive);

  // Calculate total packs sold across all active recipes so we can
  // distribute totalDailyBatches proportionally — exactly the same
  // formula the settings page uses on the frontend.
  const totalPacksSold = activeRows.reduce((s, r) => s + (r.packsSold ?? 0), 0);

  const globalAgg = new Map<number, { qty: number; unit: string; cookedQty: number }>();

  for (const row of activeRows) {
    // Compute batches per day from packsSold proportion of totalDailyBatches.
    // Fall back to the stored defaultBatchesPerDay if totalDailyBatches isn't set.
    let batchesPerDay = Number(row.defaultBatchesPerDay) || 0;
    if (totalDailyBatches > 0 && totalPacksSold > 0) {
      const salesPercent = (row.packsSold ?? 0) / totalPacksSold;
      batchesPerDay = salesPercent * totalDailyBatches;
    }
    if (batchesPerDay <= 0) continue;

    const portionsPerBatch = Number(row.portionsPerBatch) || 1;
    const resolved = await resolveRecipeIngredients(row.recipeId, portionsPerBatch);
    const aggregated = aggregateIngredients(resolved);

    for (const [ingredientId, ing] of aggregated) {
      const rawQty = ing.quantityPerBatch * batchesPerDay;
      const processingRatio = ing.processingRatio ?? 1;
      const cookedQty = rawQty * processingRatio;

      const existing = globalAgg.get(ingredientId);
      if (existing) {
        existing.qty += rawQty;
        existing.cookedQty += cookedQty;
      } else {
        globalAgg.set(ingredientId, { qty: rawQty, unit: ing.unit, cookedQty });
      }
    }
  }

  await db.delete(dptIngredientRequirementsTable);

  const inserts = [];
  for (const [ingredientId, data] of globalAgg) {
    inserts.push({
      ingredientId,
      dailyQtyRaw: String(Math.round(data.qty * 10000) / 10000),
      dailyQtyCooked: String(Math.round(data.cookedQty * 10000) / 10000),
      unit: data.unit,
      calculatedAt: new Date(),
    });
  }

  if (inserts.length > 0) {
    await db.insert(dptIngredientRequirementsTable).values(inserts);
  }

  const result = await db.select().from(dptIngredientRequirementsTable);
  return {
    recalculated: true,
    count: result.length,
    requirements: result.map(r => ({
      id: r.id,
      ingredientId: r.ingredientId,
      dailyQtyRaw: Number(r.dailyQtyRaw),
      dailyQtyCooked: Number(r.dailyQtyCooked),
      unit: r.unit,
      calculatedAt: r.calculatedAt.toISOString(),
    })),
  };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(dptIngredientRequirementsTable).orderBy(dptIngredientRequirementsTable.ingredientId);
  res.json(rows.map(r => ({
    id: r.id,
    ingredientId: r.ingredientId,
    dailyQtyRaw: Number(r.dailyQtyRaw),
    dailyQtyCooked: Number(r.dailyQtyCooked),
    unit: r.unit,
    calculatedAt: r.calculatedAt.toISOString(),
  })));
});

router.post("/recalculate", async (_req, res) => {
  try {
    const result = await recalculateDptRequirements();
    res.json(result);
  } catch (err) {
    console.error("DPT recalculation error:", err);
    res.status(500).json({ error: "Failed to recalculate DPT ingredient requirements" });
  }
});

export default router;
