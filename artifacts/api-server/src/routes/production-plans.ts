import { Router, type IRouter } from "express";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, batchCompletionsTable, stationBreaksTable, recipeIngredientsTable, ingredientsTable, recipeSubRecipesTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, dispatchOrdersTable, appSettingsTable, prepCompletionsTable, dailyStockChecksTable, usersTable, recipeMeatMarinadesTable, stockEntriesTable, dptSettingsTable, purchaseOrdersTable, purchaseOrderLinesTable, suppliersTable } from "@workspace/db";
import { eq, and, desc, sql, gt, gte, lte, asc, inArray, notInArray, sum as drizzleSum, ne, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { validate } from "../middleware/validate";
import * as z from "zod";
import { resolveRecipeIngredients, aggregateIngredients, roundByUnit, type ResolvedIngredient } from "../lib/ingredient-resolver";
import { countProductsByTag, adjustInventoryLevel } from "../services/shopify";

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

async function syncRecipeFreezerStock(recipeId: number, deltaQty: number) {
  const existing = await db
    .select({ id: stockEntriesTable.id, quantity: stockEntriesTable.quantity })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.recipeId, recipeId),
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_freezer"),
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
      location: "production_freezer",
      notes: "Auto-created from wrapping station (wonky packs)",
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

async function isAdminUser(req: import("express").Request): Promise<boolean> {
  let role = req.session.userRole;
  if (!role && req.session.userId) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      role = user.role as "admin" | "manager" | "viewer";
      req.session.userRole = role;
    }
  }
  return role === "admin";
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

function mapItem(i: typeof productionPlanItemsTable.$inferSelect & { recipeName?: string | null; portionsPerBatch?: number | null; packSize?: number | null; fillWeightGrams?: string | null; baseType?: string | null; baseWeightGrams?: string | null; wrappingComplete?: boolean | null; recipeColor?: string | null }, stationCompletions?: Record<string, number>) {
  return {
    ...i,
    recipeName: i.recipeName ?? "",
    portionsPerBatch: i.portionsPerBatch ?? 10,
    packSize: i.packSize ?? 2,
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
  // Enforce 2 working-day minimum lead time (admins exempt)
  if (!isAtLeast2WorkingDaysAhead(planDate)) {
    let role = req.session.userRole;
    if (!role && req.session.userId) {
      const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
      if (user) { role = user.role as "admin" | "manager" | "viewer"; req.session.userRole = role; }
    }
    if (role !== "admin") {
      res.status(400).json({ error: "Production plans must be scheduled at least 2 working days in advance." });
      return;
    }
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

  if (!isAtLeast2WorkingDaysAhead(planDate)) {
    let role = req.session.userRole;
    if (!role && req.session.userId) {
      const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
      if (user) { role = user.role as "admin" | "manager" | "viewer"; req.session.userRole = role; }
    }
    if (role !== "admin") {
      res.status(400).json({ error: "Production plans must be scheduled at least 2 working days in advance." });
      return;
    }
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

  function getNextCalendarDay(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // Dispatch happens Mon–Fri; delivery is always dispatch + 1 calendar day (APC overnight).
  // dispatch1 = yesterday's dispatch (reduces fridge stock)
  // dispatch2 = today's dispatch (main production target)
  // dispatch3 = tomorrow's dispatch
  const dispatchDates = [
    getPreviousWorkingDay(planDate),
    planDate,
    getNextWorkingDay(planDate),
  ];

  // Shopify order tags are DELIVERY dates = dispatch date + 1 calendar day.
  // e.g. Thursday dispatch → Friday delivery → Shopify tag "2026-03-27"
  // e.g. Friday dispatch   → Saturday delivery → Shopify tag "2026-03-28"
  const deliveryDates = dispatchDates.map(getNextCalendarDay);

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
    dispatchDates,
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
      packSize: recipesTable.packSize,
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
      shortCount: productionPlanItemsTable.shortCount,
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
      const admin = await isAdminUser(req);
      if (!admin) {
        res.status(400).json({ error: "Production plans must be scheduled at least 2 working days in advance." });
        return;
      }
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
  const [planItem] = await db.select({ id: productionPlanItemsTable.id, batchesComplete: productionPlanItemsTable.batchesComplete })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  const bulkUndoConditions = [eq(batchCompletionsTable.planItemId, Number(planItemId))];
  if (stationType) bulkUndoConditions.push(eq(batchCompletionsTable.stationType, stationType));

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
  // Verify planItemId belongs to this plan
  const [planItem] = await db.select({ id: productionPlanItemsTable.id, batchesComplete: productionPlanItemsTable.batchesComplete })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }
  const conditions = [eq(batchCompletionsTable.planItemId, Number(planItemId))];
  if (stationType) conditions.push(eq(batchCompletionsTable.stationType, stationType));

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
    prepWeightMode: "raw" | "processed";
    rawMeatTrayCapacityKg: number | null;
    totalCookedQty: number;
    totalRawQty: number;
    prepQty: number;
    trayCount: number | null;
    recipes: string[];
  }> = {};

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch, { skipToppings: true });
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
          prepWeightMode: ing.prepWeightMode,
          rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg,
          totalCookedQty: 0,
          totalRawQty: 0,
          prepQty: 0,
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
    item.prepQty = item.prepWeightMode === "processed" ? item.totalCookedQty : item.totalRawQty;
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
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch, { skipToppings: true });
    const agg = aggregateIngredients(resolved);

    const ingredients: Array<{
      ingredientId: number;
      ingredientName: string;
      unit: string;
      category: string | null;
      processingRatio: number | null;
      prepWeightMode: "raw" | "processed";
      rawMeatTrayCapacityKg: number | null;
      minCookingTempC: number | null;
      estimatedCookTimeMin: number | null;
      ovenTempC: number | null;
      steamPct: number | null;
      cookedQty: number;
      rawQty: number;
      prepQty: number;
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

    // Build a map of filling-mix-only quantity per ingredient (from direct recipe rows).
    // This is used to show only the filling quantity for mozzarella/fior di latte.
    const fillingMixQtyPerBatch = new Map<number, number>();
    for (const r of resolved) {
      if (r.includeInFillingMix) {
        fillingMixQtyPerBatch.set(
          r.ingredientId,
          (fillingMixQtyPerBatch.get(r.ingredientId) ?? 0) + r.quantityPerBatch,
        );
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
      // unless the ingredient is flagged as part of the filling mix for this recipe.
      const ingNameLc = (ing.ingredientName ?? "").toLowerCase();
      const isMozzType = ingNameLc.includes("mozzarella") || ingNameLc.includes("fior di latte");
      if (isMozzType && !ing.includeInFillingMix) continue;

      hasRelevantIngredients = true;
      // At non-prep_meat stations use only the non-marinade portion of the quantity.
      // At prep_meat the ingredient won't appear as a direct row anyway (category filter
      // ensures only raw_meat shows there), so this path is safe either way.
      // For mozzarella/fior di latte flagged as filling mix, use only the filling-mix quantity
      // (not the full aggregated total, which may include non-filling usage).
      let effectiveQtyPerBatch: number;
      if (isMozzType && ing.includeInFillingMix) {
        effectiveQtyPerBatch = fillingMixQtyPerBatch.get(ing.ingredientId) ?? 0;
      } else {
        effectiveQtyPerBatch = station === "prep_meat" ? ing.quantityPerBatch : nonMarinadePerBatch;
      }
      const cookedQty = effectiveQtyPerBatch * batchesTarget;
      const rawQty = ing.processingRatio ? cookedQty / ing.processingRatio : cookedQty;

      const roundedCooked = roundByUnit(cookedQty, ing.unit);
      const roundedRaw = roundByUnit(rawQty, ing.unit);
      ingredients.push({
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName,
        unit: ing.unit,
        category,
        processingRatio: ing.processingRatio,
        prepWeightMode: ing.prepWeightMode,
        rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg,
        minCookingTempC: ing.minCookingTempC,
        estimatedCookTimeMin: ing.estimatedCookTimeMin,
        ovenTempC: ing.ovenTempC,
        steamPct: ing.steamPct,
        cookedQty: roundedCooked,
        rawQty: roundedRaw,
        prepQty: ing.prepWeightMode === "processed" ? roundedCooked : roundedRaw,
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
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  const subRecipeTotals = new Map<number, number>();

  for (const item of planItems) {
    if (!item.recipeId) continue;
    const batches = Number(item.batchesTarget) || 0;
    if (batches === 0) continue;
    const portionsPerBatch = Number(item.portionsPerBatch) || 10;

    const srRows = await db
      .select({
        subRecipeId: recipeSubRecipesTable.subRecipeId,
        quantity: recipeSubRecipesTable.quantity,
      })
      .from(recipeSubRecipesTable)
      .where(eq(recipeSubRecipesTable.recipeId, item.recipeId));

    for (const sr of srRows) {
      if (sr.subRecipeId == null) continue;
      const qty = Number(sr.quantity) * portionsPerBatch * batches;
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
           ri.marinade_for_ingredient_id as "marinadeForIngredientId",
           ri.mixing_overage as "mixingOverage"
    FROM recipe_ingredients ri
    LEFT JOIN ingredients i ON ri.ingredient_id = i.id
    WHERE ri.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
      AND ri.include_in_filling_mix = true
  `);

  const fillingSubRecipeRows = await db.execute(sql`
    SELECT rs.recipe_id as "recipeId", rs.sub_recipe_id as "subRecipeId",
           s.name as "subRecipeName", s.yield_unit as unit, rs.quantity,
           rs.marinade_for_ingredient_id as "marinadeForIngredientId",
           rs.mixing_overage as "mixingOverage"
    FROM recipe_sub_recipes rs
    LEFT JOIN sub_recipes s ON rs.sub_recipe_id = s.id
    WHERE rs.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
      AND rs.include_in_filling_mix = true
  `);

  const fiRows = fillingIngredients.rows as Array<{ recipeId: number; ingredientId: number; ingredientName: string; unit: string; quantity: string; marinadeForIngredientId: number | null; mixingOverage: string | null }>;
  const fsRows = fillingSubRecipeRows.rows as Array<{ recipeId: number; subRecipeId: number; subRecipeName: string; unit: string; quantity: string; marinadeForIngredientId: number | null; mixingOverage: string | null }>;

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
        const overage = Number(fi.mixingOverage ?? 0);
        // Overage is a fixed total amount spread across all tins (not per batch)
        const overagePerTin = tinsTarget > 0 ? overage / tinsTarget : overage;
        return {
          ingredientId: fi.ingredientId,
          name: fi.ingredientName,
          unit: fi.unit,
          qtyPerBatch: totalQtyPerPortion * ppb,
          qtyPerTin: totalQtyPerPortion * ppb * batchesPerTin + overagePerTin,
          mixingOverage: overage,
        };
      });

    const subRecipes = recipeSubRows
      .filter(fs => !marinadeSubIds.has(fs.subRecipeId))
      .map(fs => {
        const overage = Number(fs.mixingOverage ?? 0);
        // Overage is a fixed total amount spread across all tins (not per batch)
        const overagePerTin = tinsTarget > 0 ? overage / tinsTarget : overage;
        return {
          subRecipeId: fs.subRecipeId,
          name: fs.subRecipeName,
          unit: fs.unit,
          qtyPerBatch: Number(fs.quantity) * ppb,
          qtyPerTin: Number(fs.quantity) * ppb * batchesPerTin + overagePerTin,
          mixingOverage: overage,
        };
      });

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
    `);

    const nonFillingIngRows = await db.execute(sql`
      SELECT ri.recipe_id as "recipeId", ri.ingredient_id as "ingredientId",
             i.name as "ingredientName", i.unit, ri.quantity,
             ri.assembly_order as "assemblyOrder"
      FROM recipe_ingredients ri
      LEFT JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id IN (${sql.join(recipeIds.map(id => sql`${id}`), sql`, `)})
        AND ri.include_in_filling_mix = false
        AND ri.marinade_for_ingredient_id IS NULL
    `);

    const nonFillingSubRows = await db.execute(sql`
      SELECT rs.recipe_id as "recipeId", rs.sub_recipe_id as "subRecipeId",
             s.name as "subRecipeName", s.yield_unit as unit, rs.quantity,
             s.is_base as "isBase",
             rs.assembly_order as "assemblyOrder"
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
    const nfiRows = nonFillingIngRows.rows as Array<{ recipeId: number; ingredientId: number; ingredientName: string; unit: string; quantity: string; assemblyOrder: number | null }>;
    const nfsRows = nonFillingSubRows.rows as Array<{ recipeId: number; subRecipeId: number; subRecipeName: string; unit: string; quantity: string; isBase: boolean; assemblyOrder: number | null }>;

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

      type AssemblyEntry = { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number; sourceType: "ingredient" | "sub_recipe"; sourceId: number; assemblyOrder: number | null };
      const assemblyItems: AssemblyEntry[] = [];
      const postOvenItems: AssemblyEntry[] = [];

      const isPostOven = (name: string) => /garlic[\s\-]*butter/i.test(name);

      for (const row of nfiRows.filter(r => r.recipeId === item.recipeId)) {
        const wt = toGrams(Number(row.quantity), row.unit) * ppb;
        const entry: AssemblyEntry = { name: row.ingredientName, unit: "g", weightPerBatch: wt, weightHalfBatch: wt / 2, sourceType: "ingredient", sourceId: row.ingredientId, assemblyOrder: row.assemblyOrder };
        if (isPostOven(row.ingredientName)) {
          postOvenItems.push(entry);
        } else {
          assemblyItems.push(entry);
        }
      }

      for (const row of nfsRows.filter(r => r.recipeId === item.recipeId)) {
        if (row.isBase) continue;
        const wt = toGrams(Number(row.quantity), row.unit) * ppb;
        const entry: AssemblyEntry = { name: row.subRecipeName, unit: "g", weightPerBatch: wt, weightHalfBatch: wt / 2, sourceType: "sub_recipe", sourceId: row.subRecipeId, assemblyOrder: row.assemblyOrder };
        if (isPostOven(row.subRecipeName)) {
          postOvenItems.push(entry);
        } else {
          assemblyItems.push(entry);
        }
      }

      const sortByOrder = (a: AssemblyEntry, b: AssemblyEntry) => {
        if (a.assemblyOrder != null && b.assemblyOrder != null) return a.assemblyOrder - b.assemblyOrder;
        if (a.assemblyOrder != null) return -1;
        if (b.assemblyOrder != null) return 1;
        return a.name.localeCompare(b.name);
      };
      assemblyItems.sort(sortByOrder);
      postOvenItems.sort(sortByOrder);

      return {
        itemId: item.id,
        recipeId: item.recipeId,
        recipeName: item.recipeName,
        fillingWeightPerBatch,
        fillingWeightHalfBatch,
        assemblyItems,
        postOvenItems,
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
    prepWeightMode: "raw" | "processed";
    rawMeatTrayCapacityKg: number | null;
    totalCookedQty: number;
    totalRawQty: number;
    prepQty: number;
    trayCount: number | null;
    recipes: Array<{ recipeId: number; recipeName: string; batchesTarget: number; cookedQty: number; rawQty: number }>;
  }> = {};

  let totalBatches = 0;

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;
    totalBatches += batchesTarget;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch, { skipToppings: true });
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
          prepWeightMode: ing.prepWeightMode,
          rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg,
          totalCookedQty: 0,
          totalRawQty: 0,
          prepQty: 0,
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
    item.prepQty = item.prepWeightMode === "processed" ? item.totalCookedQty : item.totalRawQty;
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
// POST /:id/wonky-to-freezer — transfer all wonky packs to production_freezer
//   • For each plan item with wonlyCount > 0:
//       – calls syncRecipeFreezerStock to upsert the stock_entries row
//       – increments freezerQty on the plan item
//       – zeroes wonlyCount so wrapping-complete auto-freeze doesn't double-count
//   • Returns { transferred: [{ itemId, recipeId, recipeName, qty }], totalQty }
// ──────────────────────────────────────────────────────────────────────────────
const WonkyToFreezerParams = z.object({ id: z.coerce.number().int().positive() });

router.post("/:id/wonky-to-freezer", async (req, res) => {
  const parseResult = WonkyToFreezerParams.safeParse({ id: req.params.id });
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid plan id" });
    return;
  }
  const planId = parseResult.data.id;
  try {
    const items = await db
      .select({
        id: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
        wonlyCount: productionPlanItemsTable.wonlyCount,
        recipeName: recipesTable.name,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(and(
        eq(productionPlanItemsTable.planId, planId),
        sql`${productionPlanItemsTable.wonlyCount} > 0`,
      ));

    const transferred: Array<{ itemId: number; recipeId: number | null; recipeName: string | null; qty: number }> = [];

    for (const item of items) {
      const qty = Number(item.wonlyCount) || 0;
      if (qty <= 0) continue;
      if (item.recipeId) {
        await syncRecipeFreezerStock(item.recipeId, qty);
      }
      await db.update(productionPlanItemsTable)
        .set({
          freezerQty: sql`${productionPlanItemsTable.freezerQty} + ${qty}`,
          wonlyCount: 0,
        })
        .where(eq(productionPlanItemsTable.id, item.id));
      transferred.push({ itemId: item.id, recipeId: item.recipeId, recipeName: item.recipeName ?? null, qty });
    }

    res.json({
      transferred,
      totalQty: transferred.reduce((s, t) => s + t.qty, 0),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
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

router.post("/:id/items/:itemId/short", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [exists] = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!exists) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ shortCount: sql`${productionPlanItemsTable.shortCount} + 1` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ shortCount: productionPlanItemsTable.shortCount });

  res.json({ itemId, shortCount: updated.shortCount });
});

router.delete("/:id/items/:itemId/short", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [item] = await db.select({ id: productionPlanItemsTable.id, shortCount: productionPlanItemsTable.shortCount })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }
  if ((item.shortCount ?? 0) <= 0) {
    res.status(409).json({ error: "Short count is already 0" });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ shortCount: sql`GREATEST(${productionPlanItemsTable.shortCount} - 1, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ shortCount: productionPlanItemsTable.shortCount });

  res.json({ itemId, shortCount: updated.shortCount });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /:id/items/:itemId/wrapping-complete — toggle wrapping done for a plan item.
// When completing (complete=true):
//   • Reads freezerQty from the item BEFORE any updates (used as Shopify delta base).
//   • Auto-freezes wonky (reject) packs to production_freezer stock; also zeroes
//     wonlyCount and updates freezerQty so /wonky-to-freezer cannot double-count.
//   • If a Shopify mapping exists, always adjusts Shopify inventory by
//     (pre-update freezerQty + wonkyFrozen) — computed server-side, no client value.
// Body: { complete: boolean }
// ──────────────────────────────────────────────────────────────────────────────
router.patch("/:id/items/:itemId/wrapping-complete", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const complete = req.body.complete;

  if (typeof complete !== "boolean") {
    res.status(400).json({ error: "Body must contain { complete: boolean }" });
    return;
  }

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
    wonlyCount: productionPlanItemsTable.wonlyCount,
    // Read freezerQty BEFORE any updates so we can compute the Shopify delta.
    freezerQty: productionPlanItemsTable.freezerQty,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ wrappingComplete: complete })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ id: productionPlanItemsTable.id, wrappingComplete: productionPlanItemsTable.wrappingComplete });

  let wonkyFrozen = 0;
  let shopifyProductTitle: string | null = null;
  let shopifyVariantTitle: string | null = null;
  let shopifyNewQty: number | null = null;
  let shopifyError: string | null = null;

  if (complete && item.recipeId) {
    // Auto-freeze wonky packs into production_freezer stock.
    // Also zeroes wonlyCount and updates freezerQty so the Wonky Rack card
    // cannot double-transfer the same packs via /wonky-to-freezer.
    const wonlys = Number(item.wonlyCount) || 0;
    if (wonlys > 0) {
      await syncRecipeFreezerStock(item.recipeId, wonlys);
      wonkyFrozen = wonlys;
      await db.update(productionPlanItemsTable)
        .set({
          wonlyCount: 0,
          freezerQty: sql`${productionPlanItemsTable.freezerQty} + ${wonlys}`,
        })
        .where(eq(productionPlanItemsTable.id, itemId));
    }

    // Shopify inventory sync — delta computed server-side as:
    //   (packs already committed to Product Freezer) + (wonky packs just frozen)
    // This avoids relying on any client-supplied value.
    const shopifyDelta = Number(item.freezerQty) + wonkyFrozen;
    if (shopifyDelta > 0) {
      const mappingRows = await db.execute(sql`
        SELECT shopify_variant_id, shopify_product_title, shopify_variant_title
        FROM recipe_shopify_mappings WHERE recipe_id = ${item.recipeId}
      `);
      if (mappingRows.rows.length > 0) {
        const mapping = mappingRows.rows[0] as {
          shopify_variant_id: string;
          shopify_product_title: string | null;
          shopify_variant_title: string | null;
        };
        shopifyProductTitle = mapping.shopify_product_title;
        shopifyVariantTitle = mapping.shopify_variant_title;
        try {
          const adj = await adjustInventoryLevel(mapping.shopify_variant_id, shopifyDelta);
          shopifyNewQty = adj.newQuantity;
        } catch (err: unknown) {
          shopifyError = err instanceof Error ? err.message : String(err);
          console.error(`[Wrapping] Shopify inventory adjust failed for recipe ${item.recipeId}:`, shopifyError);
        }
      }
    }
  }

  res.json({
    itemId: updated.id,
    wrappingComplete: updated.wrappingComplete,
    wonkyFrozen,
    shopifyProductTitle,
    shopifyVariantTitle,
    shopifyNewQty,
    shopifyError,
  });
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

    if (!nextPlan) {
      res.json({ ingredients: [], recipes: [], totalDoughKg: 0, mixerCapacityKg: 25, mixCount: 0, nextPlan: null, noFuturePlan: true });
      return;
    }
    targetPlanId = nextPlan.id;
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

  // ── 9. Fetch next plan's items with dough_prep station completions ──
  // The frontend needs these to track dough ball completions against the correct plan
  let nextPlanItems: Array<{ id: number; recipeId: number | null; batchesTarget: number; orderPosition: number; recipeName: string; stationCompletions: Record<string, number> }> = [];
  if (targetPlanId !== planId) {
    const nextItems = await db
      .select({
        id: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        orderPosition: productionPlanItemsTable.orderPosition,
        recipeName: recipesTable.name,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(eq(productionPlanItemsTable.planId, targetPlanId))
      .orderBy(productionPlanItemsTable.orderPosition);

    const nextItemIds = nextItems.map(it => it.id);
    let completionsByItem: Record<number, Record<string, number>> = {};
    if (nextItemIds.length > 0) {
      const completionRows = await db.execute(sql`
        SELECT plan_item_id, station_type, COUNT(*)::int as cnt
        FROM batch_completions
        WHERE plan_item_id IN (${sql.join(nextItemIds.map(id => sql`${id}`), sql`, `)})
          AND station_type = 'dough_prep'
        GROUP BY plan_item_id, station_type
      `);
      for (const row of completionRows.rows as Array<{ plan_item_id: number; station_type: string; cnt: number }>) {
        if (!completionsByItem[row.plan_item_id]) completionsByItem[row.plan_item_id] = {};
        completionsByItem[row.plan_item_id][row.station_type] = row.cnt;
      }
    }

    nextPlanItems = nextItems.map(it => ({
      id: it.id,
      recipeId: it.recipeId,
      batchesTarget: it.batchesTarget ?? 0,
      orderPosition: it.orderPosition,
      recipeName: it.recipeName ?? `Recipe #${it.recipeId}`,
      stationCompletions: completionsByItem[it.id] ?? {},
    }));
  }

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
    nextPlanItems,
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
    isBottle: boolean;
    bottleSize: number | null;
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

  const subRecipeMap = new Map<string, {
    subRecipeId: number;
    ingredientName: string;
    unit: string;
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
        includeInFillingMix: recipeIngredientsTable.includeInFillingMix,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        category: ingredientsTable.category,
        processingRatio: ingredientsTable.processingRatio,
        prepWeightMode: ingredientsTable.prepWeightMode,
        stockCheckEnabled: ingredientsTable.stockCheckEnabled,
        stockCheckFrequency: ingredientsTable.stockCheckFrequency,
        stockCheckDay: ingredientsTable.stockCheckDay,
        isBottle: ingredientsTable.isBottle,
        bottleSize: ingredientsTable.bottleSize,
        packWeight: ingredientsTable.packWeight,
        isTopping: recipeIngredientsTable.isTopping,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(and(
        eq(recipeIngredientsTable.recipeId, planItem.recipeId),
        isNull(recipeIngredientsTable.marinadeForIngredientId),
      ));

    const tinCount = planItem.maxBatchesPerTin && batchesTarget > 0
      ? Math.ceil(batchesTarget / planItem.maxBatchesPerTin)
      : 1;

    for (const row of directIngredients) {
      if (row.isTopping) continue;
      const cat = row.category ?? "";
      const rowNameLc = (row.ingredientName ?? "").toLowerCase();
      const isMozzType = rowNameLc.includes("mozzarella") || rowNameLc.includes("fior di latte");
      if (station === "prep_bases") {
        if (!BASES_CATEGORIES.includes(cat)) continue;
        // Mozzarella/fior di latte belongs to filling mix prep, not bases — always exclude here
        if (isMozzType) continue;
      } else if (station === "prep_meat") {
        if (cat !== "raw_meat") continue;
      } else {
        if (MAIN_PREP_EXCLUDED.includes(cat)) continue;
        // Mozzarella/fior di latte goes directly to building fridges — exclude from main prep
        // UNLESS this recipe row is flagged as include_in_filling_mix, in which case it
        // needs to be portioned as part of the filling and must appear here.
        if (isMozzType && !row.includeInFillingMix) continue;
      }

      const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
      const qtyPerPortion = Number(row.quantity) || 0;
      const cookedQty = qtyPerPortion * portionsPerBatch * batchesTarget;
      const ratio = row.processingRatio ? Number(row.processingRatio) : null;
      const rawQty = ratio ? cookedQty / ratio : cookedQty;
      const unit = row.unit ?? "g";
      const mode = row.prepWeightMode ?? "raw";
      const effectiveQty = mode === "processed" ? cookedQty : rawQty;
      const roundedQty = roundByUnit(effectiveQty, unit);
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
        const isBottle = row.isBottle ?? false;
        const bottleSizeVal = row.bottleSize ? Number(row.bottleSize) : (row.packWeight ? Number(row.packWeight) : null);
        ingredientMap.set(row.ingredientId, {
          ingredientId: row.ingredientId,
          ingredientName: row.ingredientName ?? `Ingredient #${row.ingredientId}`,
          unit,
          category: row.category ?? null,
          stockCheckEnabled: row.stockCheckEnabled ?? false,
          stockCheckFrequency: row.stockCheckFrequency ?? "daily",
          stockCheckDay: row.stockCheckDay ?? null,
          isBottle,
          bottleSize: isBottle ? bottleSizeVal : null,
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

    if (station === "main_prep") {
      const subRecipeRows = await db
        .select({
          subRecipeId: recipeSubRecipesTable.subRecipeId,
          quantity: recipeSubRecipesTable.quantity,
          includeInFillingMix: recipeSubRecipesTable.includeInFillingMix,
          marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
          subRecipeName: subRecipesTable.name,
          yieldUnit: subRecipesTable.yieldUnit,
          isBase: subRecipesTable.isBase,
          isTopping: recipeSubRecipesTable.isTopping,
        })
        .from(recipeSubRecipesTable)
        .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
        .where(eq(recipeSubRecipesTable.recipeId, planItem.recipeId));

      for (const sr of subRecipeRows) {
        if (sr.subRecipeId == null) continue;
        if (sr.isBase) continue;
        if (sr.isTopping) continue;
        const nameLc = (sr.subRecipeName ?? "").toLowerCase();
        if (nameLc.includes("dough")) continue;
        if (sr.marinadeForIngredientId != null) continue;
        if (sr.includeInFillingMix) continue;

        const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
        const qtyPerPortion = Number(sr.quantity) || 0;
        const totalQty = qtyPerPortion * portionsPerBatch * batchesTarget;
        const unit = sr.yieldUnit ?? "kg";
        const roundedQty = roundByUnit(totalQty, unit);
        if (roundedQty <= 0) continue;
        const qtyPerTin = tinCount > 0 ? roundByUnit(roundedQty / tinCount, unit) : roundedQty;

        const mapKey = `sr_${sr.subRecipeId}`;
        const existing = subRecipeMap.get(mapKey);
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
          subRecipeMap.set(mapKey, {
            subRecipeId: sr.subRecipeId,
            ingredientName: sr.subRecipeName ?? `Sub-recipe #${sr.subRecipeId}`,
            unit,
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
  }

  const subRecipeIngredients = [...subRecipeMap.values()].map(sr => ({
    ingredientId: sr.subRecipeId,
    ingredientName: sr.ingredientName,
    unit: sr.unit,
    category: "sub_recipe" as string | null,
    stockCheckEnabled: false,
    stockCheckFrequency: "daily",
    stockCheckDay: null as string | null,
    totalQty: sr.totalQty,
    isSubRecipe: true,
    recipes: sr.recipes,
    totalTinCount: sr.recipes.reduce((s, r) => s + r.tinCount, 0),
  }));

  const FIXED_TWO_TIN_IDS = new Set([18, 19]);
  for (const [ingId, ing] of ingredientMap) {
    if (!FIXED_TWO_TIN_IDS.has(ingId)) continue;
    if (ing.recipes.length <= 1 && ing.recipes[0]?.tinCount === 2) continue;
    const combinedQty = ing.totalQty;
    const qtyPerTin = roundByUnit(combinedQty / 2, ing.unit);
    const allRecipeNames = ing.recipes.map(r => r.recipeName);
    const combinedName = allRecipeNames.length > 1
      ? allRecipeNames.slice(0, -1).join(", ") + " & " + allRecipeNames[allRecipeNames.length - 1]
      : allRecipeNames[0] ?? "Combined";
    const totalBatches = ing.recipes.reduce((s, r) => s + r.batchesTarget, 0);
    ing.recipes = [{
      recipeId: ing.recipes[0]?.recipeId ?? 0,
      recipeName: combinedName,
      batchesTarget: totalBatches,
      qtyForRecipe: combinedQty,
      tinSize: null,
      maxBatchesPerTin: null,
      tinCount: 2,
      qtyPerTin,
    }];
  }

  const ingredients = [...ingredientMap.values()]
    .map(ing => {
      if (ing.isBottle && ing.bottleSize && ing.bottleSize > 0) {
        const totalGrams = ing.totalQty;
        const bottlesNeeded = Math.ceil(totalGrams / ing.bottleSize);
        const allRecipeNames = ing.recipes.map(r => r.recipeName);
        const combinedName = allRecipeNames.length > 1
          ? allRecipeNames.slice(0, -1).join(", ") + " & " + allRecipeNames[allRecipeNames.length - 1]
          : allRecipeNames[0] ?? "Combined";
        const totalBatches = ing.recipes.reduce((s, r) => s + r.batchesTarget, 0);
        return {
          ...ing,
          isSubRecipe: false,
          totalTinCount: 1,
          bottlesNeeded,
          recipes: [{
            recipeId: ing.recipes[0]?.recipeId ?? 0,
            recipeName: combinedName,
            batchesTarget: totalBatches,
            qtyForRecipe: totalGrams,
            tinSize: null,
            maxBatchesPerTin: null,
            tinCount: 1,
            qtyPerTin: totalGrams,
          }],
        };
      }
      return {
        ...ing,
        isSubRecipe: false,
        bottlesNeeded: null as number | null,
        totalTinCount: ing.recipes.reduce((s, r) => s + r.tinCount, 0),
      };
    });

  const allItems = [...ingredients, ...subRecipeIngredients]
    .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));

  const completionRows = await db.execute(sql`
    SELECT id, ingredient_id AS "ingredientId", sub_recipe_id AS "subRecipeId",
           recipe_id AS "recipeId", tin_number AS "tinNumber",
           user_id AS "userId", completed_at AS "completedAt"
    FROM prep_completions
    WHERE plan_id = ${planId}
  `);
  const rawCompletions = (completionRows.rows as Array<{
    id: number;
    ingredientId: number | null;
    subRecipeId: number | null;
    recipeId: number;
    tinNumber: number;
    userId: number | null;
    completedAt: string;
  }>).map(c => ({
    ...c,
    isSubRecipe: c.subRecipeId != null,
    ingredientId: c.ingredientId ?? c.subRecipeId ?? 0,
  }));

  const validItemKeys = new Set(
    allItems.map(item => `${item.ingredientId}_${!!item.isSubRecipe}`)
  );
  const completions = rawCompletions.filter(c =>
    validItemKeys.has(`${c.ingredientId}_${c.isSubRecipe}`)
  );

  res.json({ ingredients: allItems, completions });
});

router.post("/:id/prep-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { ingredientId, recipeId, tinNumber, isSubRecipe } = req.body;
  if (!recipeId) { res.status(400).json({ error: "recipeId is required" }); return; }
  const userId = (req.session as any)?.userId ?? null;

  if (isSubRecipe) {
    const result = await db.execute(sql`
      INSERT INTO prep_completions (plan_id, sub_recipe_id, recipe_id, tin_number, user_id, completed_at)
      VALUES (${planId}, ${ingredientId}, ${recipeId}, ${tinNumber}, ${userId}, NOW())
      ON CONFLICT DO NOTHING
      RETURNING id, sub_recipe_id AS "ingredientId", recipe_id AS "recipeId",
                tin_number AS "tinNumber", user_id AS "userId", completed_at AS "completedAt"
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) { res.status(409).json({ error: "Already completed" }); return; }
    const userName = userId
      ? (await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)))?.[0]?.name ?? null
      : null;
    res.status(201).json({ ...row, isSubRecipe: true, userName });
  } else {
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

    res.status(201).json({ ...row, isSubRecipe: false, userName });
  }
});

router.delete("/:id/prep-completions/by-tin", async (req, res) => {
  const planId = Number(req.params.id);
  const { ingredientId, recipeId, tinNumber, isSubRecipe } = req.body;
  if (!recipeId) { res.status(400).json({ error: "recipeId is required" }); return; }
  if (isSubRecipe) {
    await db.execute(sql`
      DELETE FROM prep_completions
      WHERE plan_id = ${planId}
        AND sub_recipe_id = ${ingredientId}
        AND recipe_id = ${recipeId}
        AND tin_number = ${tinNumber}
    `);
  } else {
    await db.delete(prepCompletionsTable)
      .where(and(
        eq(prepCompletionsTable.planId, planId),
        eq(prepCompletionsTable.ingredientId, ingredientId),
        eq(prepCompletionsTable.recipeId, recipeId),
        eq(prepCompletionsTable.tinNumber, tinNumber),
      ));
  }
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

// ──────────────────────────────────────────────────────────────────────────────
// GET /:id/raw-materials
// Returns a full raw-materials manifest for a plan, recursively expanding
// sub-recipes into their constituent raw ingredients.
// Ingredients with category = 'seasoning' are excluded.
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/raw-materials", async (req, res) => {
  const planId = Number(req.params.id);
  if (isNaN(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }

  const [plan] = await db
    .select({
      id: productionPlansTable.id,
      planDate: productionPlansTable.planDate,
      name: productionPlansTable.name,
      batchNumber: productionPlansTable.batchNumber,
    })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId))
    .limit(1);

  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

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

  // Collect all ingredient details up front to avoid N+1
  const allIngredients = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      category: ingredientsTable.category,
      processingRatio: ingredientsTable.processingRatio,
      supplierId: ingredientsTable.supplierId,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
      supplierPartNumber: ingredientsTable.supplierPartNumber,
    })
    .from(ingredientsTable);
  const ingLookup = new Map(allIngredients.map(i => [i.id, i]));

  // Collect all sub-recipe info up front
  const allSubRecipes = await db.select().from(subRecipesTable);
  const srLookup = new Map(allSubRecipes.map(s => [s.id, s]));

  const allSRI = await db.select().from(subRecipeIngredientsTable);
  const srIngMap = new Map<number, typeof allSRI>();
  for (const row of allSRI) {
    if (!srIngMap.has(row.subRecipeId)) srIngMap.set(row.subRecipeId, []);
    srIngMap.get(row.subRecipeId)!.push(row);
  }

  const allSRSR = await db.select().from(subRecipeSubRecipesTable);
  const srSrMap = new Map<number, typeof allSRSR>();
  for (const row of allSRSR) {
    if (!srSrMap.has(row.subRecipeId)) srSrMap.set(row.subRecipeId, []);
    srSrMap.get(row.subRecipeId)!.push(row);
  }

  const allRSR = await db.select().from(recipeSubRecipesTable);
  const rSrMap = new Map<number, typeof allRSR>();
  for (const row of allRSR) {
    if (!rSrMap.has(row.recipeId)) rSrMap.set(row.recipeId, []);
    rSrMap.get(row.recipeId)!.push(row);
  }

  const allRI = await db.select().from(recipeIngredientsTable);
  const rIngMap = new Map<number, typeof allRI>();
  for (const row of allRI) {
    if (!rIngMap.has(row.recipeId)) rIngMap.set(row.recipeId, []);
    rIngMap.get(row.recipeId)!.push(row);
  }

  // Recursively explode a sub-recipe into raw ingredients (excluding seasonings)
  // Returns list of { ingredientId, name, unit, quantity (already scaled), category }
  function explodeSubRecipe(
    subRecipeId: number,
    scale: number,
    ancestors: Set<number>,
  ): Array<{ ingredientId: number; name: string; unit: string; quantity: number; category: string | null }> {
    if (ancestors.has(subRecipeId)) return [];
    const sr = srLookup.get(subRecipeId);
    if (!sr) return [];
    const yieldVal = Number(sr.yield) || 0;
    if (yieldVal === 0) return [];
    const effectiveScale = scale / yieldVal;

    const results: Array<{ ingredientId: number; name: string; unit: string; quantity: number; category: string | null }> = [];

    for (const sri of srIngMap.get(subRecipeId) ?? []) {
      const ing = ingLookup.get(sri.ingredientId);
      if (!ing) continue;
      if (ing.category === "seasoning") continue;
      const cookedQty = Number(sri.quantity) * effectiveScale;
      const pRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const rawQty = pRatio && pRatio > 0 ? cookedQty / pRatio : cookedQty;
      results.push({
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        quantity: rawQty,
        category: ing.category,
      });
    }

    const newAncestors = new Set(ancestors).add(subRecipeId);
    for (const srsr of srSrMap.get(subRecipeId) ?? []) {
      const nested = explodeSubRecipe(srsr.componentSubRecipeId, Number(srsr.quantity) * effectiveScale, newAncestors);
      results.push(...nested);
    }
    return results;
  }

  interface SubRecipeEntry {
    subRecipeId: number;
    name: string;
    totalWeightRequired: number;
    unit: string;
    components: Array<{ ingredientId: number; name: string; unit: string; quantity: number }>;
  }

  interface RecipeManifestEntry {
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    directIngredients: Array<{ ingredientId: number; name: string; unit: string; quantity: number }>;
    subRecipes: SubRecipeEntry[];
  }

  const recipeEntries: RecipeManifestEntry[] = [];

  // Aggregate totals across the whole plan
  const planTotals = new Map<number, { ingredientId: number; name: string; unit: string; quantity: number; category: string | null; packWeight: number | null; costPerPack: number | null }>();

  function addToTotals(ingredientId: number, name: string, unit: string, quantity: number, category: string | null) {
    const existing = planTotals.get(ingredientId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      const ing = ingLookup.get(ingredientId);
      planTotals.set(ingredientId, {
        ingredientId, name, unit, quantity, category,
        packWeight: ing?.packWeight ? Number(ing.packWeight) : null,
        costPerPack: ing?.costPerPack ? Number(ing.costPerPack) : null,
      });
    }
  }

  for (const item of planItems) {
    if (!item.recipeId || !item.recipeName) continue;
    const batchesTarget = Number(item.batchesTarget) || 0;
    if (batchesTarget === 0) continue;

    const portionsPerBatch = Number(item.portionsPerBatch) || 10;
    const scale = batchesTarget * portionsPerBatch;

    const directIngredients: Array<{ ingredientId: number; name: string; unit: string; quantity: number }> = [];
    for (const ri of rIngMap.get(item.recipeId) ?? []) {
      const ing = ingLookup.get(ri.ingredientId);
      if (!ing) continue;
      if (ing.category === "seasoning") continue;
      const cookedQty = Number(ri.quantity) * scale;
      const pRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const rawQty = pRatio && pRatio > 0 ? cookedQty / pRatio : cookedQty;
      directIngredients.push({ ingredientId: ing.id, name: ing.name, unit: ing.unit, quantity: rawQty });
      addToTotals(ing.id, ing.name, ing.unit, rawQty, ing.category);
    }

    const subRecipeEntries: SubRecipeEntry[] = [];
    for (const rsr of rSrMap.get(item.recipeId) ?? []) {
      const sr = srLookup.get(rsr.subRecipeId);
      if (!sr) continue;
      const srQtyRequired = Number(rsr.quantity) * scale;
      const components = explodeSubRecipe(rsr.subRecipeId, srQtyRequired, new Set());
      subRecipeEntries.push({
        subRecipeId: rsr.subRecipeId,
        name: sr.name,
        totalWeightRequired: srQtyRequired,
        unit: sr.yieldUnit,
        components: components.map(c => ({ ingredientId: c.ingredientId, name: c.name, unit: c.unit, quantity: c.quantity })),
      });
      for (const c of components) {
        addToTotals(c.ingredientId, c.name, c.unit, c.quantity, c.category);
      }
    }

    recipeEntries.push({
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      batchesTarget,
      directIngredients,
      subRecipes: subRecipeEntries,
    });
  }

  const totalsArray = Array.from(planTotals.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => {
      let estimatedCost: number | null = null;
      if (t.packWeight && t.packWeight > 0 && t.costPerPack != null) {
        estimatedCost = Math.round((t.quantity / t.packWeight) * t.costPerPack * 100) / 100;
      }
      return { ingredientId: t.ingredientId, name: t.name, unit: t.unit, quantity: t.quantity, estimatedCost };
    });

  const costedItems = totalsArray.filter(t => t.estimatedCost != null);
  const totalEstimatedCost = costedItems.length > 0
    ? Math.round(costedItems.reduce((sum, t) => sum + (t.estimatedCost ?? 0), 0) * 100) / 100
    : null;
  const costIsPartial = costedItems.length > 0 && costedItems.length < totalsArray.length;

  res.json({
    planId: plan.id,
    planDate: plan.planDate,
    planName: plan.name,
    batchNumber: plan.batchNumber,
    recipes: recipeEntries,
    totals: totalsArray,
    totalEstimatedCost,
    costIsPartial,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /:id/raw-materials/create-order
// Generates supplier purchase orders for every ingredient in the raw-materials
// manifest at full required quantity — no stock or kanban checks.
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/raw-materials/create-order", async (req, res) => {
  const planId = Number(req.params.id);
  if (isNaN(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }

  const [plan] = await db
    .select({ id: productionPlansTable.id, name: productionPlansTable.name })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId))
    .limit(1);

  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  // Inline resolve of raw-materials totals (same logic as GET endpoint, just totals)
  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  const allIngredients = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      category: ingredientsTable.category,
      processingRatio: ingredientsTable.processingRatio,
      supplierId: ingredientsTable.supplierId,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
      supplierPartNumber: ingredientsTable.supplierPartNumber,
    })
    .from(ingredientsTable);
  const ingLookup = new Map(allIngredients.map(i => [i.id, i]));

  const allSubRecipes = await db.select().from(subRecipesTable);
  const srLookup = new Map(allSubRecipes.map(s => [s.id, s]));

  const allSRI = await db.select().from(subRecipeIngredientsTable);
  const srIngMap = new Map<number, typeof allSRI>();
  for (const row of allSRI) {
    if (!srIngMap.has(row.subRecipeId)) srIngMap.set(row.subRecipeId, []);
    srIngMap.get(row.subRecipeId)!.push(row);
  }

  const allSRSR = await db.select().from(subRecipeSubRecipesTable);
  const srSrMap = new Map<number, typeof allSRSR>();
  for (const row of allSRSR) {
    if (!srSrMap.has(row.subRecipeId)) srSrMap.set(row.subRecipeId, []);
    srSrMap.get(row.subRecipeId)!.push(row);
  }

  const allRSR = await db.select().from(recipeSubRecipesTable);
  const rSrMap = new Map<number, typeof allRSR>();
  for (const row of allRSR) {
    if (!rSrMap.has(row.recipeId)) rSrMap.set(row.recipeId, []);
    rSrMap.get(row.recipeId)!.push(row);
  }

  const allRI = await db.select().from(recipeIngredientsTable);
  const rIngMap = new Map<number, typeof allRI>();
  for (const row of allRI) {
    if (!rIngMap.has(row.recipeId)) rIngMap.set(row.recipeId, []);
    rIngMap.get(row.recipeId)!.push(row);
  }

  function explodeSubRecipeForOrder(
    subRecipeId: number,
    scale: number,
    ancestors: Set<number>,
  ): Array<{ ingredientId: number; quantity: number }> {
    if (ancestors.has(subRecipeId)) return [];
    const sr = srLookup.get(subRecipeId);
    if (!sr) return [];
    const yieldVal = Number(sr.yield) || 0;
    if (yieldVal === 0) return [];
    const effectiveScale = scale / yieldVal;

    const results: Array<{ ingredientId: number; quantity: number }> = [];
    for (const sri of srIngMap.get(subRecipeId) ?? []) {
      const ing = ingLookup.get(sri.ingredientId);
      if (!ing || ing.category === "seasoning") continue;
      const cookedQty = Number(sri.quantity) * effectiveScale;
      const pRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const rawQty = pRatio && pRatio > 0 ? cookedQty / pRatio : cookedQty;
      results.push({ ingredientId: ing.id, quantity: rawQty });
    }
    const newAncestors = new Set(ancestors).add(subRecipeId);
    for (const srsr of srSrMap.get(subRecipeId) ?? []) {
      const nested = explodeSubRecipeForOrder(srsr.componentSubRecipeId, Number(srsr.quantity) * effectiveScale, newAncestors);
      results.push(...nested);
    }
    return results;
  }

  const totals = new Map<number, number>();

  for (const item of planItems) {
    if (!item.recipeId) continue;
    const batchesTarget = Number(item.batchesTarget) || 0;
    if (batchesTarget === 0) continue;
    const portionsPerBatch = Number(item.portionsPerBatch) || 10;
    const scale = batchesTarget * portionsPerBatch;

    for (const ri of rIngMap.get(item.recipeId) ?? []) {
      const ing = ingLookup.get(ri.ingredientId);
      if (!ing || ing.category === "seasoning") continue;
      const cookedQty = Number(ri.quantity) * scale;
      const pRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const rawQty = pRatio && pRatio > 0 ? cookedQty / pRatio : cookedQty;
      totals.set(ri.ingredientId, (totals.get(ri.ingredientId) ?? 0) + rawQty);
    }

    for (const rsr of rSrMap.get(item.recipeId) ?? []) {
      const srQty = Number(rsr.quantity) * scale;
      const components = explodeSubRecipeForOrder(rsr.subRecipeId, srQty, new Set());
      for (const c of components) {
        totals.set(c.ingredientId, (totals.get(c.ingredientId) ?? 0) + c.quantity);
      }
    }
  }

  // Group by supplier
  const supplierOrderMap = new Map<number, Array<{ ingredientId: number; name: string; unit: string; quantity: number; packWeight: number; costPerPack: number; supplierPartNumber: string | null }>>();

  for (const [ingredientId, quantity] of totals) {
    const ing = ingLookup.get(ingredientId);
    if (!ing || !ing.supplierId) continue;
    if (!supplierOrderMap.has(ing.supplierId)) supplierOrderMap.set(ing.supplierId, []);
    supplierOrderMap.get(ing.supplierId)!.push({
      ingredientId,
      name: ing.name,
      unit: ing.unit,
      quantity,
      packWeight: Number(ing.packWeight) || 1,
      costPerPack: Number(ing.costPerPack) || 0,
      supplierPartNumber: ing.supplierPartNumber ?? null,
    });
  }

  const createdOrders: Array<{ orderId: number; supplierId: number; supplierName: string; lineCount: number; action: "created" | "updated" }> = [];

  for (const [supplierId, lines] of supplierOrderMap) {
    if (lines.length === 0) continue;

    const [supplierRow] = await db
      .select({ id: suppliersTable.id, name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, supplierId))
      .limit(1);

    const existingDrafts = await db
      .select({ id: purchaseOrdersTable.id })
      .from(purchaseOrdersTable)
      .where(and(
        eq(purchaseOrdersTable.supplierId, supplierId),
        eq(purchaseOrdersTable.planId, planId),
        eq(purchaseOrdersTable.status, "draft"),
      ))
      .limit(1);

    let order: { id: number };
    let action: "created" | "updated";

    if (existingDrafts.length > 0) {
      order = existingDrafts[0];
      action = "updated";
      await db.delete(purchaseOrderLinesTable)
        .where(eq(purchaseOrderLinesTable.purchaseOrderId, order.id));
      await db.update(purchaseOrdersTable)
        .set({ notes: `Full-plan raw materials order for: ${plan.name}` })
        .where(eq(purchaseOrdersTable.id, order.id));
    } else {
      const [newOrder] = await db.insert(purchaseOrdersTable).values({
        supplierId,
        planId,
        status: "draft",
        notes: `Full-plan raw materials order for: ${plan.name}`,
      }).returning();
      order = newOrder;
      action = "created";
    }

    const lineValues = lines.map(l => {
      const packWeight = l.packWeight;
      const packsToOrder = packWeight > 0 ? Math.ceil(l.quantity / packWeight) : 1;
      const orderQty = packsToOrder * packWeight;
      return {
        purchaseOrderId: order.id,
        ingredientId: l.ingredientId,
        quantityRequired: String(Math.round(l.quantity * 100) / 100),
        quantityOrdered: String(Math.round(orderQty * 100) / 100),
        quantityReceived: "0",
        unit: l.unit,
        unitPrice: l.costPerPack > 0 ? String(l.costPerPack) : null,
        checkedOff: false,
        notes: null,
      };
    });

    await db.insert(purchaseOrderLinesTable).values(lineValues);

    createdOrders.push({
      orderId: order.id,
      supplierId,
      supplierName: supplierRow?.name ?? `Supplier #${supplierId}`,
      lineCount: lines.length,
      action,
    });
  }

  const ordersCreatedCount = createdOrders.filter(o => o.action === "created").length;
  const ordersUpdatedCount = createdOrders.filter(o => o.action === "updated").length;

  res.status(201).json({
    planId,
    planName: plan.name,
    ordersCreated: ordersCreatedCount,
    ordersUpdated: ordersUpdatedCount,
    orders: createdOrders,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /:id/validate — validate production plan quantities against recipes
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/validate", async (req, res) => {
  try {
  const planId = Number(req.params.id);
  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }

  const planItems = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId))
    .orderBy(productionPlanItemsTable.orderPosition);

  interface ValidationWarning {
    level: "error" | "warning" | "info";
    recipe: string;
    field: string;
    message: string;
    expected?: number | string;
    actual?: number | string;
  }

  const warnings: ValidationWarning[] = [];

  let totalPortions = 0;
  let totalPacks = 0;

  interface RecipeBreakdown {
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    packSize: number;
    totalPortions: number;
    totalPacks: number;
    ingredients: Array<{
      ingredientName: string;
      recipeQtyPerPortion: number;
      qtyPerBatch: number;
      totalQtyForPlan: number;
      unit: string;
    }>;
  }

  const recipeBreakdowns: RecipeBreakdown[] = [];

  for (const item of planItems) {
    if (!item.recipeId) continue;
    const batches = Number(item.batchesTarget) || 0;
    const rawPpb = item.portionsPerBatch != null ? Number(item.portionsPerBatch) : null;
    const portionsPerBatch = rawPpb != null && rawPpb > 0 ? rawPpb : 10;
    const rawPs = item.packSize != null ? Number(item.packSize) : null;
    const packSize = rawPs != null && rawPs > 0 ? rawPs : 2;
    const recipeName = item.recipeName ?? `Recipe #${item.recipeId}`;

    if (portionsPerBatch <= 0) {
      warnings.push({
        level: "error",
        recipe: recipeName,
        field: "portionsPerBatch",
        message: "Portions per batch is zero or negative",
        actual: portionsPerBatch,
      });
    }

    if (packSize <= 0) {
      warnings.push({
        level: "error",
        recipe: recipeName,
        field: "packSize",
        message: "Pack size is zero or negative",
        actual: packSize,
      });
    }

    if (portionsPerBatch % packSize !== 0) {
      warnings.push({
        level: "warning",
        recipe: recipeName,
        field: "portionsPerBatch",
        message: `Portions per batch (${portionsPerBatch}) is not evenly divisible by pack size (${packSize})`,
        expected: `Multiple of ${packSize}`,
        actual: portionsPerBatch,
      });
    }

    const itemPortions = batches * portionsPerBatch;
    const itemPacks = packSize > 0 ? itemPortions / packSize : 0;
    totalPortions += itemPortions;
    totalPacks += itemPacks;

    const directIngs = await db
      .select({
        ingredientId: recipeIngredientsTable.ingredientId,
        quantity: recipeIngredientsTable.quantity,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
      })
      .from(recipeIngredientsTable)
      .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, item.recipeId));

    const ingredientDetails: RecipeBreakdown["ingredients"] = [];

    for (const ing of directIngs) {
      const qtyPerPortion = Number(ing.quantity) || 0;
      const qtyPerBatch = qtyPerPortion * portionsPerBatch;
      const totalQty = qtyPerBatch * batches;
      ingredientDetails.push({
        ingredientName: ing.ingredientName ?? `Ingredient #${ing.ingredientId}`,
        recipeQtyPerPortion: qtyPerPortion,
        qtyPerBatch,
        totalQtyForPlan: totalQty,
        unit: ing.unit ?? "g",
      });
    }

    const subRecipeLinks = await db
      .select({
        subRecipeId: recipeSubRecipesTable.subRecipeId,
        quantity: recipeSubRecipesTable.quantity,
        subRecipeName: subRecipesTable.name,
        subRecipeYield: subRecipesTable.yield,
      })
      .from(recipeSubRecipesTable)
      .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
      .where(eq(recipeSubRecipesTable.recipeId, item.recipeId));

    for (const sr of subRecipeLinks) {
      const srQtyPerPortion = Number(sr.quantity) || 0;
      const qtyPerBatch = srQtyPerPortion * portionsPerBatch;
      const totalQty = qtyPerBatch * batches;
      ingredientDetails.push({
        ingredientName: `[Sub-recipe] ${sr.subRecipeName ?? "Unknown"}`,
        recipeQtyPerPortion: srQtyPerPortion,
        qtyPerBatch,
        totalQtyForPlan: totalQty,
        unit: "kg",
      });
    }

    recipeBreakdowns.push({
      recipeName,
      batchesTarget: batches,
      portionsPerBatch,
      packSize,
      totalPortions: itemPortions,
      totalPacks: itemPacks,
      ingredients: ingredientDetails,
    });
  }

  const resolved = await Promise.all(
    planItems
      .filter(item => item.recipeId && (Number(item.batchesTarget) || 0) > 0)
      .map(async (item) => {
        const portionsPerBatch = (item.portionsPerBatch != null && Number(item.portionsPerBatch) > 0) ? Number(item.portionsPerBatch) : 10;
        const batches = Number(item.batchesTarget) || 0;
        const ingredients = await resolveRecipeIngredients(item.recipeId!, portionsPerBatch);
        const agg = aggregateIngredients(ingredients);
        return { recipeName: item.recipeName, batches, agg };
      })
  );

  const prepTotals: Record<number, { name: string; unit: string; totalQty: number; recipes: string[] }> = {};
  for (const r of resolved) {
    for (const [iid, ing] of r.agg) {
      const totalCookedQty = ing.quantityPerBatch * r.batches;
      if (!prepTotals[iid]) {
        prepTotals[iid] = { name: ing.ingredientName, unit: ing.unit, totalQty: 0, recipes: [] };
      }
      prepTotals[iid].totalQty += totalCookedQty;
      prepTotals[iid].recipes.push(r.recipeName ?? "Unknown");
    }
  }

  const recipeDirectTotals: Record<string, number> = {};
  for (const rb of recipeBreakdowns) {
    for (const ing of rb.ingredients) {
      if (ing.ingredientName.startsWith("[Sub-recipe]")) continue;
      const key = ing.ingredientName;
      recipeDirectTotals[key] = (recipeDirectTotals[key] || 0) + ing.totalQtyForPlan;
    }
  }

  for (const [, prepIng] of Object.entries(prepTotals)) {
    const directTotal = recipeDirectTotals[prepIng.name];
    if (directTotal !== undefined) {
      const diff = Math.abs(prepIng.totalQty - directTotal);
      const pctDiff = directTotal > 0 ? (diff / directTotal) * 100 : 0;
      if (pctDiff > 1) {
        warnings.push({
          level: "warning",
          recipe: prepIng.recipes.join(", "),
          field: prepIng.name,
          message: `Resolved total (${prepIng.totalQty.toFixed(2)}${prepIng.unit}) differs from direct recipe calculation (${directTotal.toFixed(2)}${prepIng.unit}) — ${pctDiff.toFixed(1)}% difference`,
          expected: directTotal,
          actual: prepIng.totalQty,
        });
      }
    }
  }

  res.json({
    planId,
    planName: plan.name,
    totalBatches: planItems.reduce((s, it) => s + (Number(it.batchesTarget) || 0), 0),
    totalPortions,
    totalPacks,
    recipeBreakdowns,
    ingredientTotals: Object.values(prepTotals).map(p => ({
      ingredientName: p.name,
      unit: p.unit,
      totalQty: Math.round(p.totalQty * 100) / 100,
      recipes: p.recipes,
    })),
    warnings,
    valid: warnings.filter(w => w.level === "error").length === 0,
  });
  } catch (err) {
    console.error("[validate] Error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Validation failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

async function requireManagerOrAdmin(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  let role = req.session.userRole;
  if (!role && req.session.userId) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      role = user.role as "admin" | "manager" | "viewer";
      req.session.userRole = role;
    }
  }
  if (role !== "admin" && role !== "manager") {
    res.status(403).json({ error: "Only managers and admins can perform this action." });
    return false;
  }
  return true;
}

router.post("/:id/resync", async (req, res) => {
  try {
    if (!(await requireManagerOrAdmin(req, res))) return;

    const planId = Number(req.params.id);
    const { confirmed } = req.body as { confirmed?: boolean };

    const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
    if (!plan) { res.status(404).json({ error: "Not found" }); return; }

    if (plan.status === "complete") {
      res.status(400).json({ error: "Completed plans cannot be resynced." });
      return;
    }

    const planItems = await db
      .select({
        itemId: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
      })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, planId));

    if (planItems.length === 0) {
      res.json({ message: "No items to resync", updated: 0 });
      return;
    }

    if (plan.status !== "draft" && !confirmed) {
      res.status(409).json({
        error: "This plan is active. Resyncing will overwrite tin size, max batches per tin, and SOP URL for all items with the latest recipe data. Send { confirmed: true } to proceed.",
        requiresConfirmation: true,
      });
      return;
    }

    const recipeIds = [...new Set(planItems.map(i => i.recipeId))];
    const recipes = await db
      .select({ id: recipesTable.id, tinSize: recipesTable.tinSize, maxBatchesPerTin: recipesTable.maxBatchesPerTin, sopUrl: recipesTable.sopUrl })
      .from(recipesTable)
      .where(inArray(recipesTable.id, recipeIds));
    const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r]));

    const updatedCount = await db.transaction(async (tx) => {
      let count = 0;
      for (const item of planItems) {
        const recipe = recipeMap[item.recipeId];
        if (!recipe) continue;
        await tx.update(productionPlanItemsTable)
          .set({
            tinSize: recipe.tinSize ?? null,
            maxBatchesPerTin: recipe.maxBatchesPerTin ?? null,
            sopUrl: recipe.sopUrl ?? null,
          })
          .where(eq(productionPlanItemsTable.id, item.itemId));
        count++;
      }
      return count;
    });

    res.json({ message: `Resynced ${updatedCount} item(s) with latest recipe data.`, updated: updatedCount });
  } catch (err) {
    console.error("[resync] Error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Resync failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/:id/reset", async (req, res) => {
  try {
    if (!(await requireManagerOrAdmin(req, res))) return;

    const planId = Number(req.params.id);
    const { confirmed } = req.body as { confirmed?: boolean };

    const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
    if (!plan) { res.status(404).json({ error: "Not found" }); return; }

    if (plan.status === "complete") {
      res.status(400).json({ error: "Completed plans cannot be reset." });
      return;
    }

    if (!confirmed) {
      res.status(409).json({
        error: "Resetting this plan will zero all batch completions, prep completions, station breaks, temperature records, oven events, and set the plan back to draft. This cannot be undone. Send { confirmed: true } to proceed.",
        requiresConfirmation: true,
      });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.delete(batchCompletionsTable).where(
        inArray(batchCompletionsTable.planItemId,
          db.select({ id: productionPlanItemsTable.id }).from(productionPlanItemsTable).where(eq(productionPlanItemsTable.planId, planId))
        )
      );

      await tx.delete(prepCompletionsTable).where(eq(prepCompletionsTable.planId, planId));
      await tx.delete(stationBreaksTable).where(eq(stationBreaksTable.planId, planId));
      await tx.execute(sql`DELETE FROM temperature_records WHERE plan_id = ${planId}`);
      await tx.execute(sql`DELETE FROM oven_events WHERE plan_id = ${planId}`);

      await tx.update(productionPlanItemsTable)
        .set({
          batchesComplete: 0,
          wonlyCount: 0,
          wrappingComplete: false,
          fridgeQty: 0,
          freezerQty: 0,
          prepFridgeQty: 0,
          extraPacksBuilt: 0,
          status: "pending",
        })
        .where(eq(productionPlanItemsTable.planId, planId));

      await tx.update(productionPlansTable)
        .set({ status: "draft" })
        .where(eq(productionPlansTable.id, planId));
    });

    res.json({ message: "Production plan has been reset to draft with all progress cleared." });
  } catch (err) {
    console.error("[reset] Error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Reset failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
