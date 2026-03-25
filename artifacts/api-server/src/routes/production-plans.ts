import { Router, type IRouter } from "express";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, batchCompletionsTable, stationBreaksTable, recipeIngredientsTable, ingredientsTable, recipeSubRecipesTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, dispatchOrdersTable, appSettingsTable, prepCompletionsTable, dailyStockChecksTable, usersTable, recipeMeatMarinadesTable, stockEntriesTable, dptSettingsTable } from "@workspace/db";
import { eq, and, desc, sql, gt, gte, lte, asc, inArray, notInArray, sum as drizzleSum, ne, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { validate } from "../middleware/validate";
import * as z from "zod";
import { resolveRecipeIngredients, aggregateIngredients, roundByUnit, type ResolvedIngredient } from "../lib/ingredient-resolver";
import { countProductsByTag } from "../services/shopify";

const router: IRouter = Router();

async function syncRecipeFridgeStock(recipeId: number, deltaQty: number) {
  const existing = await db
    .select({ id: stockEntriesTable.id, quantity: stockEntriesTable.quantity })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.recipeId, recipeId),
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt))
    .limit(1);

  if (existing.length > 0) {
    const newQty = Math.max(0, Number(existing[0].quantity) + deltaQty);
    await db.update(stockEntriesTable)
      .set({ quantity: String(newQty), checkedAt: new Date() })
      .where(eq(stockEntriesTable.id, existing[0].id));
  } else {
    await db.insert(stockEntriesTable).values({
      recipeId,
      itemType: "recipe",
      quantity: String(Math.max(0, deltaQty)),
      unit: "packs",
      location: "production_fridge",
      notes: "Auto-created from wrapping station",
    });
  }
}

function julianBatchNumber(date: Date): number {
  const year = date.getFullYear() % 100;
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  return year * 1000 + dayOfYear;
}

/** Returns true if `planDateStr` is at least 2 working days from today (UTC). */
function isAtLeast2WorkingDaysAhead(planDateStr: string): boolean {
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const planUTC = new Date(`${planDateStr}T00:00:00Z`);
  let workingDays = 0;
  const cursor = new Date(todayUTC);
  cursor.setUTCDate(cursor.getUTCDate() + 1); // start from tomorrow
  while (cursor <= planUTC) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) workingDays++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return workingDays >= 2;
}

function mapPlan(p: typeof productionPlansTable.$inferSelect) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
  };
}

function mapItem(i: typeof productionPlanItemsTable.$inferSelect & { recipeName?: string | null; portionsPerBatch?: number | null; fillWeightGrams?: string | null; baseType?: string | null; baseWeightGrams?: string | null; wrappingComplete?: boolean | null; recipeColor?: string | null }, stationCompletions?: Record<string, number>) {
  return {
    ...i,
    recipeName: i.recipeName ?? "",
    portionsPerBatch: i.portionsPerBatch ?? 10,
    fillWeightGrams: i.fillWeightGrams ? Number(i.fillWeightGrams) : null,
    baseType: i.baseType ?? null,
    baseWeightGrams: i.baseWeightGrams ? Number(i.baseWeightGrams) : null,
    wrappingComplete: i.wrappingComplete ?? false,
    stationCompletions: stationCompletions ?? {},
  };
}

const STATION_DEPENDENCIES: Record<string, string[]> = {
  building_1: ["mixing"],
  building_2: ["mixing"],
  ovens: ["building_1", "building_2"],
  wrapping: ["ovens"],
};

function getPreviousStations(stationType: string): string[] {
  return STATION_DEPENDENCIES[stationType] ?? [];
}

const CreatePlanBody = z.object({
  planDate: z.string(),
  name: z.string(),
  notes: z.string().nullish(),
  status: z.enum(["draft", "active", "prep", "building", "complete"]).optional(),
  batchNumber: z.number().int().optional(),
  items: z.array(z.object({
    recipeId: z.number(),
    batchesTarget: z.number().int().default(0),
    orderPosition: z.number().int().default(0),
    tinSize: z.string().nullish(),
    maxBatchesPerTin: z.number().int().nullish(),
    sopUrl: z.string().nullish(),
    notes: z.string().nullish(),
  })).optional(),
});

const PLAN_STATUSES = ["draft", "active", "prep", "building", "complete"] as const;
type PlanStatus = typeof PLAN_STATUSES[number];

const UpdatePlanBody = z.object({
  planDate: z.string().optional(),
  name: z.string().optional(),
  notes: z.string().nullish(),
  status: z.enum(PLAN_STATUSES).optional(),
  batchNumber: z.number().int().nullish(),
  items: z.array(z.object({
    recipeId: z.number(),
    batchesTarget: z.number().int().default(0),
    batchesComplete: z.number().int().optional(),
    orderPosition: z.number().int().default(0),
    tinSize: z.string().nullish(),
    maxBatchesPerTin: z.number().int().nullish(),
    sopUrl: z.string().nullish(),
    notes: z.string().nullish(),
    status: z.enum(["pending", "in-progress", "complete"]).optional(),
  })).optional(),
});

router.get("/", async (req, res) => {
  const { date } = req.query;
  let plansQuery = db.select().from(productionPlansTable).$dynamic();
  if (date) {
    plansQuery = plansQuery.where(eq(productionPlansTable.planDate, String(date)));
  }
  const plans = await plansQuery.orderBy(productionPlansTable.planDate);

  if (plans.length === 0) {
    res.json([]);
    return;
  }

  const planIds = plans.map(p => p.id);
  const totals = await db
    .select({
      planId: productionPlanItemsTable.planId,
      totalBatchesTarget: sql<number>`SUM(${productionPlanItemsTable.batchesTarget})`.as("total_batches_target"),
      itemCount: sql<number>`COUNT(*)`.as("item_count"),
    })
    .from(productionPlanItemsTable)
    .where(inArray(productionPlanItemsTable.planId, planIds))
    .groupBy(productionPlanItemsTable.planId);

  const totalsMap = new Map(totals.map(t => [t.planId, { totalBatchesTarget: Number(t.totalBatchesTarget) || 0, itemCount: Number(t.itemCount) || 0 }]));

  res.json(plans.map(p => ({
    ...mapPlan(p),
    totalBatchesTarget: totalsMap.get(p.id)?.totalBatchesTarget ?? 0,
    itemCount: totalsMap.get(p.id)?.itemCount ?? 0,
  })));
});

router.post("/", validate(CreatePlanBody), async (req, res) => {
  const { planDate, name, notes, status, items } = req.body;
  // Enforce Mon–Fri only — parse at noon UTC to avoid timezone edge cases
  const dateObj = new Date(`${planDate}T12:00:00Z`);
  const dayOfWeek = dateObj.getUTCDay(); // 0=Sun, 6=Sat
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    res.status(400).json({ error: "Production plans can only be scheduled on weekdays (Monday–Friday)." });
    return;
  }
  // Enforce 2 working-day minimum lead time
  if (!isAtLeast2WorkingDaysAhead(planDate)) {
    res.status(400).json({ error: "Production plans must be scheduled at least 2 working days in advance." });
    return;
  }
  const batchNumber = julianBatchNumber(dateObj);

  const [plan] = await db.insert(productionPlansTable).values({
    planDate,
    name,
    notes: notes ?? null,
    status: status ?? "draft",
    batchNumber,
  }).returning();

  if (items?.length) {
    const recipeIds = items.map((i: { recipeId: number }) => i.recipeId);
    const recipes = await db.select({ id: recipesTable.id, maxBatchesPerTin: recipesTable.maxBatchesPerTin, tinSize: recipesTable.tinSize }).from(recipesTable).where(inArray(recipesTable.id, recipeIds));
    const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r]));

    await db.insert(productionPlanItemsTable).values(
      items.map((i: { recipeId: number; batchesTarget?: number; orderPosition?: number; tinSize?: string | null; maxBatchesPerTin?: number | null; sopUrl?: string | null; notes?: string | null }) => ({
        planId: plan.id,
        recipeId: i.recipeId,
        batchesTarget: i.batchesTarget ?? 0,
        orderPosition: i.orderPosition ?? 0,
        tinSize: i.tinSize ?? recipeMap[i.recipeId]?.tinSize ?? null,
        maxBatchesPerTin: i.maxBatchesPerTin ?? recipeMap[i.recipeId]?.maxBatchesPerTin ?? null,
        sopUrl: i.sopUrl ?? null,
        notes: i.notes ?? null,
        status: "pending",
      }))
    );
  }
  res.status(201).json(mapPlan(plan));
});

// GET /production-plans/calculate?planDate=YYYY-MM-DD
// Returns per-recipe calculation data for creating a smart production plan.
router.get("/calculate", async (req, res) => {
  const planDate = String(req.query.planDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    res.status(400).json({ error: "planDate query param required (YYYY-MM-DD)" });
    return;
  }

  function getPreviousWorkingDay(fromDate: string): string {
    const d = new Date(`${fromDate}T12:00:00Z`);
    do {
      d.setUTCDate(d.getUTCDate() - 1);
    } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  }

  function getNextWorkingDay(fromDate: string): string {
    const d = new Date(`${fromDate}T12:00:00Z`);
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  }

  const deliveryDates = [
    getPreviousWorkingDay(planDate),
    planDate,
    getNextWorkingDay(planDate),
  ];

  const prevProductionDate = getPreviousWorkingDay(planDate);
  const prevPlanItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      eq(productionPlansTable.planDate, prevProductionDate),
      inArray(productionPlansTable.status, ["draft", "active", "prep", "building", "complete"]),
    ));

  const prevProductionPacks: Record<number, number> = {};
  for (const row of prevPlanItems) {
    if (row.recipeId != null) {
      const portionsPerBatch = Number(row.portionsPerBatch) || 10;
      const packSize = Number(row.packSize) || 1;
      const packsPerBatch = portionsPerBatch / packSize;
      const packs = (row.batchesTarget ?? 0) * packsPerBatch;
      prevProductionPacks[row.recipeId] = (prevProductionPacks[row.recipeId] ?? 0) + packs;
    }
  }

  const fridgeRows = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      totalFridge: drizzleSum(productionPlanItemsTable.fridgeQty),
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .where(inArray(productionPlansTable.status, ["active", "prep", "building"]))
    .groupBy(productionPlanItemsTable.recipeId);

  const fridgeStockFromPlans: Record<number, number> = {};
  for (const row of fridgeRows) {
    if (row.recipeId != null) {
      fridgeStockFromPlans[row.recipeId] = Number(row.totalFridge ?? 0);
    }
  }

  const stockRows = await db
    .select({
      recipeId: stockEntriesTable.recipeId,
      quantity: stockEntriesTable.quantity,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.itemType, "recipe"),
      notInArray(stockEntriesTable.location, ["production_freezer", "raw_freezer"]),
    ))
    .orderBy(asc(stockEntriesTable.checkedAt));

  const latestStock: Record<number, number> = {};
  for (const row of stockRows) {
    if (row.recipeId != null) {
      latestStock[row.recipeId] = Number(row.quantity);
    }
  }

  const shopifySalesPerDate: Record<string, Record<string, number>> = {};
  const shopifySalesCombined: Record<string, number> = {};
  const shopifyDatesLoaded = new Set<string>();
  let shopifyError: string | null = null;

  try {
    const results = await Promise.allSettled(
      deliveryDates.map(date => countProductsByTag(date).then(products => ({ date, products })))
    );
    const failedDates: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        failedDates.push(deliveryDates[i]);
        console.warn(`[calculate] Shopify fetch for ${deliveryDates[i]} failed:`, result.reason?.message ?? result.reason);
        continue;
      }
      const { date, products } = result.value;
      shopifySalesPerDate[date] = {};
      shopifyDatesLoaded.add(date);
      for (const p of products) {
        const twoPackVariant = p.variants.find(v => {
          const t = v.title.toLowerCase();
          return t.includes("2 pack") || t.includes("2-pack") || t === "2pack";
        });
        if (twoPackVariant) {
          const key = p.productTitle.toLowerCase().trim();
          shopifySalesPerDate[date][key] = (shopifySalesPerDate[date][key] ?? 0) + twoPackVariant.quantity;
          shopifySalesCombined[key] = (shopifySalesCombined[key] ?? 0) + twoPackVariant.quantity;
        }
      }
    }
    if (failedDates.length > 0) {
      shopifyError = `Failed to fetch Shopify data for: ${failedDates.join(", ")}. Using DPT estimates for those dates.`;
    }
  } catch (err: any) {
    shopifyError = err.message ?? "Unknown error";
    console.warn("[calculate] Shopify sales fetch failed:", shopifyError);
  }

  const hasShopifyData = shopifyDatesLoaded.size > 0;

  const CALZONE_CLUB_SPECIAL_KEY = "calzone club special";

  const specialRecipeRows = await db
    .select({ id: recipesTable.id, name: recipesTable.name })
    .from(recipesTable)
    .where(eq(recipesTable.isCurrentSpecial, true))
    .limit(1);
  const specialRecipe = specialRecipeRows[0] ?? null;

  const specialCountPerDate: Record<string, number> = {};

  if (specialRecipe && hasShopifyData) {
    const specialQtyCombined = shopifySalesCombined[CALZONE_CLUB_SPECIAL_KEY] ?? 0;
    if (specialQtyCombined > 0) {
      const specialNorm = normalizeForMatch(specialRecipe.name);
      shopifySalesCombined[specialNorm] = (shopifySalesCombined[specialNorm] ?? 0) + specialQtyCombined;
    }

    for (const date of deliveryDates) {
      const salesForDate = shopifySalesPerDate[date];
      if (!salesForDate) continue;
      const specialQty = salesForDate[CALZONE_CLUB_SPECIAL_KEY] ?? 0;
      if (specialQty > 0) {
        const specialNorm = normalizeForMatch(specialRecipe.name);
        salesForDate[specialNorm] = (salesForDate[specialNorm] ?? 0) + specialQty;
        specialCountPerDate[date] = specialQty;
      }
    }
  }

  const dptRows = await db
    .select({
      recipeId: dptSettingsTable.recipeId,
      recipeName: recipesTable.name,
      packsSold: dptSettingsTable.packsSold,
      isActive: dptSettingsTable.isActive,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
      tinSize: recipesTable.tinSize,
      maxBatchesPerTin: recipesTable.maxBatchesPerTin,
      sopUrl: recipesTable.sopUrl,
      color: recipesTable.color,
      isCoreMenu: recipesTable.isCoreMenu,
    })
    .from(dptSettingsTable)
    .innerJoin(recipesTable, eq(dptSettingsTable.recipeId, recipesTable.id))
    .where(eq(dptSettingsTable.isActive, true));

  const dptRecipeIds = new Set(dptRows.map(r => r.recipeId));
  const coreMenuRows = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
      tinSize: recipesTable.tinSize,
      maxBatchesPerTin: recipesTable.maxBatchesPerTin,
      sopUrl: recipesTable.sopUrl,
      color: recipesTable.color,
      isCoreMenu: recipesTable.isCoreMenu,
    })
    .from(recipesTable)
    .where(eq(recipesTable.isCoreMenu, true));

  for (const cm of coreMenuRows) {
    if (!dptRecipeIds.has(cm.id)) {
      dptRows.push({
        recipeId: cm.id,
        recipeName: cm.name,
        packsSold: 0,
        isActive: true,
        portionsPerBatch: cm.portionsPerBatch,
        packSize: cm.packSize,
        tinSize: cm.tinSize,
        maxBatchesPerTin: cm.maxBatchesPerTin,
        sopUrl: cm.sopUrl,
        color: cm.color,
        isCoreMenu: cm.isCoreMenu,
      });
    }
  }

  const [totalBatchesSetting] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, "total_daily_batches"));
  const totalDailyBatches = totalBatchesSetting ? Number(totalBatchesSetting.value) : 0;

  function normalizeForMatch(s: string): string {
    return s.toLowerCase().trim().replace(/[''`]/g, "'").replace(/&/g, "and").replace(/\s+/g, " ");
  }

  function matchShopifySalesForDate(recipeName: string, date: string): number {
    const recipeNorm = normalizeForMatch(recipeName);
    const salesForDate = shopifySalesPerDate[date] ?? {};
    let total = 0;
    for (const [productTitle, qty] of Object.entries(salesForDate)) {
      const productNorm = normalizeForMatch(productTitle);
      if (productNorm.includes(recipeNorm) || recipeNorm.includes(productNorm)) {
        total += qty;
      }
    }
    return total;
  }

  function matchShopifySalesCombined(recipeName: string): { qty: number; matchedProduct: string | null } {
    const recipeNorm = normalizeForMatch(recipeName);
    let total = 0;
    let firstMatch: string | null = null;
    for (const [productTitle, qty] of Object.entries(shopifySalesCombined)) {
      const productNorm = normalizeForMatch(productTitle);
      if (productNorm.includes(recipeNorm) || recipeNorm.includes(productNorm)) {
        total += qty;
        if (!firstMatch) firstMatch = productTitle;
      }
    }
    return { qty: total, matchedProduct: firstMatch };
  }

  const totalDptPacksSold = dptRows.reduce((s, x) => s + (x.packsSold ?? 0), 0);

  const recipesWithData = dptRows.map(r => {
    const recipeName = r.recipeName ?? `Recipe #${r.recipeId}`;
    const recipeId = r.recipeId;
    const portionsPerBatch = Number(r.portionsPerBatch) || 10;
    const packSize = Number(r.packSize) || 1;
    const packsPerBatch = portionsPerBatch / packSize;

    const fridgeStock = latestStock[recipeId] ?? fridgeStockFromPlans[recipeId] ?? 0;

    const recipeDptPercent = totalDptPacksSold > 0 ? ((r.packsSold ?? 0) / totalDptPacksSold) * 100 : 0;
    const dptDailyPacks = Math.round((recipeDptPercent / 100) * totalDailyBatches * packsPerBatch);

    const shopifyMatch = matchShopifySalesCombined(recipeName);
    const hasRecipeMatch = shopifyMatch.matchedProduct !== null;

    function resolveDispatchQty(date: string): number {
      if (!shopifyDatesLoaded.has(date)) return dptDailyPacks;
      if (!hasRecipeMatch) return dptDailyPacks;
      return matchShopifySalesForDate(recipeName, date);
    }

    const dispatch1Qty = resolveDispatchQty(deliveryDates[0]);
    const dispatch2Qty = resolveDispatchQty(deliveryDates[1]);
    const dispatch3Qty = resolveDispatchQty(deliveryDates[2]);
    const totalDispatchQty = dispatch1Qty + dispatch2Qty + dispatch3Qty;

    const prevProduction = Math.round(prevProductionPacks[recipeId] ?? 0);
    const estimatedFactoryNumber = fridgeStock - dispatch1Qty + prevProduction;

    const recipeSource: "shopify" | "dpt" = (hasRecipeMatch && shopifyDatesLoaded.size > 0) ? "shopify" : "dpt";
    const effectivePacksSold = totalDispatchQty;

    const remainingDispatches = dispatch2Qty + dispatch3Qty;
    const deficit = Math.max(0, remainingDispatches - estimatedFactoryNumber);
    const deficitBatches = packsPerBatch > 0 ? Math.ceil(deficit / packsPerBatch) : 0;

    const stockAfterDispatches = estimatedFactoryNumber - remainingDispatches;
    let stockWarning: "ok" | "low" | "short" = "ok";
    if (stockAfterDispatches < 0) stockWarning = "short";
    else if (stockAfterDispatches <= 10) stockWarning = "low";

    const isThisRecipeSpecial = specialRecipe !== null && specialRecipe.id === recipeId;
    const special1Count = isThisRecipeSpecial ? (specialCountPerDate[deliveryDates[0]] ?? 0) : 0;
    const special2Count = isThisRecipeSpecial ? (specialCountPerDate[deliveryDates[1]] ?? 0) : 0;
    const special3Count = isThisRecipeSpecial ? (specialCountPerDate[deliveryDates[2]] ?? 0) : 0;
    const totalSpecialCount = special1Count + special2Count + special3Count;

    return {
      recipeId,
      recipeName,
      portionsPerBatch,
      packSize,
      packsPerBatch,
      tinSize: r.tinSize ?? null,
      maxBatchesPerTin: r.maxBatchesPerTin ? Number(r.maxBatchesPerTin) : null,
      sopUrl: r.sopUrl ?? null,
      color: r.color ?? null,
      isCoreMenu: r.isCoreMenu ?? false,
      fridgeStock: Math.round(fridgeStock),
      prevProduction,
      estimatedFactoryNumber: Math.round(estimatedFactoryNumber),
      dispatch1Qty,
      dispatch2Qty,
      dispatch3Qty,
      totalDispatchQty,
      deficit,
      deficitBatches,
      salesPercent: 0,
      packsSold: effectivePacksSold,
      stockWarning,
      salesSource: recipeSource,
      matchedProduct: shopifyMatch.matchedProduct,
      special1Count,
      special2Count,
      special3Count,
      totalSpecialCount,
    };
  });

  const totalPacksSold = recipesWithData.reduce((sum, r) => sum + r.packsSold, 0);
  for (const r of recipesWithData) {
    r.salesPercent = totalPacksSold > 0 ? Math.round(((r.packsSold / totalPacksSold) * 100) * 10) / 10 : 0;
  }

  const totalDeficitBatches = recipesWithData.reduce((s, r) => s + r.deficitBatches, 0);
  const remainingCapacity = Math.max(0, totalDailyBatches - totalDeficitBatches);

  const rawSurplus = recipesWithData.map(r => {
    const exact = totalPacksSold > 0 ? (r.salesPercent / 100) * remainingCapacity : 0;
    return { exact, floor: Math.floor(exact) };
  });

  let leftover = remainingCapacity - rawSurplus.reduce((s, r) => s + r.floor, 0);
  const surplusSorted = rawSurplus
    .map((r, idx) => ({ idx, remainder: r.exact - r.floor }))
    .sort((a, b) => b.remainder - a.remainder);
  const bonusSet = new Set<number>();
  for (const { idx } of surplusSorted) {
    if (leftover <= 0) break;
    bonusSet.add(idx);
    leftover--;
  }

  const result = recipesWithData.map((r, idx) => {
    const surplusBatches = rawSurplus[idx].floor + (bonusSet.has(idx) ? 1 : 0);
    const suggestedBatches = r.deficitBatches + surplusBatches;
    const maxBatchesPerTin = r.maxBatchesPerTin;
    const tinCount = maxBatchesPerTin && suggestedBatches > 0
      ? Math.ceil(suggestedBatches / maxBatchesPerTin) : null;

    const nextFactoryNumber = r.estimatedFactoryNumber + (suggestedBatches * r.packsPerBatch) - (r.dispatch2Qty + r.dispatch3Qty);

    return {
      ...r,
      surplusBatches,
      suggestedBatches,
      tinCount,
      nextFactoryNumber: Math.round(nextFactoryNumber),
      totalDailyBatches,
      totalPacksSold,
    };
  });

  const unmatchedRecipeNames = hasShopifyData
    ? result.filter(r => r.matchedProduct === null).map(r => r.recipeName)
    : [];

  const clubSpecialSales = shopifySalesCombined[CALZONE_CLUB_SPECIAL_KEY] ?? 0;
  const clubSpecialUnmatched = !specialRecipe && hasShopifyData && clubSpecialSales > 0;
  const unmatchedRecipes = clubSpecialUnmatched
    ? [...unmatchedRecipeNames, `Calzone Club Special (${clubSpecialSales} units — no special recipe is configured)`]
    : unmatchedRecipeNames;

  res.json({
    planDate,
    prevProductionDate,
    deliveryDates,
    totalDailyBatches,
    totalDeficitBatches,
    remainingCapacity,
    salesSource: hasShopifyData ? "shopify" : "dpt",
    shopifyError,
    unmatchedRecipes,
    recipes: result,
  });
});

// GET /production-plans/next-active?afterDate=YYYY-MM-DD
// Returns the next active production plan after a given date.
// If afterDate is provided, searches for the first active plan with plan_date > afterDate.
// If omitted, defaults to searching from tomorrow onwards (legacy behaviour).
router.get("/next-active", async (req, res) => {
  let afterDateStr: string;
  if (req.query.afterDate && typeof req.query.afterDate === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.afterDate)) {
      res.status(400).json({ error: "afterDate must be YYYY-MM-DD" });
      return;
    }
    afterDateStr = req.query.afterDate;
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    afterDateStr = today.toISOString().slice(0, 10);
  }

  const plans = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, name: productionPlansTable.name, status: productionPlansTable.status })
    .from(productionPlansTable)
    .where(and(
      gt(productionPlansTable.planDate, afterDateStr),
      eq(productionPlansTable.status, "active")
    ))
    .orderBy(asc(productionPlansTable.planDate))
    .limit(1);

  if (plans.length === 0) {
    res.json({ planId: null, planDate: null, planName: null });
    return;
  }

  res.json({ planId: plans[0].id, planDate: plans[0].planDate, planName: plans[0].name, status: plans[0].status });
});

// ──────────────────────────────────────────────────────────────────────────────
// Daily Stock Checks (before /:id to avoid route shadowing)
// ──────────────────────────────────────────────────────────────────────────────
router.get("/stock-checks", async (req, res) => {
  const checkDate = String(req.query.date ?? new Date().toISOString().slice(0, 10));

  const checks = await db
    .select({
      id: dailyStockChecksTable.id,
      ingredientId: dailyStockChecksTable.ingredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      quantity: dailyStockChecksTable.quantity,
      checkedAt: dailyStockChecksTable.checkedAt,
      userId: dailyStockChecksTable.userId,
    })
    .from(dailyStockChecksTable)
    .leftJoin(ingredientsTable, eq(dailyStockChecksTable.ingredientId, ingredientsTable.id))
    .where(eq(dailyStockChecksTable.checkDate, checkDate));

  const stockIngredients = await db
    .select({ id: ingredientsTable.id, name: ingredientsTable.name, unit: ingredientsTable.unit })
    .from(ingredientsTable)
    .where(eq(ingredientsTable.stockCheckEnabled, true))
    .orderBy(ingredientsTable.name);

  res.json({ date: checkDate, checks, stockIngredients });
});

router.post("/stock-checks", async (req, res) => {
  const { ingredientId, checkDate, quantity } = req.body;
  const userId = (req.session as any)?.userId ?? null;

  try {
    const [row] = await db
      .insert(dailyStockChecksTable)
      .values({ ingredientId, checkDate, quantity: String(quantity), userId })
      .onConflictDoUpdate({
        target: [dailyStockChecksTable.ingredientId, dailyStockChecksTable.checkDate],
        set: { quantity: String(quantity), userId, checkedAt: sql`now()` },
      })
      .returning();

    res.json(row);
  } catch (err: any) {
    console.error("Stock check save error:", err.message);
    res.status(500).json({ error: "Failed to save stock check" });
  }
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, id));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id: productionPlanItemsTable.id,
      planId: productionPlanItemsTable.planId,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      notes: productionPlanItemsTable.notes,
      status: productionPlanItemsTable.status,
      orderPosition: productionPlanItemsTable.orderPosition,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      batchesComplete: productionPlanItemsTable.batchesComplete,
      wonlyCount: productionPlanItemsTable.wonlyCount,
      wrappingComplete: productionPlanItemsTable.wrappingComplete,
      fridgeQty: productionPlanItemsTable.fridgeQty,
      freezerQty: productionPlanItemsTable.freezerQty,
      prepFridgeQty: productionPlanItemsTable.prepFridgeQty,
      tinSize: productionPlanItemsTable.tinSize,
      maxBatchesPerTin: productionPlanItemsTable.maxBatchesPerTin,
      sopUrl: productionPlanItemsTable.sopUrl,
      extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt,
      fillWeightGrams: recipesTable.fillWeightGrams,
      baseType: recipesTable.baseType,
      baseWeightGrams: recipesTable.baseWeightGrams,
      recipeColor: recipesTable.color,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, id))
    .orderBy(productionPlanItemsTable.orderPosition);

  const itemIds = items.map(it => it.id);
  let completionsByItem: Record<number, Record<string, number>> = {};
  if (itemIds.length > 0) {
    const completionRows = await db.execute(sql`
      SELECT plan_item_id, station_type, COUNT(*)::int as cnt
      FROM batch_completions
      WHERE plan_item_id IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})
      GROUP BY plan_item_id, station_type
    `);
    for (const row of completionRows.rows as Array<{ plan_item_id: number; station_type: string; cnt: number }>) {
      if (!completionsByItem[row.plan_item_id]) completionsByItem[row.plan_item_id] = {};
      completionsByItem[row.plan_item_id][row.station_type] = row.cnt;
    }
  }

  res.json({ ...mapPlan(plan), items: items.map(it => mapItem(it, completionsByItem[it.id] ?? {})) });
});

// Statuses that lock structural plan edits (date, name, items)
const LOCKED_STATUSES: PlanStatus[] = ["active", "prep", "building", "complete"];

router.put("/:id", validate(UpdatePlanBody), async (req, res) => {
  const id = Number(req.params.id);
  const { planDate, name, notes, status, items } = req.body;

  const [existing] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const isLocked = LOCKED_STATUSES.includes(existing.status as PlanStatus);
  if (isLocked && (planDate !== undefined || name !== undefined || items !== undefined)) {
    res.status(409).json({
      error: `Plan is locked (status: '${existing.status}'). Only status transitions are permitted once a plan is activated.`,
    });
    return;
  }

  // Validate weekday constraint and 2-day lead time only when planDate is actually changing
  const dateIsChanging = planDate !== undefined && planDate !== existing.planDate;
  if (dateIsChanging) {
    const updDateObj = new Date(`${planDate}T12:00:00Z`);
    const updDow = updDateObj.getUTCDay();
    if (updDow === 0 || updDow === 6) {
      res.status(400).json({ error: "Production plans can only be scheduled on weekdays (Monday–Friday)." });
      return;
    }
    if (!isAtLeast2WorkingDaysAhead(planDate)) {
      res.status(400).json({ error: "Production plans must be scheduled at least 2 working days in advance." });
      return;
    }
  }

  const setPlan: Partial<typeof productionPlansTable.$inferInsert> = {};
  if (planDate !== undefined) setPlan.planDate = planDate;
  if (name !== undefined) setPlan.name = name;
  if (notes !== undefined) setPlan.notes = notes ?? null;
  if (status !== undefined) setPlan.status = status;
  // Recompute Julian batch number if planDate is changing
  if (dateIsChanging) {
    const newDateObj = new Date(`${planDate}T12:00:00Z`);
    setPlan.batchNumber = julianBatchNumber(newDateObj);
  }

  const [updated] = await db.update(productionPlansTable)
    .set(setPlan)
    .where(eq(productionPlansTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  if (items !== undefined) {
    await db.delete(productionPlanItemsTable).where(eq(productionPlanItemsTable.planId, id));
    if (items.length) {
      const recipeIds = items.map((i: { recipeId: number }) => i.recipeId);
      const recipes = await db.select({ id: recipesTable.id, maxBatchesPerTin: recipesTable.maxBatchesPerTin, tinSize: recipesTable.tinSize }).from(recipesTable).where(inArray(recipesTable.id, recipeIds));
      const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r]));

      await db.insert(productionPlanItemsTable).values(
        items.map((i: {
          recipeId: number;
          batchesTarget?: number;
          batchesComplete?: number;
          orderPosition?: number;
          tinSize?: string | null;
          maxBatchesPerTin?: number | null;
          sopUrl?: string | null;
          notes?: string | null;
          status?: string;
        }) => ({
          planId: id,
          recipeId: i.recipeId,
          batchesTarget: i.batchesTarget ?? 0,
          batchesComplete: i.batchesComplete ?? 0,
          orderPosition: i.orderPosition ?? 0,
          tinSize: i.tinSize ?? recipeMap[i.recipeId]?.tinSize ?? null,
          maxBatchesPerTin: i.maxBatchesPerTin ?? recipeMap[i.recipeId]?.maxBatchesPerTin ?? null,
          sopUrl: i.sopUrl ?? null,
          notes: i.notes ?? null,
          status: i.status ?? "pending",
        }))
      );
    }
  }
  res.json(mapPlan(updated));
});

// PATCH order for a specific plan — updates orderPosition of all items atomically in a transaction
router.patch("/:id/order", async (req, res) => {
  const id = Number(req.params.id);
  const { order } = req.body as { order: { itemId: number; orderPosition: number }[] };
  const sessionUserRole = (req.session as { userRole?: string }).userRole ?? "viewer";
  if (!Array.isArray(order)) { res.status(400).json({ error: "order must be an array" }); return; }

  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, id));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }

  // Lock enforcement: fetch current items and verify no started item changes position (unless admin)
  if (sessionUserRole !== "admin") {
    const existingItems = await db.select({ id: productionPlanItemsTable.id, orderPosition: productionPlanItemsTable.orderPosition, status: productionPlanItemsTable.status })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, id));

    const currentPositionMap = new Map(existingItems.map(it => [it.id, it.orderPosition]));
    for (const { itemId, orderPosition } of order) {
      const existing = existingItems.find(it => it.id === itemId);
      if (existing && existing.status !== "pending" && existing.orderPosition !== orderPosition) {
        res.status(409).json({ error: `Item ${itemId} has started and cannot be moved` });
        return;
      }
      // Also check if a locked item is being displaced (its current position given to a different item)
      for (const locked of existingItems.filter(it => it.status !== "pending")) {
        const newPos = order.find(o => o.itemId === locked.id)?.orderPosition;
        if (newPos !== undefined && newPos !== locked.orderPosition) {
          res.status(409).json({ error: `Started recipe "${locked.id}" cannot be repositioned` });
          return;
        }
      }
    }
    void currentPositionMap;
  }

  await db.transaction(async (tx) => {
    for (const { itemId, orderPosition } of order) {
      await tx.update(productionPlanItemsTable)
        .set({ orderPosition })
        .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, id)));
    }
  });

  res.json({ ok: true });
});

const ITEM_STATUSES = ["pending", "in-progress", "complete"] as const;
const PatchItemBody = z.object({
  batchesComplete: z.number().int().min(0).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  wonlyCount: z.number().int().min(0).optional(),
});

// PATCH a single plan item's batchesComplete
router.patch("/:id/items/:itemId", validate(PatchItemBody), async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { batchesComplete, status, wonlyCount } = req.body;

  const setItem: Partial<typeof productionPlanItemsTable.$inferInsert> = {};
  if (batchesComplete !== undefined) setItem.batchesComplete = batchesComplete;
  if (status !== undefined) setItem.status = status;
  if (wonlyCount !== undefined) setItem.wonlyCount = wonlyCount;

  const [updated] = await db.update(productionPlanItemsTable)
    .set(setItem)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(mapItem(updated));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(productionPlansTable).where(eq(productionPlansTable.id, id));
  res.status(204).send();
});

// Batch completions sub-routes
router.post("/:id/batch-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { planItemId, stationType, startedAt, completedAt } = req.body;
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  // Verify that the planItemId belongs to this plan (prevent cross-plan contamination)
  const [planItem] = await db.select({
    id: productionPlanItemsTable.id,
    batchesComplete: productionPlanItemsTable.batchesComplete,
    batchesTarget: productionPlanItemsTable.batchesTarget,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  const target = planItem.batchesTarget ?? 0;

  // Per-station cap check: count THIS station's completions (not the shared batches_complete)
  if (stationType && target > 0) {
    const stationCountResult = await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM batch_completions
      WHERE plan_item_id = ${Number(planItemId)} AND station_type = ${stationType}
    `);
    const stationCount = (stationCountResult.rows[0] as { cnt: number })?.cnt ?? 0;
    if (stationCount >= target) {
      res.status(409).json({ error: "Batch target already met for this station" });
      return;
    }

    // Cascade check: previous station(s) must have enough completions
    const prevStations = getPreviousStations(stationType);
    if (prevStations.length > 0) {
      const prevCountResult = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM batch_completions
        WHERE plan_item_id = ${Number(planItemId)}
          AND station_type IN (${sql.join(prevStations.map(s => sql`${s}`), sql`, `)})
      `);
      const prevCount = (prevCountResult.rows[0] as { cnt: number })?.cnt ?? 0;
      if (prevCount <= stationCount) {
        const prevLabel = prevStations.length === 1 ? prevStations[0] : prevStations.join("/");
        res.status(409).json({ error: `Previous station (${prevLabel}) must complete more batches first` });
        return;
      }
    }
  }

  // Atomic: insert completion and update item status
  // Only increment batches_complete when wrapping station completes (final production step)
  const completedAtDate = completedAt ? new Date(completedAt) : new Date();
  const startedAtDate = startedAt ? new Date(startedAt) : null;
  const isWrapping = stationType === "wrapping";

  const result = await db.execute(sql`
    WITH station_check AS (
      SELECT COUNT(*)::int as cnt FROM batch_completions
      WHERE plan_item_id = ${Number(planItemId)}
        AND station_type = ${stationType ?? ''}
    ),
    incremented AS (
      UPDATE production_plan_items
      SET
        batches_complete = CASE WHEN ${isWrapping}::boolean THEN batches_complete + 1 ELSE batches_complete END,
        status = 'in-progress'
      WHERE id = ${Number(planItemId)}
        AND (${target} = 0 OR (SELECT cnt FROM station_check) < ${target})
      RETURNING id
    )
    INSERT INTO batch_completions (plan_item_id, station_type, user_id, started_at, completed_at)
    SELECT
      ${Number(planItemId)},
      ${stationType ?? null},
      ${sessionUserId},
      ${startedAtDate}::timestamptz,
      ${completedAtDate}::timestamptz
    FROM incremented
    RETURNING *
  `);

  const rows = result.rows as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    // Increment was blocked — target already met by concurrent request
    res.status(409).json({ error: "Batch target already met" });
    return;
  }

  const row = rows[0];
  res.status(201).json({
    ...row,
    completedAt: row.completed_at instanceof Date ? (row.completed_at as Date).toISOString() : row.completed_at,
    startedAt: row.started_at instanceof Date ? (row.started_at as Date).toISOString() : (row.started_at ?? null),
    planItemId: row.plan_item_id,
    stationType: row.station_type,
    userId: row.user_id,
  });
});

// POST /:id/batch-completions/bulk — create N batch_completion rows in one request (for tin completion)
router.post("/:id/batch-completions/bulk", async (req, res) => {
  const planId = Number(req.params.id);
  const { planItemId, stationType, count } = req.body;
  const n = Number(count);
  if (!n || n < 1 || n > 50) {
    res.status(400).json({ error: "count must be between 1 and 50" });
    return;
  }
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  const [planItem] = await db.select({
    id: productionPlanItemsTable.id,
    batchesTarget: productionPlanItemsTable.batchesTarget,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  const target = planItem.batchesTarget ?? 0;

  if (stationType && target > 0) {
    const stationCountResult = await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM batch_completions
      WHERE plan_item_id = ${Number(planItemId)} AND station_type = ${stationType}
    `);
    const stationCount = (stationCountResult.rows[0] as { cnt: number })?.cnt ?? 0;
    if (stationCount + n > target) {
      res.status(409).json({ error: `Adding ${n} would exceed target (${stationCount}/${target})` });
      return;
    }

    const prevStations = getPreviousStations(stationType);
    if (prevStations.length > 0) {
      const prevCountResult = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM batch_completions
        WHERE plan_item_id = ${Number(planItemId)}
          AND station_type IN (${sql.join(prevStations.map(s => sql`${s}`), sql`, `)})
      `);
      const prevCount = (prevCountResult.rows[0] as { cnt: number })?.cnt ?? 0;
      if (prevCount < stationCount + n) {
        res.status(409).json({ error: `Previous station must complete more batches first` });
        return;
      }
    }
  }

  const now = new Date();
  const values = Array.from({ length: n }, () =>
    sql`(${Number(planItemId)}, ${stationType ?? null}, ${sessionUserId}, ${now}::timestamptz)`
  );
  const isBulkWrapping = stationType === "wrapping";

  const result = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO batch_completions (plan_item_id, station_type, user_id, completed_at)
      VALUES ${sql.join(values, sql`, `)}
      RETURNING id
    )
    UPDATE production_plan_items
    SET
      batches_complete = CASE WHEN ${isBulkWrapping}::boolean THEN batches_complete + (SELECT COUNT(*) FROM inserted)::int ELSE batches_complete END,
      status = 'in-progress'
    WHERE id = ${Number(planItemId)}
    RETURNING id
  `);

  if ((result as { rows: unknown[] }).rows.length === 0) {
    res.status(409).json({ error: "Could not record completions" });
    return;
  }

  res.status(201).json({ created: n });
});

// DELETE /:id/batch-completions/bulk — remove N most recent batch_completion rows (for tin undo)
router.delete("/:id/batch-completions/bulk", async (req, res) => {
  const planId = Number(req.params.id);
  const { planItemId, stationType, count } = req.body;
  const n = Number(count);
  if (!n || n < 1 || n > 50) {
    res.status(400).json({ error: "count must be between 1 and 50" });
    return;
  }
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;
  const sessionUserRole = (req.session as { userRole?: string }).userRole ?? null;
  const isAdmin = sessionUserRole === "admin";

  const [planItem] = await db.select({ id: productionPlanItemsTable.id, batchesComplete: productionPlanItemsTable.batchesComplete })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  const bulkUndoConditions = [eq(batchCompletionsTable.planItemId, Number(planItemId))];
  if (stationType) bulkUndoConditions.push(eq(batchCompletionsTable.stationType, stationType));
  if (!isAdmin && sessionUserId) bulkUndoConditions.push(eq(batchCompletionsTable.userId, sessionUserId));

  const isBulkUndoWrapping = stationType === "wrapping";

  const result = await db.execute(sql`
    WITH targets AS (
      SELECT id FROM batch_completions
      WHERE ${and(...bulkUndoConditions)}
      ORDER BY completed_at DESC
      LIMIT ${n}
    ),
    deleted AS (
      DELETE FROM batch_completions
      WHERE id IN (SELECT id FROM targets)
      RETURNING id
    )
    UPDATE production_plan_items
    SET
      batches_complete = CASE WHEN ${isBulkUndoWrapping}::boolean THEN GREATEST(batches_complete - (SELECT COUNT(*) FROM deleted)::int, 0) ELSE batches_complete END,
      status = CASE
        WHEN ${isBulkUndoWrapping}::boolean AND GREATEST(batches_complete - (SELECT COUNT(*) FROM deleted)::int, 0) = 0 THEN 'pending'
        WHEN status = 'complete' THEN 'in-progress'
        ELSE status
      END
    WHERE id = ${Number(planItemId)}
      AND EXISTS (SELECT 1 FROM deleted)
    RETURNING id
  `);

  if ((result as { rows: unknown[] }).rows.length === 0) {
    res.status(404).json({ error: "No matching completions found to undo" });
    return;
  }

  res.status(204).send();
});

// GET /:id/batch-completions/pace — avg mins/batch per plan item for a given station
router.get("/:id/batch-completions/pace", async (req, res) => {
  const planId = Number(req.params.id);
  const stationType = String(req.query.stationType ?? "");
  if (!stationType) { res.status(400).json({ error: "stationType required" }); return; }

  const rows = await db.execute(sql`
    SELECT
      bc.plan_item_id,
      COUNT(*)::int AS cnt,
      MIN(bc.completed_at) AS first_at,
      MAX(bc.completed_at) AS last_at,
      EXTRACT(EPOCH FROM MAX(bc.completed_at) - MIN(bc.completed_at))::float AS span_secs
    FROM batch_completions bc
    JOIN production_plan_items ppi ON ppi.id = bc.plan_item_id AND ppi.plan_id = ${planId}
    WHERE bc.station_type = ${stationType}
    GROUP BY bc.plan_item_id
    HAVING COUNT(*) >= 2
  `);

  const pace: Record<number, number> = {};
  for (const row of rows.rows as Array<{ plan_item_id: number; cnt: number; span_secs: number }>) {
    const intervals = row.cnt - 1;
    if (intervals > 0 && row.span_secs > 0) {
      pace[row.plan_item_id] = Math.round((row.span_secs / intervals / 60) * 10) / 10;
    }
  }
  res.json({ pace });
});

// DELETE last batch completion — removes the most recent completion row for this item/user
// and decrements batches_complete atomically, keeping KPI metrics consistent.
router.delete("/:id/batch-completions/last", async (req, res) => {
  const planId = Number(req.params.id);
  const { planItemId, stationType } = req.body;
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;
  const sessionUserRole = (req.session as { userRole?: string }).userRole ?? null;
  const isAdmin = sessionUserRole === "admin";

  // Verify planItemId belongs to this plan
  const [planItem] = await db.select({ id: productionPlanItemsTable.id, batchesComplete: productionPlanItemsTable.batchesComplete })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }
  // Build ownership filter: non-admins can only undo their own completions
  const conditions = [eq(batchCompletionsTable.planItemId, Number(planItemId))];
  if (stationType) conditions.push(eq(batchCompletionsTable.stationType, stationType));
  if (!isAdmin && sessionUserId) conditions.push(eq(batchCompletionsTable.userId, sessionUserId));

  // Only decrement batches_complete when undoing a wrapping completion
  const isUndoWrapping = stationType === "wrapping";

  // Atomic CTE: find the most recent matching completion, delete it, and ONLY THEN
  // decrement the counter (only for wrapping station — other stations don't affect the overall count).
  const result = await db.execute(sql`
    WITH target AS (
      SELECT id FROM batch_completions
      WHERE ${and(...conditions)}
      ORDER BY completed_at DESC
      LIMIT 1
    ),
    deleted AS (
      DELETE FROM batch_completions
      WHERE id IN (SELECT id FROM target)
      RETURNING id
    )
    UPDATE production_plan_items
    SET
      batches_complete = CASE WHEN ${isUndoWrapping}::boolean THEN GREATEST(batches_complete - 1, 0) ELSE batches_complete END,
      status = CASE
        WHEN ${isUndoWrapping}::boolean AND GREATEST(batches_complete - 1, 0) = 0 THEN 'pending'
        WHEN status = 'complete' THEN 'in-progress'
        ELSE status
      END
    WHERE id = ${Number(planItemId)}
      AND EXISTS (SELECT 1 FROM deleted)
    RETURNING id
  `);

  // If the UPDATE returned no rows, no completion was found to delete (ownership mismatch or none exists)
  if ((result as { rows: unknown[] }).rows.length === 0) {
    res.status(404).json({ error: "No matching completion found to undo" });
    return;
  }

  res.status(204).send();
});

router.get("/:id/batch-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { stationType } = req.query;

  const items = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));

  const itemIds = items.map(i => i.id);
  if (itemIds.length === 0) { res.json([]); return; }

  let completions = await db.select().from(batchCompletionsTable)
    .where(inArray(batchCompletionsTable.planItemId, itemIds))
    .orderBy(desc(batchCompletionsTable.completedAt));

  if (stationType) {
    completions = completions.filter(c => c.stationType === stationType);
  }

  res.json(completions.map(c => ({ ...c, completedAt: c.completedAt.toISOString(), startedAt: c.startedAt ? c.startedAt.toISOString() : null })));
});

// GET /:id/batch-completions/summary — aggregated batchesComplete per planItemId for polling
// Returns { planItemId: number, batchesComplete: number }[] (filtered by stationType if provided)
router.get("/:id/batch-completions/summary", async (req, res) => {
  const planId = Number(req.params.id);
  const { stationType } = req.query;

  const items = await db.select({ id: productionPlanItemsTable.id, batchesComplete: productionPlanItemsTable.batchesComplete })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));

  if (items.length === 0) { res.json([]); return; }

  if (!stationType) {
    // Return overall batchesComplete per plan item from the plan items table (authoritative)
    res.json(items.map(i => ({ planItemId: i.id, batchesComplete: i.batchesComplete })));
    return;
  }

  // When filtering by stationType, count completions from batch_completions table
  const itemIds = items.map(i => i.id);
  const completions = await db.select({
    planItemId: batchCompletionsTable.planItemId,
  }).from(batchCompletionsTable)
    .where(and(
      inArray(batchCompletionsTable.planItemId, itemIds),
      eq(batchCompletionsTable.stationType, String(stationType))
    ));

  const countByItem: Record<number, number> = {};
  for (const c of completions) {
    countByItem[c.planItemId] = (countByItem[c.planItemId] ?? 0) + 1;
  }

  res.json(items.map(i => ({ planItemId: i.id, batchesComplete: countByItem[i.id] ?? 0 })));
});

// Station breaks sub-routes

// GET active (open) break for current user — applies to all stations (sync'd globally)
router.get("/:id/station-breaks/active", async (req, res) => {
  const planId = Number(req.params.id);
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  const conditions = [eq(stationBreaksTable.planId, planId), sql`ended_at IS NULL`];
  if (sessionUserId) conditions.push(eq(stationBreaksTable.userId, sessionUserId));

  const [row] = await db.select().from(stationBreaksTable)
    .where(and(...conditions))
    .orderBy(desc(stationBreaksTable.startedAt))
    .limit(1);

  if (!row) { res.json(null); return; }
  res.json({ ...row, startedAt: row.startedAt.toISOString(), endedAt: null });
});

// All station types — breaks are synced globally across all stations
const ALL_STATION_TYPES = ["mixing", "building_1", "building_2", "ovens", "wrapping", "prep_veg", "prep_bases", "prep_meat"];

router.post("/:id/station-breaks", async (req, res) => {
  const planId = Number(req.params.id);
  const { stationType, breakType, startedAt } = req.body;
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  // Idempotency: if any open break exists for this user+plan, return it
  const existConditions = [eq(stationBreaksTable.planId, planId), sql`ended_at IS NULL`];
  if (sessionUserId) existConditions.push(eq(stationBreaksTable.userId, sessionUserId));
  const [existing] = await db.select().from(stationBreaksTable)
    .where(and(...existConditions))
    .orderBy(desc(stationBreaksTable.startedAt))
    .limit(1);

  if (existing) {
    res.status(200).json({ ...existing, startedAt: existing.startedAt.toISOString(), endedAt: null });
    return;
  }

  // Create one break record per station type so KPI calculations remain accurate per station
  const ts = startedAt ? new Date(startedAt) : new Date();
  const rows = await db.insert(stationBreaksTable).values(
    ALL_STATION_TYPES.map(st => ({
      planId,
      stationType: st,
      userId: sessionUserId,
      breakType: breakType ?? "morning",
      startedAt: ts,
    }))
  ).returning();

  // Return the row for the calling station (or first row)
  const primary = rows.find(r => r.stationType === stationType) ?? rows[0];
  res.status(201).json({ ...primary, startedAt: primary.startedAt.toISOString(), endedAt: null });
});

router.patch("/:id/station-breaks/:breakId", async (req, res) => {
  const planId = Number(req.params.id);
  const breakId = Number(req.params.breakId);
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;
  const sessionUserRole = (req.session as { userRole?: string }).userRole ?? null;
  const { endedAt } = req.body;

  // Verify ownership: only the break owner or an admin can end a break
  const [existingBreak] = await db.select({ id: stationBreaksTable.id, userId: stationBreaksTable.userId })
    .from(stationBreaksTable)
    .where(and(eq(stationBreaksTable.id, breakId), eq(stationBreaksTable.planId, planId)));

  if (!existingBreak) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Allow if: admin, or the break belongs to the current user, or break has no owner (legacy)
  const isOwner = existingBreak.userId == null || existingBreak.userId === sessionUserId;
  if (!isOwner && sessionUserRole !== "admin") {
    res.status(403).json({ error: "You can only end your own break" });
    return;
  }

  const endTs = endedAt ? new Date(endedAt) : new Date();

  // End ALL open breaks for this user/plan (syncs across all station types)
  const endAllConditions = [
    eq(stationBreaksTable.planId, planId),
    sql`ended_at IS NULL`,
    ...(sessionUserId != null ? [eq(stationBreaksTable.userId, sessionUserId)] : []),
  ];
  await db.update(stationBreaksTable)
    .set({ endedAt: endTs })
    .where(and(...endAllConditions));

  // Return the originally-requested break row
  const [updated] = await db.select().from(stationBreaksTable).where(eq(stationBreaksTable.id, breakId));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, startedAt: updated.startedAt.toISOString(), endedAt: updated.endedAt ? updated.endedAt.toISOString() : null });
});

router.get("/:id/station-breaks", async (req, res) => {
  const planId = Number(req.params.id);
  const rows = await db.select().from(stationBreaksTable).where(eq(stationBreaksTable.planId, planId));
  res.json(rows.map(r => ({ ...r, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt ? r.endedAt.toISOString() : null })));
});

// GET /:id/prep-requirements?station=prep_veg|prep_bases|prep_meat|all
router.get("/:id/prep-requirements", async (req, res) => {
  const planId = Number(req.params.id);
  const station = String(req.query.station ?? "all");

  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  if (planItems.length === 0) {
    res.json({ items: [], nextPlanDate: null });
    return;
  }

  const aggregated: Record<number, {
    ingredientId: number;
    ingredientName: string;
    unit: string;
    category: string | null;
    processingRatio: number | null;
    rawMeatTrayCapacityKg: number | null;
    totalCookedQty: number;
    totalRawQty: number;
    trayCount: number | null;
    recipes: string[];
  }> = {};

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch);
    const agg = aggregateIngredients(resolved);

    for (const [iid, ing] of agg) {
      const totalCookedQty = ing.quantityPerBatch * batchesTarget;
      const totalRawQty = ing.processingRatio ? totalCookedQty / ing.processingRatio : totalCookedQty;

      if (!aggregated[iid]) {
        aggregated[iid] = {
          ingredientId: iid,
          ingredientName: ing.ingredientName,
          unit: ing.unit,
          category: ing.category,
          processingRatio: ing.processingRatio,
          rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg,
          totalCookedQty: 0,
          totalRawQty: 0,
          trayCount: null,
          recipes: [],
        };
      }

      aggregated[iid].totalCookedQty += totalCookedQty;
      aggregated[iid].totalRawQty += totalRawQty;
      if (planItem.recipeName && !aggregated[iid].recipes.includes(planItem.recipeName)) {
        aggregated[iid].recipes.push(planItem.recipeName);
      }
    }
  }

  for (const item of Object.values(aggregated)) {
    if (item.rawMeatTrayCapacityKg && item.totalRawQty > 0) {
      item.trayCount = Math.ceil(item.totalRawQty / item.rawMeatTrayCapacityKg);
    }
    item.totalCookedQty = roundByUnit(item.totalCookedQty, item.unit);
    item.totalRawQty = roundByUnit(item.totalRawQty, item.unit);
  }

  let items = Object.values(aggregated);
  if (station === "prep_meat") {
    items = items.filter(i => i.category === "raw_meat" || i.rawMeatTrayCapacityKg != null);
  } else if (station === "prep_veg") {
    items = items.filter(i => i.category === "vegetable");
  } else if (station === "prep_bases") {
    items = items.filter(i => {
      if (!["base", "sauce"].includes(i.category ?? "")) return false;
      const name = (i.ingredientName ?? "").toLowerCase();
      if (name.includes("mozzarella") || name.includes("fior di latte")) return false;
      return true;
    });
  }

  const plan = await db.select({ planDate: productionPlansTable.planDate }).from(productionPlansTable).where(eq(productionPlansTable.id, planId)).limit(1);
  let nextPlanDate: string | null = null;
  if (plan.length > 0) {
    const nextPlans = await db
      .select({ planDate: productionPlansTable.planDate, id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(gt(productionPlansTable.planDate, plan[0].planDate))
      .orderBy(asc(productionPlansTable.planDate))
      .limit(1);
    nextPlanDate = nextPlans[0]?.planDate ?? null;
  }

  res.json({ items, nextPlanDate });
});

// GET /:id/prep-requirements-by-recipe?station=prep_veg|prep_bases|prep_meat
router.get("/:id/prep-requirements-by-recipe", async (req, res) => {
  const planId = Number(req.params.id);
  const station = String(req.query.station ?? "all");

  const planItems = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      sopUrlFromItem: productionPlanItemsTable.sopUrl,
      sopUrlFromRecipe: recipesTable.sopUrl,
      tinSize: productionPlanItemsTable.tinSize,
      maxBatchesPerTin: productionPlanItemsTable.maxBatchesPerTin,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  if (planItems.length === 0) {
    res.json({ recipes: [] });
    return;
  }

  const categoryMatchesStation = (category: string | null): boolean => {
    if (station === "prep_meat") return category === "raw_meat";
    if (station === "prep_veg") return category === "vegetable";
    if (station === "prep_bases") return ["base", "sauce"].includes(category ?? "");
    return true;
  };

  const result = [];
  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch);
    const agg = aggregateIngredients(resolved);

    const ingredients: Array<{
      ingredientId: number;
      ingredientName: string;
      unit: string;
      category: string | null;
      processingRatio: number | null;
      rawMeatTrayCapacityKg: number | null;
      minCookingTempC: number | null;
      estimatedCookTimeMin: number | null;
      ovenTempC: number | null;
      steamPct: number | null;
      cookedQty: number;
      rawQty: number;
      isRawMeat: boolean;
      isSeasoning: boolean;
      trayCount: number | null;
    }> = [];

    let hasRelevantIngredients = false;

    // Build per-ingredient marinade quantity (portions-based) so we can subtract it from
    // the aggregated total. An ingredient may appear both as a regular base ingredient AND
    // as a marinade (e.g. BBQ Sauce: 45g base + 6g marinade). We only want the non-marinade
    // quantity at its natural station, and we skip it entirely only if it is a pure marinade.
    const marinadeQtyPerPortion = new Map<number, number>();
    {
      const marinadeRows = await db
        .select({
          ingredientId: recipeIngredientsTable.ingredientId,
          quantity: recipeIngredientsTable.quantity,
        })
        .from(recipeIngredientsTable)
        .where(and(
          eq(recipeIngredientsTable.recipeId, planItem.recipeId),
          isNotNull(recipeIngredientsTable.marinadeForIngredientId)
        ));
      for (const r of marinadeRows) {
        if (r.ingredientId != null) {
          marinadeQtyPerPortion.set(
            r.ingredientId,
            (marinadeQtyPerPortion.get(r.ingredientId) ?? 0) + Number(r.quantity),
          );
        }
      }
    }

    for (const [, ing] of agg) {
      // Work out how much of this ingredient is marinade-only vs. base usage
      const marinadeOnlyPerBatch = (marinadeQtyPerPortion.get(ing.ingredientId) ?? 0) * portionsPerBatch;
      const nonMarinadePerBatch = ing.quantityPerBatch - marinadeOnlyPerBatch;

      // At non-prep_meat stations: skip if the ingredient is used ONLY as a marinade.
      // If it also has a base quantity, show that base quantity (not the inflated total).
      if (station !== "prep_meat" && nonMarinadePerBatch <= 0) continue;

      const category = ing.category;
      const isMainStation = categoryMatchesStation(category);

      if (!isMainStation) continue;

      // Mozzarella / Fior Di Latte is loaded directly to the building fridges — exclude from all prep stations
      const ingNameLc = (ing.ingredientName ?? "").toLowerCase();
      if (ingNameLc.includes("mozzarella") || ingNameLc.includes("fior di latte")) continue;

      hasRelevantIngredients = true;
      // At non-prep_meat stations use only the non-marinade portion of the quantity.
      // At prep_meat the ingredient won't appear as a direct row anyway (category filter
      // ensures only raw_meat shows there), so this path is safe either way.
      const effectiveQtyPerBatch = station === "prep_meat" ? ing.quantityPerBatch : nonMarinadePerBatch;
      const cookedQty = effectiveQtyPerBatch * batchesTarget;
      const rawQty = ing.processingRatio ? cookedQty / ing.processingRatio : cookedQty;

      ingredients.push({
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName,
        unit: ing.unit,
        category,
        processingRatio: ing.processingRatio,
        rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg,
        minCookingTempC: ing.minCookingTempC,
        estimatedCookTimeMin: ing.estimatedCookTimeMin,
        ovenTempC: ing.ovenTempC,
        steamPct: ing.steamPct,
        cookedQty: roundByUnit(cookedQty, ing.unit),
        rawQty: roundByUnit(rawQty, ing.unit),
        isRawMeat: category === "raw_meat",
        isSeasoning: false,
        trayCount: null,
      });
    }

    let marinades: Array<{
      rawMeatIngredientId: number;
      marinadeIngredientId: number | null;
      marinadeIngredientName: string | null;
      marinadeSubRecipeId: number | null;
      marinadeSubRecipeName: string | null;
      totalGrams: number;
    }> = [];

    if (station === "prep_meat" || station === "all") {
      const marinadeIngRows = await db
        .select({
          ingredientId: recipeIngredientsTable.ingredientId,
          ingredientName: ingredientsTable.name,
          quantity: recipeIngredientsTable.quantity,
          marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
        })
        .from(recipeIngredientsTable)
        .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
        .where(eq(recipeIngredientsTable.recipeId, planItem.recipeId));

      for (const mr of marinadeIngRows) {
        if (!mr.marinadeForIngredientId) continue;
        hasRelevantIngredients = true;
        const totalQty = Number(mr.quantity) * portionsPerBatch * batchesTarget;
        const totalGrams = Math.round(totalQty * 1000);
        marinades.push({
          rawMeatIngredientId: mr.marinadeForIngredientId,
          marinadeIngredientId: mr.ingredientId,
          marinadeIngredientName: mr.ingredientName ?? null,
          marinadeSubRecipeId: null,
          marinadeSubRecipeName: null,
          totalGrams,
        });
      }

      const marinadeSubRows = await db
        .select({
          subRecipeId: recipeSubRecipesTable.subRecipeId,
          subRecipeName: subRecipesTable.name,
          quantity: recipeSubRecipesTable.quantity,
          marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
        })
        .from(recipeSubRecipesTable)
        .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
        .where(eq(recipeSubRecipesTable.recipeId, planItem.recipeId));

      for (const sr of marinadeSubRows) {
        if (!sr.marinadeForIngredientId) continue;
        hasRelevantIngredients = true;
        const totalQty = Number(sr.quantity) * portionsPerBatch * batchesTarget;
        const totalGrams = Math.round(totalQty * 1000);
        marinades.push({
          rawMeatIngredientId: sr.marinadeForIngredientId,
          marinadeIngredientId: null,
          marinadeIngredientName: null,
          marinadeSubRecipeId: sr.subRecipeId,
          marinadeSubRecipeName: sr.subRecipeName ?? null,
          totalGrams,
        });
      }

      if (marinades.length === 0) {
        const oldMarinadeIngAlias = alias(ingredientsTable, "marinadeIng");
        const oldMarinadeSubAlias = alias(subRecipesTable, "marinadeSub");
        const oldMarinadeRows = await db
          .select({
            rawMeatIngredientId: recipeMeatMarinadesTable.rawMeatIngredientId,
            marinadeIngredientId: recipeMeatMarinadesTable.marinadeIngredientId,
            marinadeIngredientName: oldMarinadeIngAlias.name,
            marinadeSubRecipeId: recipeMeatMarinadesTable.marinadeSubRecipeId,
            marinadeSubRecipeName: oldMarinadeSubAlias.name,
            gramsPerKg: recipeMeatMarinadesTable.gramsPerKg,
          })
          .from(recipeMeatMarinadesTable)
          .leftJoin(oldMarinadeIngAlias, eq(recipeMeatMarinadesTable.marinadeIngredientId, oldMarinadeIngAlias.id))
          .leftJoin(oldMarinadeSubAlias, eq(recipeMeatMarinadesTable.marinadeSubRecipeId, oldMarinadeSubAlias.id))
          .where(eq(recipeMeatMarinadesTable.recipeId, planItem.recipeId));

        for (const mr of oldMarinadeRows) {
          hasRelevantIngredients = true;
          const rawMeatIng = ingredients.find(i => i.ingredientId === mr.rawMeatIngredientId);
          const rawMeatKg = rawMeatIng ? rawMeatIng.rawQty / 1000 : 0;
          const gpkg = Number(mr.gramsPerKg);
          const totalGrams = Math.round(rawMeatKg * gpkg);
          marinades.push({
            rawMeatIngredientId: mr.rawMeatIngredientId,
            marinadeIngredientId: mr.marinadeIngredientId ?? null,
            marinadeIngredientName: mr.marinadeIngredientName ?? null,
            marinadeSubRecipeId: mr.marinadeSubRecipeId ?? null,
            marinadeSubRecipeName: mr.marinadeSubRecipeName ?? null,
            totalGrams,
          });
        }
      }
    }

    if (!hasRelevantIngredients) continue;

    // Per-ingredient tray count — each raw meat uses its own capacity + its own marinades
    let trayCount: number | null = null;
    if (station === "prep_meat") {
      let totalTrays = 0;
      let anyHasCapacity = false;
      for (const ing of ingredients) {
        if (!ing.isRawMeat) continue;
        if (!ing.rawMeatTrayCapacityKg) continue;
        anyHasCapacity = true;
        const meatKg = ing.unit === "g" ? ing.rawQty / 1000 : ing.rawQty;
        const ingMarinadeKg = marinades
          .filter(m => m.rawMeatIngredientId === ing.ingredientId)
          .reduce((sum, m) => sum + m.totalGrams, 0) / 1000;
        const combinedKg = meatKg + ingMarinadeKg;
        ing.trayCount = Math.ceil(combinedKg / ing.rawMeatTrayCapacityKg);
        totalTrays += ing.trayCount;
      }
      if (anyHasCapacity) trayCount = totalTrays;
    }

    result.push({
      recipeId: planItem.recipeId,
      recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
      batchesTarget,
      sopUrl: planItem.sopUrlFromItem ?? planItem.sopUrlFromRecipe ?? null,
      tinSize: planItem.tinSize ?? null,
      maxBatchesPerTin: planItem.maxBatchesPerTin ?? null,
      tinCount: planItem.maxBatchesPerTin && batchesTarget > 0 ? Math.ceil(batchesTarget / planItem.maxBatchesPerTin) : null,
      trayCount,
      ingredients,
      marinades,
    });
  }

  res.json({ recipes: result });
});

// GET /:id/sub-recipe-requirements — total quantity of each sub-recipe needed for the plan
router.get("/:id/sub-recipe-requirements", async (req, res) => {
  const planId = Number(req.params.id);

  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
    })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));

  const subRecipeTotals = new Map<number, number>();

  for (const item of planItems) {
    if (!item.recipeId) continue;
    const batches = Number(item.batchesTarget) || 0;
    if (batches === 0) continue;

    const srRows = await db
      .select({
        subRecipeId: recipeSubRecipesTable.subRecipeId,
        quantity: recipeSubRecipesTable.quantity,
      })
      .from(recipeSubRecipesTable)
      .where(eq(recipeSubRecipesTable.recipeId, item.recipeId));

    for (const sr of srRows) {
      if (sr.subRecipeId == null) continue;
      const qty = Number(sr.quantity) * batches;
      subRecipeTotals.set(sr.subRecipeId, (subRecipeTotals.get(sr.subRecipeId) ?? 0) + qty);
    }
  }

  if (subRecipeTotals.size === 0) {
    res.json({ subRecipes: [] });
    return;
  }

  const subRecipeIds = [...subRecipeTotals.keys()];
  const srRows = await db
    .select()
    .from(subRecipesTable)
    .where(inArray(subRecipesTable.id, subRecipeIds))
    .orderBy(subRecipesTable.name);

  const subRecipeAlias = alias(subRecipesTable, "comp_sr");

  const result = [];
  for (const sr of srRows) {
    const ingRows = await db
      .select({
        id: subRecipeIngredientsTable.id,
        ingredientId: subRecipeIngredientsTable.ingredientId,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        quantity: subRecipeIngredientsTable.quantity,
      })
      .from(subRecipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(subRecipeIngredientsTable.subRecipeId, sr.id));

    const nestedRows = await db
      .select({
        id: subRecipeSubRecipesTable.id,
        componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
        componentSubRecipeName: subRecipeAlias.name,
        componentYieldUnit: subRecipeAlias.yieldUnit,
        quantity: subRecipeSubRecipesTable.quantity,
      })
      .from(subRecipeSubRecipesTable)
      .leftJoin(subRecipeAlias, eq(subRecipeSubRecipesTable.componentSubRecipeId, subRecipeAlias.id))
      .where(eq(subRecipeSubRecipesTable.subRecipeId, sr.id));

    result.push({
      subRecipeId: sr.id,
      subRecipeName: sr.name,
      yield: Number(sr.yield),
      yieldUnit: sr.yieldUnit,
      shelfLifeDays: sr.shelfLifeDays,
      isBase: sr.isBase,
      totalRequired: subRecipeTotals.get(sr.id) ?? 0,
      ingredients: ingRows.map(i => ({
        id: i.id,
        ingredientId: i.ingredientId ?? 0,
        ingredientName: i.ingredientName ?? "",
        unit: i.unit ?? "kg",
        quantity: Number(i.quantity),
      })),
      subRecipeComponents: nestedRows.map(n => ({
        id: n.id,
        componentSubRecipeId: n.componentSubRecipeId ?? 0,
        componentSubRecipeName: n.componentSubRecipeName ?? "",
        componentYieldUnit: n.componentYieldUnit ?? "kg",
        quantity: Number(n.quantity),
      })),
    });
  }

  res.json({ subRecipes: result });
});

// GET /:id/filling-mix — per-item filling mix ingredients with per-tin weights
router.get("/:id/filling-mix", async (req, res) => {
  try {
  const planId = Number(req.params.id);

  const planItemsResult = await db.execute(sql`
    SELECT ppi.id, ppi.recipe_id as "recipeId", r.name as "recipeName",
           ppi.batches_target as "batchesTarget", r.portions_per_batch as "portionsPerBatch",
           ppi.max_batches_per_tin as "maxBatchesPerTin", ppi.tin_size as "tinSize",
           ppi.order_position as "orderPosition"
    FROM production_plan_items ppi
    LEFT JOIN recipes r ON ppi.recipe_id = r.id
    WHERE ppi.plan_id = ${planId}
    ORDER BY ppi.order_position
  `);
  const planItems = planItemsResult.rows as Array<{ id: number; recipeId: number; recipeName: string | null; batchesTarget: number | null; portionsPerBatch: number | null; maxBatchesPerTin: number | null; tinSize: string | null; orderPosition: number }>;

  if (planItems.length === 0) {
    res.json({ items: [] });
    return;
  }

  const recipeIds = [...new Set(planItems.map(i => i.recipeId))].filter((x): x is number => x != null);
  if (recipeIds.length === 0) {
    res.json({ items: planItems.map(item => ({ itemId: item.id, recipeId: item.recipeId, recipeName: item.recipeName, tinSize: item.tinSize, tinsTarget: 0, batchesPerTin: 0, servingsPerTin: 0, fillingIngredients: [], fillingSubRecipes: [] })) });
    return;
  }

  const fillingIngredients = await db.execute(sql`
    SELECT ri.recipe_id as "recipeId", ri.ingredient_id as "ingredientId",
           i.name as "ingredientName", i.unit, ri.quantity,
           ri.marinade_for_ingredient_id as "marinadeForIngredientId"
    FROM recipe_ingredients ri
    LEFT JOIN ingredients i ON ri.ingredient_id = i.id
    WHERE ri.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
      AND ri.include_in_filling_mix = true
  `);

  const fillingSubRecipeRows = await db.execute(sql`
    SELECT rs.recipe_id as "recipeId", rs.sub_recipe_id as "subRecipeId",
           s.name as "subRecipeName", s.yield_unit as unit, rs.quantity,
           rs.marinade_for_ingredient_id as "marinadeForIngredientId"
    FROM recipe_sub_recipes rs
    LEFT JOIN sub_recipes s ON rs.sub_recipe_id = s.id
    WHERE rs.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
      AND rs.include_in_filling_mix = true
  `);

  const fiRows = fillingIngredients.rows as Array<{ recipeId: number; ingredientId: number; ingredientName: string; unit: string; quantity: string; marinadeForIngredientId: number | null }>;
  const fsRows = fillingSubRecipeRows.rows as Array<{ recipeId: number; subRecipeId: number; subRecipeName: string; unit: string; quantity: string; marinadeForIngredientId: number | null }>;

  const result = planItems.map(item => {
    const bpt = item.maxBatchesPerTin ?? 1;
    const target = item.batchesTarget ?? 0;
    const tinsTarget = Math.ceil(target / bpt);
    const batchesPerTin = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
    const servingsPerTin = batchesPerTin * (item.portionsPerBatch ?? 1);

    const ppb = item.portionsPerBatch ?? 1;

    const recipeIngRows = fiRows.filter(fi => fi.recipeId === item.recipeId);
    const recipeSubRows = fsRows.filter(fs => fs.recipeId === item.recipeId);

    // Collect extra qty to add to each raw meat ingredient from marinades.
    // Both ingredient-based and sub-recipe-based seasonings merge into the parent meat.
    const extraQtyByMeatId = new Map<number, number>();
    const marinadeIngIds = new Set<number>();
    const marinadeSubIds = new Set<number>();

    for (const fi of recipeIngRows) {
      if (fi.marinadeForIngredientId != null) {
        marinadeIngIds.add(fi.ingredientId);
        const current = extraQtyByMeatId.get(fi.marinadeForIngredientId) ?? 0;
        extraQtyByMeatId.set(fi.marinadeForIngredientId, current + Number(fi.quantity));
      }
    }

    for (const fs of recipeSubRows) {
      if (fs.marinadeForIngredientId != null) {
        marinadeSubIds.add(fs.subRecipeId);
        const current = extraQtyByMeatId.get(fs.marinadeForIngredientId) ?? 0;
        extraQtyByMeatId.set(fs.marinadeForIngredientId, current + Number(fs.quantity));
      }
    }

    const ingredients = recipeIngRows
      .filter(fi => !marinadeIngIds.has(fi.ingredientId))
      .map(fi => {
        const extra = extraQtyByMeatId.get(fi.ingredientId) ?? 0;
        const totalQtyPerPortion = Number(fi.quantity) + extra;
        return {
          ingredientId: fi.ingredientId,
          name: fi.ingredientName,
          unit: fi.unit,
          qtyPerBatch: totalQtyPerPortion * ppb,
          qtyPerTin: totalQtyPerPortion * ppb * batchesPerTin,
        };
      });

    const subRecipes = recipeSubRows
      .filter(fs => !marinadeSubIds.has(fs.subRecipeId))
      .map(fs => ({
        subRecipeId: fs.subRecipeId,
        name: fs.subRecipeName,
        unit: fs.unit,
        qtyPerBatch: Number(fs.quantity) * ppb,
        qtyPerTin: Number(fs.quantity) * ppb * batchesPerTin,
      }));

    return {
      itemId: item.id,
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      tinSize: item.tinSize,
      tinsTarget,
      batchesPerTin,
      servingsPerTin,
      fillingIngredients: ingredients,
      fillingSubRecipes: subRecipes,
    };
  });

  res.json({ items: result });
  } catch (err) {
    console.error("filling-mix error:", err);
    res.status(500).json({ error: "Internal error computing filling mix" });
  }
});

// GET /:id/assembly-items — assembly checklist for building station
router.get("/:id/assembly-items", async (req, res) => {
  try {
    const planId = Number(req.params.id);

    const planItemsResult = await db.execute(sql`
      SELECT ppi.id, ppi.recipe_id as "recipeId", r.name as "recipeName",
             ppi.batches_target as "batchesTarget", r.portions_per_batch as "portionsPerBatch"
      FROM production_plan_items ppi
      LEFT JOIN recipes r ON ppi.recipe_id = r.id
      WHERE ppi.plan_id = ${planId}
      ORDER BY ppi.order_position
    `);
    const planItems = planItemsResult.rows as Array<{
      id: number; recipeId: number; recipeName: string | null;
      batchesTarget: number | null; portionsPerBatch: number | null;
    }>;

    if (planItems.length === 0) {
      res.json({ items: [] });
      return;
    }

    const recipeIds = [...new Set(planItems.map(i => i.recipeId))].filter((x): x is number => x != null);
    if (recipeIds.length === 0) {
      res.json({ items: planItems.map(item => ({ itemId: item.id, recipeId: item.recipeId, recipeName: item.recipeName, fillingWeightPerBatch: 0, fillingWeightHalfBatch: 0, assemblyItems: [] })) });
      return;
    }

    const fillingIngRows = await db.execute(sql`
      SELECT ri.recipe_id as "recipeId", ri.quantity, i.unit
      FROM recipe_ingredients ri
      LEFT JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
        AND ri.include_in_filling_mix = true
    `);

    const fillingSubRows = await db.execute(sql`
      SELECT rs.recipe_id as "recipeId", rs.quantity, s.yield_unit as unit
      FROM recipe_sub_recipes rs
      LEFT JOIN sub_recipes s ON rs.sub_recipe_id = s.id
      WHERE rs.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
        AND rs.include_in_filling_mix = true
        AND (s.is_base = false OR s.is_base IS NULL)
    `);

    const nonFillingIngRows = await db.execute(sql`
      SELECT ri.recipe_id as "recipeId", ri.ingredient_id as "ingredientId",
             i.name as "ingredientName", i.unit, ri.quantity
      FROM recipe_ingredients ri
      LEFT JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
        AND ri.include_in_filling_mix = false
        AND ri.marinade_for_ingredient_id IS NULL
    `);

    const nonFillingSubRows = await db.execute(sql`
      SELECT rs.recipe_id as "recipeId", rs.sub_recipe_id as "subRecipeId",
             s.name as "subRecipeName", s.yield_unit as unit, rs.quantity,
             s.is_base as "isBase"
      FROM recipe_sub_recipes rs
      LEFT JOIN sub_recipes s ON rs.sub_recipe_id = s.id
      WHERE rs.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
        AND rs.include_in_filling_mix = false
        AND rs.marinade_for_ingredient_id IS NULL
        AND (s.is_base = false OR s.is_base IS NULL)
        AND LOWER(s.name) NOT LIKE '%dough%'
    `);

    const fiRows = fillingIngRows.rows as Array<{ recipeId: number; quantity: string; unit: string }>;
    const fsRows = fillingSubRows.rows as Array<{ recipeId: number; quantity: string; unit: string }>;
    const nfiRows = nonFillingIngRows.rows as Array<{ recipeId: number; ingredientId: number; ingredientName: string; unit: string; quantity: string }>;
    const nfsRows = nonFillingSubRows.rows as Array<{ recipeId: number; subRecipeId: number; subRecipeName: string; unit: string; quantity: string; isBase: boolean }>;

    const toGrams = (qty: number, unit: string): number => {
      const u = (unit || "").toLowerCase();
      if (u === "kg") return qty * 1000;
      if (u === "mg") return qty / 1000;
      if (u === "l") return qty * 1000;
      if (u === "ml") return qty;
      return qty;
    };

    const result = planItems.map(item => {
      const ppb = item.portionsPerBatch ?? 1;

      const fillingTotalGrams = [
        ...fiRows.filter(r => r.recipeId === item.recipeId).map(r => toGrams(Number(r.quantity), r.unit)),
        ...fsRows.filter(r => r.recipeId === item.recipeId).map(r => toGrams(Number(r.quantity), r.unit)),
      ].reduce((sum, q) => sum + q, 0);

      const fillingWeightPerBatch = fillingTotalGrams * ppb;
      const fillingWeightHalfBatch = fillingWeightPerBatch / 2;

      const assemblyItems: Array<{ name: string; unit: string; weightPerBatch: number; weightHalfBatch: number }> = [];

      for (const row of nfiRows.filter(r => r.recipeId === item.recipeId)) {
        const wt = toGrams(Number(row.quantity), row.unit) * ppb;
        assemblyItems.push({
          name: row.ingredientName,
          unit: "g",
          weightPerBatch: wt,
          weightHalfBatch: wt / 2,
        });
      }

      for (const row of nfsRows.filter(r => r.recipeId === item.recipeId)) {
        if (row.isBase) continue;
        const wt = toGrams(Number(row.quantity), row.unit) * ppb;
        assemblyItems.push({
          name: row.subRecipeName,
          unit: "g",
          weightPerBatch: wt,
          weightHalfBatch: wt / 2,
        });
      }

      return {
        itemId: item.id,
        recipeId: item.recipeId,
        recipeName: item.recipeName,
        fillingWeightPerBatch,
        fillingWeightHalfBatch,
        assemblyItems,
      };
    });

    res.json({ items: result });
  } catch (err) {
    console.error("assembly-items error:", err);
    res.status(500).json({ error: "Internal error computing assembly items" });
  }
});

// GET /:id/ingredient-requirements?station=prep_veg|prep_bases|prep_meat|all
router.get("/:id/ingredient-requirements", async (req, res) => {
  const planId = Number(req.params.id);
  const station = String(req.query.station ?? "all");

  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  if (planItems.length === 0) {
    res.json({ ingredients: [], totalRecipes: 0, totalBatches: 0 });
    return;
  }

  const ingredientMap: Record<number, {
    ingredientId: number;
    ingredientName: string;
    unit: string;
    category: string | null;
    processingRatio: number | null;
    rawMeatTrayCapacityKg: number | null;
    totalCookedQty: number;
    totalRawQty: number;
    trayCount: number | null;
    recipes: Array<{ recipeId: number; recipeName: string; batchesTarget: number; cookedQty: number; rawQty: number }>;
  }> = {};

  let totalBatches = 0;

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;
    totalBatches += batchesTarget;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch);
    const agg = aggregateIngredients(resolved);

    for (const [iid, ing] of agg) {
      const cookedQty = ing.quantityPerBatch * batchesTarget;
      const rawQty = ing.processingRatio ? cookedQty / ing.processingRatio : cookedQty;

      if (!ingredientMap[iid]) {
        ingredientMap[iid] = {
          ingredientId: iid,
          ingredientName: ing.ingredientName,
          unit: ing.unit,
          category: ing.category,
          processingRatio: ing.processingRatio,
          rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg,
          totalCookedQty: 0,
          totalRawQty: 0,
          trayCount: null,
          recipes: [],
        };
      }

      ingredientMap[iid].totalCookedQty += cookedQty;
      ingredientMap[iid].totalRawQty += rawQty;

      const recipeId = planItem.recipeId;
      const recipeName = planItem.recipeName ?? `Recipe #${recipeId}`;
      const existingRecipe = ingredientMap[iid].recipes.find(r => r.recipeId === recipeId);
      if (existingRecipe) {
        existingRecipe.batchesTarget += batchesTarget;
        existingRecipe.cookedQty += cookedQty;
        existingRecipe.rawQty += rawQty;
      } else {
        ingredientMap[iid].recipes.push({
          recipeId,
          recipeName,
          batchesTarget,
          cookedQty,
          rawQty,
        });
      }
    }
  }

  for (const item of Object.values(ingredientMap)) {
    if (item.rawMeatTrayCapacityKg && item.totalRawQty > 0) {
      item.trayCount = Math.ceil(item.totalRawQty / item.rawMeatTrayCapacityKg);
    }
    item.totalCookedQty = roundByUnit(item.totalCookedQty, item.unit);
    item.totalRawQty = roundByUnit(item.totalRawQty, item.unit);
    for (const r of item.recipes) {
      r.cookedQty = roundByUnit(r.cookedQty, item.unit);
      r.rawQty = roundByUnit(r.rawQty, item.unit);
    }
  }

  let ingredients = Object.values(ingredientMap);

  if (station === "prep_meat") {
    ingredients = ingredients.filter(i => i.category === "raw_meat" || i.rawMeatTrayCapacityKg != null);
  } else if (station === "prep_veg") {
    ingredients = ingredients.filter(i => i.category === "vegetable");
  } else if (station === "prep_bases") {
    ingredients = ingredients.filter(i => {
      if (!["base", "sauce"].includes(i.category ?? "")) return false;
      const name = (i.ingredientName ?? "").toLowerCase();
      if (name.includes("mozzarella") || name.includes("fior di latte")) return false;
      return true;
    });
  }

  ingredients.sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));

  res.json({
    ingredients,
    totalRecipes: planItems.filter(p => (Number(p.batchesTarget) || 0) > 0).length,
    totalBatches,
  });
});

// GET /:id/eod-summary?stationType=...
// Returns server-derived EOD stats for the current user at a given station:
// totalBatches, activeMinutes, breakMinutes, bph, minsPerBatch, planCompletionRate, perRecipe avg
router.get("/:id/eod-summary", async (req, res) => {
  const planId = Number(req.params.id);
  const stationType = String(req.query.stationType ?? "");
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  if (!stationType) {
    res.status(400).json({ error: "stationType is required" });
    return;
  }

  // Get all plan items joined with recipe name (for plan completion rate + per-recipe breakdown)
  const planItems = await db.select({
    id: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
    batchesComplete: productionPlanItemsTable.batchesComplete,
    batchesTarget: productionPlanItemsTable.batchesTarget,
    recipeName: recipesTable.name,
  })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  const itemIds = planItems.map(i => i.id);
  const totalBatchesTarget = planItems.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalBatchesComplete = planItems.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const planCompletionRate = totalBatchesTarget > 0 ? Math.round((totalBatchesComplete / totalBatchesTarget) * 100) : 0;

  if (itemIds.length === 0) {
    res.json({ totalBatches: 0, activeMinutes: 0, breakMinutes: 0, bph: 0, minsPerBatch: null, planCompletionRate: 0, perRecipe: [] });
    return;
  }

  // Fetch this user's completions for this station
  const allCompletions = await db.select().from(batchCompletionsTable)
    .where(inArray(batchCompletionsTable.planItemId, itemIds));

  const myCompletions = sessionUserId
    ? allCompletions.filter(c => c.stationType === stationType && c.userId === sessionUserId)
    : allCompletions.filter(c => c.stationType === stationType);

  const totalBatches = myCompletions.length;

  // Compute total break minutes for this user+station
  const breaks = await db.select().from(stationBreaksTable)
    .where(and(
      eq(stationBreaksTable.planId, planId),
      sql`station_type = ${stationType}`,
      ...(sessionUserId ? [eq(stationBreaksTable.userId, sessionUserId)] : [])
    ));

  const breakMinutes = breaks.reduce((sum, b) => {
    if (!b.endedAt) return sum;
    return sum + Math.round((b.endedAt.getTime() - b.startedAt.getTime()) / 60000);
  }, 0);

  // Compute active minutes from first completion to last
  const sortedCompletions = [...myCompletions].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  let activeMinutes = 0;
  if (sortedCompletions.length > 0) {
    const firstAt = sortedCompletions[0].completedAt;
    const lastAt = sortedCompletions[sortedCompletions.length - 1].completedAt;
    const spanMinutes = Math.round((lastAt.getTime() - firstAt.getTime()) / 60000);
    activeMinutes = Math.max(0, spanMinutes - breakMinutes);
  }

  const activeHours = activeMinutes / 60;
  const bph = activeHours > 0 ? totalBatches / activeHours : 0;
  const minsPerBatch = totalBatches > 0 && activeMinutes > 0 ? activeMinutes / totalBatches : null;

  // Per-recipe avg mins/batch:
  // Building station completions do not record startedAt, so we compute avg from consecutive
  // inter-completion intervals (sorted completedAt) for each recipe+user.
  // When startedAt IS present (e.g. timing-standard-based stations), prefer that.
  const perRecipeMap: Record<number, { name: string; count: number; avgMins: number | null }> = {};
  for (const it of planItems) {
    perRecipeMap[it.id] = { name: it.recipeName ?? `Recipe #${it.id}`, count: 0, avgMins: null };
  }

  // Group completions by planItemId (sorted ascending by completedAt)
  const byItemSorted: Record<number, typeof myCompletions> = {};
  for (const c of [...myCompletions].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())) {
    if (!perRecipeMap[c.planItemId]) continue;
    perRecipeMap[c.planItemId].count++;
    if (!byItemSorted[c.planItemId]) byItemSorted[c.planItemId] = [];
    byItemSorted[c.planItemId].push(c);
  }

  for (const [itemIdStr, comps] of Object.entries(byItemSorted)) {
    const itemId = Number(itemIdStr);
    const intervals: number[] = [];

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      // Prefer explicit startedAt if available
      if (c.startedAt && c.completedAt) {
        const mins = (c.completedAt.getTime() - c.startedAt.getTime()) / 60000;
        if (mins > 0 && mins < 240) intervals.push(mins);
      } else if (i > 0) {
        // Inter-completion interval (proxy for time per batch)
        const prev = comps[i - 1];
        const mins = (c.completedAt.getTime() - prev.completedAt.getTime()) / 60000;
        if (mins > 0 && mins < 240) intervals.push(mins);
      }
    }

    if (intervals.length > 0) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      perRecipeMap[itemId].avgMins = avg;
    }
  }

  const perRecipe = Object.values(perRecipeMap).filter(r => r.count > 0);

  res.json({ totalBatches, activeMinutes, breakMinutes, bph, minsPerBatch, planCompletionRate, perRecipe });
});

// GET /:id/kpi?stationType=...&date=YYYY-MM-DD
// Returns server-side KPI computed from batch_completions minus station_breaks for today
router.get("/:id/kpi", async (req, res) => {
  const planId = Number(req.params.id);
  const stationType = String(req.query.stationType ?? "");
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  if (!stationType) {
    res.status(400).json({ error: "stationType is required" });
    return;
  }

  // Get plan items for this plan
  const planItems = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));
  const itemIds = planItems.map(i => i.id);
  if (itemIds.length === 0) {
    res.json({ batchesCompleted: 0, activeMinutes: 0, breakMinutes: 0, batchesPerHour: 0 });
    return;
  }

  // Batch completions for this station (today, this user if logged in)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const completions = await db.select({ completedAt: batchCompletionsTable.completedAt, startedAt: batchCompletionsTable.startedAt })
    .from(batchCompletionsTable)
    .where(
      and(
        inArray(batchCompletionsTable.planItemId, itemIds),
        eq(batchCompletionsTable.stationType, stationType),
        sql`completed_at >= ${today.toISOString()} AND completed_at < ${tomorrow.toISOString()}`,
        sessionUserId != null ? eq(batchCompletionsTable.userId, sessionUserId) : undefined,
      )
    );

  // Station breaks for this station (today, this plan, this user)
  // Scoped to sessionUserId to match completion scoping — a user's KPI only subtracts their own breaks
  const breaksRows = await db.select({
    startedAt: stationBreaksTable.startedAt,
    endedAt: stationBreaksTable.endedAt,
  })
    .from(stationBreaksTable)
    .where(
      and(
        eq(stationBreaksTable.planId, planId),
        eq(stationBreaksTable.stationType, stationType),
        sql`started_at >= ${today.toISOString()} AND started_at < ${tomorrow.toISOString()}`,
        sessionUserId != null ? eq(stationBreaksTable.userId, sessionUserId) : undefined,
      )
    );

  const batchesCompleted = completions.length;

  // Calculate break minutes (sum of all completed breaks; active break counted up to now)
  let breakMinutes = 0;
  for (const b of breaksRows) {
    const end = b.endedAt ?? new Date();
    const mins = Math.max(0, (end.getTime() - b.startedAt.getTime()) / 60000);
    breakMinutes += mins;
  }

  // Calculate active minutes from first completion to now (or 0 if no completions)
  let activeMinutes = 0;
  if (completions.length > 0) {
    const earliest = completions.reduce((min, c) => {
      const ts = c.startedAt ?? c.completedAt;
      return ts < min ? ts : min;
    }, completions[0].startedAt ?? completions[0].completedAt);
    const totalElapsedMinutes = (new Date().getTime() - earliest.getTime()) / 60000;
    activeMinutes = Math.max(0, totalElapsedMinutes - breakMinutes);
  }

  const batchesPerHour = activeMinutes > 0 ? (batchesCompleted / (activeMinutes / 60)) : 0;

  res.json({
    batchesCompleted,
    activeMinutes: Math.round(activeMinutes),
    breakMinutes: Math.round(breakMinutes),
    batchesPerHour: Math.round(batchesPerHour * 10) / 10,
  });
});

// GET /:id/station-activity — active users per station today
// Derived from batch_completions (primary) and station_breaks (supplementary)
router.get("/:id/station-activity", async (req, res) => {
  const planId = Number(req.params.id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Get plan items to join completions
  const planItems = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));
  const itemIds = planItems.map(i => i.id);

  // Users who completed a batch today at each station (primary source)
  const completionUsers: { stationType: string; userId: number | null }[] = itemIds.length > 0
    ? await db.select({ stationType: batchCompletionsTable.stationType, userId: batchCompletionsTable.userId })
        .from(batchCompletionsTable)
        .where(
          and(
            inArray(batchCompletionsTable.planItemId, itemIds),
            sql`completed_at >= ${today.toISOString()} AND completed_at < ${tomorrow.toISOString()}`
          )
        )
    : [];

  // Also include users who started a break today (covers users who worked but haven't completed a batch yet)
  const breakUsers = await db.select({ stationType: stationBreaksTable.stationType, userId: stationBreaksTable.userId })
    .from(stationBreaksTable)
    .where(
      and(
        eq(stationBreaksTable.planId, planId),
        sql`started_at >= ${today.toISOString()} AND started_at < ${tomorrow.toISOString()}`
      )
    );

  // Deduplicate: count distinct user IDs per station
  const byStation: Record<string, Set<string>> = {};
  const addUser = (stationType: string, userId: number | null) => {
    if (!byStation[stationType]) byStation[stationType] = new Set();
    byStation[stationType].add(userId != null ? String(userId) : "anon");
  };
  for (const r of completionUsers) addUser(r.stationType, r.userId);
  for (const r of breakUsers) addUser(r.stationType, r.userId);

  const result: Record<string, number> = {};
  for (const [st, users] of Object.entries(byStation)) {
    result[st] = users.size;
  }

  res.json(result);
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /:id/items/:itemId/wonly — atomically increment wonkyCount by 1 (quality reject)
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/wonly", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  // Verify item belongs to this plan first
  const [exists] = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!exists) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  // Atomic increment — avoids read-modify-write race under concurrent taps
  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ wonlyCount: sql`${productionPlanItemsTable.wonlyCount} + 1` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ wonlyCount: productionPlanItemsTable.wonlyCount });

  res.json({ itemId, wonlyCount: updated.wonlyCount });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /:id/items/:itemId/wonly — atomically decrement wonkyCount (floor at 0)
// ──────────────────────────────────────────────────────────────────────────────
router.delete("/:id/items/:itemId/wonly", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  // Read current count only to enforce the floor-at-zero guard
  const [item] = await db.select({ id: productionPlanItemsTable.id, wonlyCount: productionPlanItemsTable.wonlyCount })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }
  if ((item.wonlyCount ?? 0) <= 0) {
    res.status(409).json({ error: "Wonky count is already 0" });
    return;
  }

  // Atomic decrement with GREATEST guard so DB can never go below 0
  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ wonlyCount: sql`GREATEST(${productionPlanItemsTable.wonlyCount} - 1, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ wonlyCount: productionPlanItemsTable.wonlyCount });

  res.json({ itemId, wonlyCount: updated.wonlyCount });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /:id/items/:itemId/wrapping-complete — toggle wrapping done for a plan item
// ──────────────────────────────────────────────────────────────────────────────
router.patch("/:id/items/:itemId/wrapping-complete", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const complete = req.body.complete;
  if (typeof complete !== "boolean") {
    res.status(400).json({ error: "Body must contain { complete: boolean }" });
    return;
  }

  const [item] = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ wrappingComplete: complete })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ id: productionPlanItemsTable.id, wrappingComplete: productionPlanItemsTable.wrappingComplete });

  res.json({ itemId: updated.id, wrappingComplete: updated.wrappingComplete });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /:id/items/:itemId/extra-packs-built — set extra individual packs built
// Used by building station to record partial last-batch packs or extra-ball packs
// ──────────────────────────────────────────────────────────────────────────────
router.patch("/:id/items/:itemId/extra-packs-built", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { delta } = req.body; // +1 or -1
  if (typeof delta !== "number" || (delta !== 1 && delta !== -1)) {
    res.status(400).json({ error: "Body must contain { delta: 1 | -1 }" });
    return;
  }

  const [item] = await db.select({ id: productionPlanItemsTable.id, extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
  if (delta === -1 && (item.extraPacksBuilt ?? 0) <= 0) {
    res.status(409).json({ error: "Extra packs count is already 0" });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ extraPacksBuilt: delta === 1
      ? sql`${productionPlanItemsTable.extraPacksBuilt} + 1`
      : sql`GREATEST(${productionPlanItemsTable.extraPacksBuilt} - 1, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt });

  res.json({ itemId, extraPacksBuilt: updated.extraPacksBuilt });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /:id/items/:itemId/fridge — add wrapped packs to fridge stock (atomic increment)
// Also upserts the master stock_entries for the production fridge so Factory Number stays in sync.
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/fridge", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) {
    res.status(400).json({ error: "Body must contain { qty: positive integer }" });
    return;
  }

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ fridgeQty: sql`${productionPlanItemsTable.fridgeQty} + ${qty}` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ fridgeQty: productionPlanItemsTable.fridgeQty });

  await syncRecipeFridgeStock(item.recipeId, qty);

  res.json({ itemId, fridgeQty: updated.fridgeQty });
});

// DELETE /:id/items/:itemId/fridge — undo last fridge addition (atomic decrement, floor 0)
router.delete("/:id/items/:itemId/fridge", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) {
    res.status(400).json({ error: "Body must contain { qty: positive integer }" });
    return;
  }

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ fridgeQty: sql`GREATEST(${productionPlanItemsTable.fridgeQty} - ${qty}, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ fridgeQty: productionPlanItemsTable.fridgeQty });

  await syncRecipeFridgeStock(item.recipeId, -qty);

  res.json({ itemId, fridgeQty: updated.fridgeQty });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST/DELETE /:id/items/:itemId/freezer — freezer stock (atomic increment/decrement)
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/freezer", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) { res.status(400).json({ error: "Body must contain { qty: positive integer }" }); return; }
  const [item] = await db.select({ id: productionPlanItemsTable.id }).from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
  const [updated] = await db.update(productionPlanItemsTable)
    .set({ freezerQty: sql`${productionPlanItemsTable.freezerQty} + ${qty}` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ freezerQty: productionPlanItemsTable.freezerQty });
  res.json({ itemId, freezerQty: updated.freezerQty });
});

router.delete("/:id/items/:itemId/freezer", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) { res.status(400).json({ error: "Body must contain { qty: positive integer }" }); return; }
  const [item] = await db.select({ id: productionPlanItemsTable.id }).from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
  const [updated] = await db.update(productionPlanItemsTable)
    .set({ freezerQty: sql`GREATEST(${productionPlanItemsTable.freezerQty} - ${qty}, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ freezerQty: productionPlanItemsTable.freezerQty });
  res.json({ itemId, freezerQty: updated.freezerQty });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST/DELETE /:id/items/:itemId/prep-fridge — prep fridge stock (atomic increment/decrement)
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/prep-fridge", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) { res.status(400).json({ error: "Body must contain { qty: positive integer }" }); return; }
  const [item] = await db.select({ id: productionPlanItemsTable.id }).from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
  const [updated] = await db.update(productionPlanItemsTable)
    .set({ prepFridgeQty: sql`${productionPlanItemsTable.prepFridgeQty} + ${qty}` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ prepFridgeQty: productionPlanItemsTable.prepFridgeQty });
  res.json({ itemId, prepFridgeQty: updated.prepFridgeQty });
});

router.delete("/:id/items/:itemId/prep-fridge", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) { res.status(400).json({ error: "Body must contain { qty: positive integer }" }); return; }
  const [item] = await db.select({ id: productionPlanItemsTable.id }).from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
  const [updated] = await db.update(productionPlanItemsTable)
    .set({ prepFridgeQty: sql`GREATEST(${productionPlanItemsTable.prepFridgeQty} - ${qty}, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ prepFridgeQty: productionPlanItemsTable.prepFridgeQty });
  res.json({ itemId, prepFridgeQty: updated.prepFridgeQty });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /:id/dough-prep — computes dough requirements for the plan
// Returns: total dough per ingredient, mixing schedule, per-recipe ball weights
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/dough-prep", async (req, res) => {
  const planId = Number(req.params.id);

  // ── 1. Determine target plan ──
  // mode=current: use planId as-is (used by Dough Sheeting which runs on production day D)
  // default (D-1 mode): look up next active plan after the current plan's date
  // Optional afterDate=YYYY-MM-DD to override which date to search from
  const useCurrentPlan = req.query.mode === "current";

  let nextPlan: { id: number; planDate: string; name: string } | null = null;
  let targetPlanId = planId;

  if (!useCurrentPlan) {
    let afterDate: string;
    if (req.query.afterDate && typeof req.query.afterDate === "string") {
      afterDate = req.query.afterDate;
    } else {
      const currentPlan = await db.select({ planDate: productionPlansTable.planDate }).from(productionPlansTable).where(eq(productionPlansTable.id, planId)).limit(1);
      afterDate = currentPlan.length > 0 ? currentPlan[0].planDate : new Date().toISOString().slice(0, 10);
    }

    const nextPlans = await db
      .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, name: productionPlansTable.name })
      .from(productionPlansTable)
      .where(and(gt(productionPlansTable.planDate, afterDate), eq(productionPlansTable.status, "active")))
      .orderBy(asc(productionPlansTable.planDate))
      .limit(1);
    if (nextPlans.length > 0) nextPlan = nextPlans[0];

    targetPlanId = nextPlan?.id ?? planId;
  }

  // ── 2. Get mixer capacity + daily extra ball settings ──
  const allSettings = await db.select().from(appSettingsTable);
  const getSetting = (key: string, def: number) => {
    const row = allSettings.find(r => r.key === key);
    return row ? Number(row.value) : def;
  };
  const mixerCapacityKg = getSetting("mixer_capacity_kg", 25);
  const extraPackBallCount  = getSetting("daily_extra_pack_ball_count", 2);
  const extraPackBallWeightG = getSetting("daily_extra_pack_ball_weight_g", 230);
  const snackBallCount      = getSetting("daily_snack_ball_count", 1);
  const snackBallWeightG    = getSetting("daily_snack_ball_weight_g", 200);
  const extraBallsKg = (extraPackBallCount * extraPackBallWeightG + snackBallCount * snackBallWeightG) / 1000;

  // ── 3. Get plan items for the target plan ──
  const planItems = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      orderPosition: productionPlanItemsTable.orderPosition,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, targetPlanId))
    .orderBy(productionPlanItemsTable.orderPosition);

  if (planItems.length === 0) {
    res.json({ ingredients: [], recipes: [], totalDoughKg: 0, mixerCapacityKg, mixCount: 0, nextPlan });
    return;
  }

  // ── 4. Find dough sub-recipe links for each recipe ──
  const recipeIds = planItems.map(p => p.recipeId).filter(Boolean) as number[];
  const subRecipeLinks = await db
    .select({
      recipeId: recipeSubRecipesTable.recipeId,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantityPerBatch: recipeSubRecipesTable.quantity,
      subRecipeName: subRecipesTable.name,
      subRecipeYield: subRecipesTable.yield,
      subRecipeYieldUnit: subRecipesTable.yieldUnit,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(inArray(recipeSubRecipesTable.recipeId, recipeIds));

  const doughSubRecipeIds = [...new Set(
    subRecipeLinks
      .filter(l => l.subRecipeName?.toLowerCase().includes("dough"))
      .map(l => l.subRecipeId)
  )];

  if (doughSubRecipeIds.length === 0) {
    res.json({ ingredients: [], recipes: [], totalDoughKg: 0, mixerCapacityKg, mixCount: 0, nextPlan });
    return;
  }

  // ── 5. Fetch ingredients for all dough sub-recipes ──
  const doughIngredientRows = await db
    .select({
      subRecipeId: subRecipeIngredientsTable.subRecipeId,
      ingredientId: subRecipeIngredientsTable.ingredientId,
      quantity: subRecipeIngredientsTable.quantity,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
    })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(inArray(subRecipeIngredientsTable.subRecipeId, doughSubRecipeIds));

  // ── 6. Compute per-recipe dough info ──
  // The quantity on the recipe→sub-recipe link is kg of dough per PORTION (e.g. 0.115 = 115g).
  // Total dough per recipe batch = quantityPerPortion × portionsPerBatch.
  // The "dough ball" for a recipe batch = quantityPerPortion × portionsPerBatch in grams.
  interface RecipeDoughInfo {
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    ballCount: number;
    orderPosition: number;
    doughKgPerBatch: number;
    doughKgTotal: number;
    ballWeightG: number;
    doughSubRecipeName: string;
    subRecipeYieldKg: number;
    subRecipeId: number;
  }

  const recipeResults: RecipeDoughInfo[] = [];

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;

    const doughLink = subRecipeLinks.find(
      l => l.recipeId === planItem.recipeId && doughSubRecipeIds.includes(l.subRecipeId)
    );
    if (!doughLink) continue;

    const quantityPerPortion = Number(doughLink.quantityPerBatch) || 0;
    const subRecipeYieldKg = Number(doughLink.subRecipeYield) || 0;
    const doughKgPerBatch = quantityPerPortion * portionsPerBatch;
    const doughKgTotal = doughKgPerBatch * batchesTarget;
    const ballWeightG = Math.round(doughKgPerBatch * 1000);
    const ballCount = batchesTarget;

    recipeResults.push({
      recipeId: planItem.recipeId!,
      recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
      batchesTarget,
      portionsPerBatch,
      ballCount,
      orderPosition: planItem.orderPosition,
      doughKgPerBatch,
      doughKgTotal,
      ballWeightG,
      doughSubRecipeName: doughLink.subRecipeName ?? "Dough",
      subRecipeYieldKg,
      subRecipeId: doughLink.subRecipeId,
    });
  }

  const recipeDoughKg = recipeResults.reduce((sum, r) => sum + r.doughKgTotal, 0);
  const totalDoughKg = recipeDoughKg + extraBallsKg;

  // ── 7. Compute flour-based mixing ──
  // The mixer capacity setting is for FLOUR weight, not total dough.
  // We need to find the flour ingredient in the dough sub-recipe to compute the ratio.
  // For each dough sub-recipe, flour weight / total yield = flour ratio.
  // Then: total flour needed = totalDoughKg × flourRatio
  // And mixes = ceil(totalFlourKg / mixerCapacityKg)

  let totalFlourKg = 0;

  for (const srId of doughSubRecipeIds) {
    const srYield = Number(
      subRecipeLinks.find(l => l.subRecipeId === srId)?.subRecipeYield ?? 0
    );
    if (srYield <= 0) continue;

    const srFlour = doughIngredientRows.find(r =>
      r.subRecipeId === srId && r.ingredientName?.toLowerCase().includes("flour")
    );
    const flourPerBatch = srFlour ? (
      srFlour.unit === "g"
        ? (Number(srFlour.quantity) || 0) / 1000
        : Number(srFlour.quantity) || 0
    ) : 0;
    const srFlourRatio = srYield > 0 ? flourPerBatch / srYield : 0;

    const recipesUsingSr = recipeResults.filter(r => r.subRecipeId === srId);
    const totalDoughForSr = recipesUsingSr.reduce((sum, r) => sum + r.doughKgTotal, 0);
    totalFlourKg += totalDoughForSr * srFlourRatio;
  }

  // Scale flour for extra balls using the same flour/dough ratio
  if (recipeDoughKg > 0 && totalFlourKg > 0) {
    totalFlourKg += extraBallsKg * (totalFlourKg / recipeDoughKg);
  }

  const mixCount = mixerCapacityKg > 0 ? Math.ceil(totalFlourKg / mixerCapacityKg) : 0;
  const flourPerMix = mixCount > 0 ? totalFlourKg / mixCount : 0;
  const doughPerMix = mixCount > 0 ? totalDoughKg / mixCount : 0;

  // ── 8. Aggregate ingredients scaled to total dough needed ──
  const ingredientTotals = new Map<number, { ingredientId: number | null; ingredientName: string; unit: string; totalQty: number }>();

  for (const srId of doughSubRecipeIds) {
    const srYield = Number(
      subRecipeLinks.find(l => l.subRecipeId === srId)?.subRecipeYield ?? 0
    );
    if (srYield <= 0) continue;

    const recipesUsingSr = recipeResults.filter(r => r.subRecipeId === srId);
    const totalDoughForSr = recipesUsingSr.reduce((sum, r) => sum + r.doughKgTotal, 0);
    const scaleFactor = totalDoughForSr / srYield;

    const srIngredients = doughIngredientRows.filter(r => r.subRecipeId === srId);
    for (const ing of srIngredients) {
      const key = ing.ingredientId ?? -1;
      const qtyPerBatch = Number(ing.quantity) || 0;
      const contribution = qtyPerBatch * scaleFactor;
      const existing = ingredientTotals.get(key);
      if (existing) {
        existing.totalQty += contribution;
      } else {
        ingredientTotals.set(key, {
          ingredientId: ing.ingredientId,
          ingredientName: ing.ingredientName ?? `Ingredient #${ing.ingredientId}`,
          unit: ing.unit ?? "kg",
          totalQty: contribution,
        });
      }
    }
  }

  const ingredients = Array.from(ingredientTotals.values()).map(ing => {
    const totalKg = ing.unit === "g" ? ing.totalQty / 1000 : ing.totalQty;
    const pctRaw = totalDoughKg > 0 ? (totalKg / totalDoughKg) * 100 : 0;
    return {
      ...ing,
      pctOfDough: Math.round(pctRaw * 10) / 10,
      qtyPerMix: mixCount > 0 ? ing.totalQty / mixCount : 0,
    };
  });

  res.json({
    totalDoughKg: Math.round(totalDoughKg * 100) / 100,
    totalFlourKg: Math.round(totalFlourKg * 100) / 100,
    mixerCapacityKg,
    mixCount,
    flourPerMix: Math.round(flourPerMix * 100) / 100,
    doughPerMix: Math.round(doughPerMix * 100) / 100,
    kgPerMix: Math.round(doughPerMix * 100) / 100,
    ingredients,
    recipes: recipeResults,
    nextPlan,
    extraBalls: {
      extraPack: { count: extraPackBallCount, weightG: extraPackBallWeightG },
      snack: { count: snackBallCount, weightG: snackBallWeightG },
      totalKg: Math.round(extraBallsKg * 1000) / 1000,
    },
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /:id/packing — returns adjusted pack counts + dispatch cross-reference
// for today's production plan
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/packing", async (req, res) => {
  const planId = Number(req.params.id);

  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      batchesComplete: productionPlanItemsTable.batchesComplete,
      wonlyCount: productionPlanItemsTable.wonlyCount,
      wrappingComplete: productionPlanItemsTable.wrappingComplete,
      fridgeQty: productionPlanItemsTable.fridgeQty,
      status: productionPlanItemsTable.status,
      orderPosition: productionPlanItemsTable.orderPosition,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId))
    .orderBy(productionPlanItemsTable.orderPosition);

  // Dispatch orders for the plan date
  const dispatches = await db
    .select({
      id: dispatchOrdersTable.id,
      recipeId: dispatchOrdersTable.recipeId,
      recipeName: recipesTable.name,
      quantity: dispatchOrdersTable.quantity,
      customer: dispatchOrdersTable.customer,
      status: dispatchOrdersTable.status,
      notes: dispatchOrdersTable.notes,
    })
    .from(dispatchOrdersTable)
    .leftJoin(recipesTable, eq(dispatchOrdersTable.recipeId, recipesTable.id))
    .where(eq(dispatchOrdersTable.dispatchDate, plan.planDate));

  // Include all items in packing view; wrappingComplete=true items are "ready to pack"
  const packItems = items.map(item => {
    const batchesComplete = Number(item.batchesComplete) || 0;
    const portionsPerBatch = Number(item.portionsPerBatch) || 10;
    const wonlyCount = Number(item.wonlyCount) || 0;
    const grossPacks = Math.floor((batchesComplete * portionsPerBatch) / 2); // 2 portions per pack
    const netPacks = Math.max(0, grossPacks - wonlyCount);
    const itemDispatches = dispatches.filter(d => d.recipeId === item.recipeId);

    return {
      id: item.id,
      recipeId: item.recipeId,
      recipeName: item.recipeName ?? `Recipe #${item.recipeId}`,
      batchesTarget: Number(item.batchesTarget) || 0,
      batchesComplete,
      portionsPerBatch: Number(item.portionsPerBatch) || 10,
      fridgeQty: Number(item.fridgeQty) || 0,
      wonlyCount,
      grossPacks,
      netPacks,
      wrappingComplete: item.wrappingComplete ?? false,
      status: item.status,
      orderPosition: item.orderPosition,
      dispatches: itemDispatches.map(d => ({
        id: d.id,
        quantity: Number(d.quantity),
        customer: d.customer,
        status: d.status,
        notes: d.notes,
      })),
      totalDispatch: itemDispatches.reduce((sum, d) => sum + Number(d.quantity), 0),
    };
  });

  // Totals — count only wrapping-complete items towards packing totals
  const wrappedItems = packItems.filter(p => p.wrappingComplete);
  res.json({
    planId,
    planDate: plan.planDate,
    items: packItems,
    totalNetPacks: wrappedItems.reduce((sum, p) => sum + p.netPacks, 0),
    totalGrossPacks: wrappedItems.reduce((sum, p) => sum + p.grossPacks, 0),
    totalWonly: wrappedItems.reduce((sum, p) => sum + p.wonlyCount, 0),
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Main Prep — DIRECT recipe ingredients only (not sub-recipe components)
// Sub-recipe ingredients (dough, sauce, seasoning components) are prepped separately.
// Excludes raw_meat category and base/sauce items that belong to Bases & Mozzarella.
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/main-prep", async (req, res) => {
  const planId = Number(req.params.id);
  const station = (req.query.station as string) || "main_prep";

  const planItems = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      tinSize: productionPlanItemsTable.tinSize,
      maxBatchesPerTin: productionPlanItemsTable.maxBatchesPerTin,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  if (planItems.length === 0) {
    res.json({ ingredients: [], completions: [] });
    return;
  }

  const BASES_CATEGORIES = ["base", "sauce"];
  const MAIN_PREP_EXCLUDED = ["raw_meat", "base", "sauce", "dough"];

  const ingredientMap = new Map<number, {
    ingredientId: number;
    ingredientName: string;
    unit: string;
    category: string | null;
    stockCheckEnabled: boolean;
    stockCheckFrequency: string;
    stockCheckDay: string | null;
    totalQty: number;
    recipes: Array<{
      recipeId: number;
      recipeName: string;
      batchesTarget: number;
      qtyForRecipe: number;
      tinSize: string | null;
      maxBatchesPerTin: number | null;
      tinCount: number;
      qtyPerTin: number;
    }>;
  }>();

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const directIngredients = await db
      .select({
        ingredientId: recipeIngredientsTable.ingredientId,
        quantity: recipeIngredientsTable.quantity,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        category: ingredientsTable.category,
        processingRatio: ingredientsTable.processingRatio,
        stockCheckEnabled: ingredientsTable.stockCheckEnabled,
        stockCheckFrequency: ingredientsTable.stockCheckFrequency,
        stockCheckDay: ingredientsTable.stockCheckDay,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(and(
        eq(recipeIngredientsTable.recipeId, planItem.recipeId),
        // Exclude marinade rows — ingredients used purely as a marinade for another
        // ingredient should not appear as standalone items in Main Prep.
        isNull(recipeIngredientsTable.marinadeForIngredientId),
      ));

    const tinCount = planItem.maxBatchesPerTin && batchesTarget > 0
      ? Math.ceil(batchesTarget / planItem.maxBatchesPerTin)
      : 1;

    for (const row of directIngredients) {
      const cat = row.category ?? "";
      if (station === "prep_bases") {
        if (!BASES_CATEGORIES.includes(cat)) continue;
        const rowNameLc = (row.ingredientName ?? "").toLowerCase();
        if (rowNameLc.includes("mozzarella") || rowNameLc.includes("fior di latte")) continue;
      } else {
        if (MAIN_PREP_EXCLUDED.includes(cat)) continue;
        const rowNameLc = (row.ingredientName ?? "").toLowerCase();
        if (rowNameLc.includes("mozzarella") || rowNameLc.includes("fior di latte")) continue;
      }

      const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
      const qtyPerPortion = Number(row.quantity) || 0;
      const cookedQty = qtyPerPortion * portionsPerBatch * batchesTarget;
      const ratio = row.processingRatio ? Number(row.processingRatio) : null;
      const rawQty = ratio ? cookedQty / ratio : cookedQty;
      const unit = row.unit ?? "g";
      const roundedQty = roundByUnit(rawQty, unit);
      if (roundedQty <= 0) continue;
      const qtyPerTin = tinCount > 0 ? roundByUnit(roundedQty / tinCount, unit) : roundedQty;

      const existing = ingredientMap.get(row.ingredientId);
      if (existing) {
        existing.totalQty += roundedQty;
        existing.recipes.push({
          recipeId: planItem.recipeId!,
          recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
          batchesTarget,
          qtyForRecipe: roundedQty,
          tinSize: planItem.tinSize ?? null,
          maxBatchesPerTin: planItem.maxBatchesPerTin ?? null,
          tinCount,
          qtyPerTin,
        });
      } else {
        ingredientMap.set(row.ingredientId, {
          ingredientId: row.ingredientId,
          ingredientName: row.ingredientName ?? `Ingredient #${row.ingredientId}`,
          unit,
          category: row.category ?? null,
          stockCheckEnabled: row.stockCheckEnabled ?? false,
          stockCheckFrequency: row.stockCheckFrequency ?? "daily",
          stockCheckDay: row.stockCheckDay ?? null,
          totalQty: roundedQty,
          recipes: [{
            recipeId: planItem.recipeId!,
            recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
            batchesTarget,
            qtyForRecipe: roundedQty,
            tinSize: planItem.tinSize ?? null,
            maxBatchesPerTin: planItem.maxBatchesPerTin ?? null,
            tinCount,
            qtyPerTin,
          }],
        });
      }
    }
  }

  const ingredients = [...ingredientMap.values()]
    .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName))
    .map(ing => ({
      ...ing,
      totalTinCount: ing.recipes.reduce((s, r) => s + r.tinCount, 0),
    }));

  const completions = await db
    .select({
      id: prepCompletionsTable.id,
      ingredientId: prepCompletionsTable.ingredientId,
      recipeId: prepCompletionsTable.recipeId,
      tinNumber: prepCompletionsTable.tinNumber,
      userId: prepCompletionsTable.userId,
      userName: usersTable.name,
      completedAt: prepCompletionsTable.completedAt,
    })
    .from(prepCompletionsTable)
    .leftJoin(usersTable, eq(prepCompletionsTable.userId, usersTable.id))
    .where(eq(prepCompletionsTable.planId, planId));

  res.json({ ingredients, completions });
});

router.post("/:id/prep-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { ingredientId, recipeId, tinNumber } = req.body;
  if (!recipeId) { res.status(400).json({ error: "recipeId is required" }); return; }
  const userId = (req.session as any)?.userId ?? null;

  const [row] = await db.insert(prepCompletionsTable).values({
    planId,
    ingredientId,
    recipeId,
    tinNumber,
    userId,
  }).onConflictDoNothing().returning();

  if (!row) { res.status(409).json({ error: "Already completed" }); return; }

  const userName = userId
    ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)))?.[0]?.name ?? null
    : null;

  res.status(201).json({ ...row, userName });
});

router.delete("/:id/prep-completions/by-tin", async (req, res) => {
  const planId = Number(req.params.id);
  const { ingredientId, recipeId, tinNumber } = req.body;
  if (!recipeId) { res.status(400).json({ error: "recipeId is required" }); return; }
  await db.delete(prepCompletionsTable)
    .where(and(
      eq(prepCompletionsTable.planId, planId),
      eq(prepCompletionsTable.ingredientId, ingredientId),
      eq(prepCompletionsTable.recipeId, recipeId),
      eq(prepCompletionsTable.tinNumber, tinNumber),
    ));
  res.json({ ok: true });
});

// DELETE /:id/prep-completions/:completionId — undo by id (legacy)
router.delete("/:id/prep-completions/:completionId", async (req, res) => {
  const planId = Number(req.params.id);
  const completionId = Number(req.params.completionId);
  const deleted = await db.delete(prepCompletionsTable)
    .where(and(eq(prepCompletionsTable.id, completionId), eq(prepCompletionsTable.planId, planId)))
    .returning();
  if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// --- In-memory prep presence (ephemeral, no DB needed) ---
type PresenceEntry = { userId: number; userName: string; ingredientId: number; updatedAt: number };
const prepPresenceStore = new Map<string, PresenceEntry>(); // key = `${planId}-${userId}`

function cleanPresence() {
  const cutoff = Date.now() - 30_000;
  for (const [k, v] of prepPresenceStore) {
    if (v.updatedAt < cutoff) prepPresenceStore.delete(k);
  }
}

// POST /:id/prep-presence — heartbeat: user is viewing this ingredient
router.post("/:id/prep-presence", async (req, res) => {
  const planId = Number(req.params.id);
  const userId = (req.session as any)?.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { ingredientId } = req.body;
  cleanPresence();
  const userName = (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)))?.[0]?.name ?? "Someone";
  if (ingredientId == null) {
    prepPresenceStore.delete(`${planId}-${userId}`);
  } else {
    prepPresenceStore.set(`${planId}-${userId}`, { userId, userName, ingredientId, updatedAt: Date.now() });
  }
  res.json({ ok: true });
});

// GET /:id/prep-presence — returns { [ingredientId]: [{userId, userName}] }
router.get("/:id/prep-presence", async (req, res) => {
  const planId = Number(req.params.id);
  const currentUserId = (req.session as any)?.userId ?? null;
  cleanPresence();
  const result: Record<number, { userId: number; userName: string }[]> = {};
  for (const [key, entry] of prepPresenceStore) {
    if (!key.startsWith(`${planId}-`)) continue;
    if (entry.userId === currentUserId) continue; // exclude self
    if (!result[entry.ingredientId]) result[entry.ingredientId] = [];
    result[entry.ingredientId].push({ userId: entry.userId, userName: entry.userName });
  }
  res.json(result);
});

// ──────────────────────────────────────────────────────────────────────────────
// Mozzarella load — total mozzarella needed for the plan, rounded to 2kg bag size.
// Builders take mozzarella from the fridge in 2kg bags, so we report bag count.
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/mozzarella-load", async (req, res) => {
  const planId = Number(req.params.id);

  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  let totalQty = 0;
  let mozzarellaMeta: { id: number; name: string; unit: string } | null = null;

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;

    const directIngredients = await db
      .select({
        ingredientId: recipeIngredientsTable.ingredientId,
        quantity: recipeIngredientsTable.quantity,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(and(
        eq(recipeIngredientsTable.recipeId, planItem.recipeId),
        isNull(recipeIngredientsTable.marinadeForIngredientId),
      ));

    for (const row of directIngredients) {
      if (!(row.ingredientName ?? "").toLowerCase().includes("mozzarella")) continue;
      const qty = Number(row.quantity) || 0;
      totalQty += qty * portionsPerBatch * batchesTarget;
      if (!mozzarellaMeta && row.ingredientId) {
        mozzarellaMeta = {
          id: row.ingredientId,
          name: row.ingredientName ?? "Mozzarella",
          unit: row.unit ?? "g",
        };
      }
    }
  }

  if (totalQty === 0 || !mozzarellaMeta) {
    res.json(null);
    return;
  }

  // Bag size: 2kg. Convert to the same unit the ingredient is stored in.
  const unit = mozzarellaMeta.unit;
  const bagWeight = unit === "kg" ? 2 : 2000; // 2kg bag expressed in ingredient's unit
  const bags = Math.ceil(totalQty / bagWeight);

  res.json({
    ingredientId: mozzarellaMeta.id,
    name: mozzarellaMeta.name,
    unit,
    totalQty,
    bagWeight,
    bags,
  });
});

export default router;
