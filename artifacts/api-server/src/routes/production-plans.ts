import { Router, type IRouter } from "express";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, batchCompletionsTable, stationBreaksTable, stationChangeoversTable, recipeIngredientsTable, ingredientsTable, recipeSubRecipesTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, dispatchOrdersTable, appSettingsTable, prepCompletionsTable, prepTinOverridesTable, dailyStockChecksTable, usersTable, recipeMeatMarinadesTable, stockEntriesTable, fridgeStockBatchesTable, dptSettingsTable, purchaseOrdersTable, purchaseOrderLinesTable, suppliersTable, batchWeightRecordsTable, temperatureRecordsTable } from "@workspace/db";
import { eq, and, desc, sql, gt, gte, lte, asc, inArray, notInArray, sum as drizzleSum, ne, isNotNull, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { validate } from "../middleware/validate";
import * as z from "zod";
import { resolveRecipeIngredients, resolveSubRecipeIngredients, aggregateIngredients, roundByUnit, type ResolvedIngredient } from "../lib/ingredient-resolver";
import { countProductsByTag, adjustInventoryLevel, getUnfulfilledOrdersByTag } from "../services/shopify";
import { getFactoryNumberCoreMenuOnly, getShopifyFreezerSyncEnabled } from "../lib/inventory-sync";

/** Recipe category name for macaroni cheese products. Used to split calzone
 *  vs mac cheese metrics (mac cheese is tracked in packs, calzones in batches). */
const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

/** Calculate tin count with minimum-2-tins rule for prep/mixing stations.
 *  When batches > 5, always at least 2 tins. ≤5 batches uses normal calc. */
function calcTinCount(batchesTarget: number, maxBatchesPerTin: number | null): number | null {
  if (!maxBatchesPerTin || batchesTarget <= 0) return null;
  const raw = Math.ceil(batchesTarget / maxBatchesPerTin);
  return batchesTarget > 5 ? Math.max(2, raw) : raw;
}

const router: IRouter = Router();

/** Applies a delta to the latest production_fridge stock_entries row
 *  for a given recipe. Positive delta = wrapping added packs, negative
 *  delta = fulfilment removed packs. Floors at 0. Exported so the
 *  inventory-sync helper can call it from the fulfilment decrement
 *  path and the one-off reset endpoint. */
export async function syncRecipeFridgeStock(recipeId: number, deltaQty: number, packSize: number = 2, txOrDb: typeof db = db) {
  const existing = await txOrDb
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

  if (existing.length > 0) {
    const newQty = Math.max(0, Number(existing[0].quantity) + deltaQty);
    await txOrDb.update(stockEntriesTable)
      .set({ quantity: String(newQty), checkedAt: new Date() })
      .where(eq(stockEntriesTable.id, existing[0].id));
  } else {
    await txOrDb.insert(stockEntriesTable).values({
      recipeId,
      itemType: "recipe",
      quantity: String(Math.max(0, deltaQty)),
      unit: packSize === 8 ? "8-pack bags" : "packs",
      location: "production_fridge",
      packSize,
      notes: packSize === 8 ? "Auto-created from wrapping station (8-pack bags)" : "Auto-created from wrapping station",
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

/** Returns the plan's status if the plan exists and is a draft; null
 *  if it doesn't exist or is in any other status. Used by completion
 *  endpoints to reject writes against draft plans (prep crew must
 *  activate a plan before recording work — batchesTarget can still
 *  change while draft). */
async function planDraftStatus(planId: number): Promise<string | null> {
  if (!Number.isFinite(planId)) return null;
  const [row] = await db
    .select({ status: productionPlansTable.status })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId))
    .limit(1);
  if (!row) return null;
  return row.status === "draft" ? "draft" : null;
}

const DRAFT_COMPLETION_ERROR = "Plan is a draft — activate before recording completions.";

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

// ── Non-dispatch days (bank holidays, factory shutdowns) ─────────────
// Stored as a JSON array of ISO dates in app_settings.non_dispatch_dates.
// Editable from Settings → Production. Used by every working-day walk
// in /calculate and /calculate-mac-cheese so a Tuesday production
// following a bank-holiday Monday correctly pulls Friday's dispatch as
// "previous", not the empty Monday slot.
const NON_DISPATCH_SETTING_KEY = "non_dispatch_dates";

export async function getNonDispatchDates(): Promise<Set<string>> {
  const [row] = await db.select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, NON_DISPATCH_SETTING_KEY))
    .limit(1);
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(row.value);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((s): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)));
    }
  } catch {}
  return new Set();
}

// Top-level holiday-aware variants. Async because they read app_settings.
// The inline sync versions inside /calculate are wrappers that pass the
// resolved Set in to keep the per-request DB hit to one read.
export async function getPreviousDispatchDayAsync(fromDate: string): Promise<string> {
  const skip = await getNonDispatchDates();
  return getPreviousDispatchDay(fromDate, skip);
}
export async function getNextDispatchDayAsync(fromDate: string): Promise<string> {
  const skip = await getNonDispatchDates();
  return getNextDispatchDay(fromDate, skip);
}
export function getPreviousDispatchDay(fromDate: string, skip: Set<string>): string {
  const d = new Date(`${fromDate}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || skip.has(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}
export function getNextDispatchDay(fromDate: string, skip: Set<string>): string {
  const d = new Date(`${fromDate}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || skip.has(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}

// Walk back from `fromDate` until we hit a Mon–Fri. Used as the very-last
// fallback when a plan is created without an override AND no per-day-of-week
// schedule setting is configured. Most callers should use
// resolveDefaultPrepDate / resolveDefaultDoughDate instead.
export function getPreviousBusinessDay(fromDate: string): string {
  const d = new Date(`${fromDate}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// Default prep / dough lead times, in calendar days, by production-day-of-
// week. Mirrors the kitchen's actual rhythm: prep happens the previous
// business day for Tue–Fri productions; for Monday production prep happens
// on Friday (3 days back) and dough comes in on Saturday (2 days back).
// Operators can override per-day in Settings — these are just the seeds.
const DAY_NAMES_LOWER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DEFAULT_PREP_OFFSETS: Record<string, number> = { monday: 3, tuesday: 1, wednesday: 1, thursday: 1, friday: 1 };
const DEFAULT_DOUGH_OFFSETS: Record<string, number> = { monday: 2, tuesday: 1, wednesday: 1, thursday: 1, friday: 1 };

async function readOffsetSetting(key: string): Promise<number | null> {
  const [row] = await db.select({ value: appSettingsTable.value }).from(appSettingsTable).where(eq(appSettingsTable.key, key)).limit(1);
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function applyOffset(fromDate: string, offsetDays: number): string {
  const d = new Date(`${fromDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function resolveDefaultPrepDate(planDate: string): Promise<string> {
  const dow = new Date(`${planDate}T12:00:00Z`).getUTCDay();
  const dayName = DAY_NAMES_LOWER[dow];
  const fromSettings = await readOffsetSetting(`prep_offset_days_${dayName}`);
  const offset = fromSettings ?? DEFAULT_PREP_OFFSETS[dayName];
  if (offset == null) return getPreviousBusinessDay(planDate);
  return applyOffset(planDate, offset);
}

export async function resolveDefaultDoughDate(planDate: string): Promise<string> {
  const dow = new Date(`${planDate}T12:00:00Z`).getUTCDay();
  const dayName = DAY_NAMES_LOWER[dow];
  const fromSettings = await readOffsetSetting(`dough_offset_days_${dayName}`);
  const offset = fromSettings ?? DEFAULT_DOUGH_OFFSETS[dayName];
  if (offset == null) return getPreviousBusinessDay(planDate);
  return applyOffset(planDate, offset);
}

function mapItem(i: typeof productionPlanItemsTable.$inferSelect & { recipeName?: string | null; portionsPerBatch?: number | null; packSize?: number | null; fillWeightGrams?: string | null; baseType?: string | null; baseWeightGrams?: string | null; wrappingComplete?: boolean | null; recipeColor?: string | null; targetBuildSeconds?: number | null; recipeCategory?: string | null; dietaryCategory?: string | null }, stationCompletions?: Record<string, number>) {
  return {
    ...i,
    recipeName: i.recipeName ?? "",
    recipeCategory: i.recipeCategory ?? null,
    dietaryCategory: i.dietaryCategory ?? null,
    portionsPerBatch: i.portionsPerBatch ?? 10,
    packSize: i.packSize ?? 2,
    fillWeightGrams: i.fillWeightGrams ? Number(i.fillWeightGrams) : null,
    baseType: i.baseType ?? null,
    baseWeightGrams: i.baseWeightGrams ? Number(i.baseWeightGrams) : null,
    wrappingComplete: i.wrappingComplete ?? false,
    targetBuildSeconds: i.targetBuildSeconds ?? null,
    stationCompletions: stationCompletions ?? {},
  };
}

// Building is the start of the dependency chain — no mixing dependency.
// Chain: Building → Ovens → Wrapping (mixing runs independently).
const STATION_DEPENDENCIES: Record<string, string[]> = {
  building_1: [],
  building_2: [],
  macaroni_cheese: [],
  ovens: ["building_1", "building_2"],
  wrapping: ["ovens"],
};

function getPreviousStations(stationType: string): string[] {
  return STATION_DEPENDENCIES[stationType] ?? [];
}

const CreatePlanBody = z.object({
  planDate: z.string(),
  prepDate: z.string().nullish(),
  doughDate: z.string().nullish(),
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
  prepDate: z.string().nullish(),
  doughDate: z.string().nullish(),
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

  // Lightweight item breakdown per plan so the list view can show the
  // recipe lineup inline (used by the Production Plans day-card in the
  // front-end). We only need id/recipeId/recipeName/batchesTarget/
  // orderPosition — no completions, no ingredient joins.
  const itemRows = await db
    .select({
      id: productionPlanItemsTable.id,
      planId: productionPlanItemsTable.planId,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      recipeColor: recipesTable.color,
      recipeCategory: recipesTable.category,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      orderPosition: productionPlanItemsTable.orderPosition,
    })
    .from(productionPlanItemsTable)
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(inArray(productionPlanItemsTable.planId, planIds))
    .orderBy(productionPlanItemsTable.planId, productionPlanItemsTable.orderPosition);

  const itemsByPlan = new Map<number, typeof itemRows>();
  for (const it of itemRows) {
    const arr = itemsByPlan.get(it.planId) ?? [];
    arr.push(it);
    itemsByPlan.set(it.planId, arr);
  }

  res.json(plans.map(p => ({
    ...mapPlan(p),
    totalBatchesTarget: totalsMap.get(p.id)?.totalBatchesTarget ?? 0,
    itemCount: totalsMap.get(p.id)?.itemCount ?? 0,
    items: (itemsByPlan.get(p.id) ?? []).map(it => ({
      id: it.id,
      recipeId: it.recipeId,
      recipeName: it.recipeName,
      recipeColor: it.recipeColor,
      recipeCategory: it.recipeCategory ?? null,
      batchesTarget: it.batchesTarget,
      orderPosition: it.orderPosition,
    })),
  })));
});

// GET /production-plans/default-dates?planDate=YYYY-MM-DD
// Returns the prep_date and dough_date the backend will assign to a new
// plan with this planDate (assuming no overrides). The Create Plan dialog
// fetches this when the production date changes so operators see the
// configured defaults — including any per-day-of-week settings — instead
// of an empty input that gets resolved silently on submit.
router.get("/default-dates", async (req, res) => {
  const planDate = String(req.query.planDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    res.status(400).json({ error: "planDate query param required (YYYY-MM-DD)" });
    return;
  }
  const [prepDate, doughDate] = await Promise.all([
    resolveDefaultPrepDate(planDate),
    resolveDefaultDoughDate(planDate),
  ]);
  res.json({ planDate, prepDate, doughDate });
});

router.post("/", validate(CreatePlanBody), async (req, res) => {
  const { planDate, prepDate, doughDate, name, notes, status, items } = req.body;
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

  // Default both prep_date and dough_date based on the per-day-of-week
  // offsets configured in Settings (Phase 2), falling back to a sensible
  // baseline (prev business day for Tue–Fri, Fri/Sat for Mon production).
  // Stored at insert time so every reader can trust the column without
  // duplicating the fallback logic.
  const resolvedPrepDate = prepDate ?? await resolveDefaultPrepDate(planDate);
  const resolvedDoughDate = doughDate ?? await resolveDefaultDoughDate(planDate);

  const [plan] = await db.insert(productionPlansTable).values({
    planDate,
    prepDate: resolvedPrepDate,
    doughDate: resolvedDoughDate,
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

  // Holiday-aware dispatch-day helpers. Bank holidays / factory shutdowns
  // come from app_settings.non_dispatch_dates. We resolve the Set once
  // per request and reuse it for both walks.
  const nonDispatch = await getNonDispatchDates();
  const getPreviousWorkingDay = (from: string): string => getPreviousDispatchDay(from, nonDispatch);
  const getNextWorkingDay = (from: string): string => getNextDispatchDay(from, nonDispatch);

  function getNextCalendarDay(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // Dispatch happens Mon–Fri; delivery is always dispatch + 1 calendar day (APC overnight).
  // dispatch1 = previous DISPATCH day (skipping weekends + bank holidays) —
  //             reduces fridge stock from earlier production
  // dispatch2 = today's dispatch (main production target)
  // dispatch3 = next DISPATCH day (skipping weekends + bank holidays)
  // For e.g. Tue production after a bank-holiday Mon, dispatch1 walks back
  // to the previous Fri instead of landing on the empty Mon slot.
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

  // Factory Number reflects production_fridge stock only — that's the spec
  // the kitchen works to. Previously this excluded freezers but pooled all
  // other locations, so a stale row from any other non-freezer location
  // could out-rank an operator's production_fridge update on checkedAt
  // recency and silently override their reading.
  const stockRows = await db
    .select({
      recipeId: stockEntriesTable.recipeId,
      quantity: stockEntriesTable.quantity,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
    ))
    .orderBy(asc(stockEntriesTable.checkedAt));

  const latestStock: Record<number, number> = {};
  for (const row of stockRows) {
    if (row.recipeId != null) {
      latestStock[row.recipeId] = Number(row.quantity);
    }
  }

  // ─── Predicted end-of-today fridge stock ───────────────────────────
  // Two inputs feed the prediction: (1) remaining wrapping for TODAY's
  // active plan (what the wrapping station still needs to push into the
  // fridge), and (2) remaining fulfilment for today's dispatch (what the
  // fulfilment station still needs to pull out). `today` is the real
  // current calendar day, NOT the requested planDate — the operator
  // building the plan at 3pm wants to know where the fridge will be by
  // close of business, regardless of whether planDate is tomorrow or
  // three days out.
  const todayStr = new Date().toISOString().slice(0, 10);
  const coreMenuOnly = await getFactoryNumberCoreMenuOnly();

  const todayPlanItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      fridgeQty: productionPlanItemsTable.fridgeQty,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      eq(productionPlansTable.planDate, todayStr),
      inArray(productionPlansTable.status, ["active", "prep", "building"]),
    ));

  const remainingWrappingPacksToday: Record<number, number> = {};
  for (const row of todayPlanItems) {
    if (row.recipeId == null) continue;
    const portionsPerBatch = Number(row.portionsPerBatch) || 10;
    const packSize = Number(row.packSize) || 1;
    const packsPerBatch = portionsPerBatch / packSize;
    const targetPacks = (row.batchesTarget ?? 0) * packsPerBatch;
    const remaining = Math.max(0, targetPacks - (row.fridgeQty ?? 0));
    remainingWrappingPacksToday[row.recipeId] = (remainingWrappingPacksToday[row.recipeId] ?? 0) + remaining;
  }

  const remainingFulfilmentPacksToday: Record<number, number> = {};
  try {
    const unfulfilled = await getUnfulfilledOrdersByTag(todayStr);
    if (unfulfilled.length > 0) {
      const mappingRows = await db.execute<{
        recipe_id: number;
        shopify_variant_id: string;
        wonky_variant_id: string | null;
        is_core_menu: boolean;
      }>(sql`
        SELECT m.recipe_id, m.shopify_variant_id, m.wonky_variant_id, r.is_core_menu
        FROM recipe_shopify_mappings m
        INNER JOIN recipes r ON r.id = m.recipe_id
      `);
      const variantToRecipe = new Map<string, { recipeId: number; isCoreMenu: boolean }>();
      for (const m of mappingRows) {
        if (m.shopify_variant_id) variantToRecipe.set(String(m.shopify_variant_id), { recipeId: m.recipe_id, isCoreMenu: m.is_core_menu });
        if (m.wonky_variant_id) variantToRecipe.set(String(m.wonky_variant_id), { recipeId: m.recipe_id, isCoreMenu: m.is_core_menu });
      }
      for (const order of unfulfilled) {
        for (const line of order.line_items ?? []) {
          if (!line.variant_id) continue;
          const mapping = variantToRecipe.get(String(line.variant_id));
          if (!mapping) continue;
          if (coreMenuOnly && !mapping.isCoreMenu) continue;
          remainingFulfilmentPacksToday[mapping.recipeId] =
            (remainingFulfilmentPacksToday[mapping.recipeId] ?? 0) + (line.quantity || 0);
        }
      }
    }
  } catch (err) {
    console.warn("[/calculate] prediction: failed to fetch unfulfilled orders for today, falling back to live stock", err);
  }

  const shopifySalesPerDate: Record<string, Record<string, number>> = {};
  const shopifySalesCombined: Record<string, number> = {};
  // Variant-ID-based sales: variantId → { perDate: { date → qty }, combined: qty }
  const variantSalesPerDate: Record<string, Record<string, number>> = {};
  const variantSalesCombined: Record<string, number> = {};
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
      if (!variantSalesPerDate[date]) variantSalesPerDate[date] = {};
      shopifyDatesLoaded.add(date);
      for (const p of products) {
        const packVariant = p.variants.find(v => {
          const t = v.title.toLowerCase();
          return t.includes("2 pack") || t.includes("2-pack") || t === "2pack" || t.includes("serves 2");
        });
        if (packVariant) {
          const key = p.productTitle.toLowerCase().trim();
          shopifySalesPerDate[date][key] = (shopifySalesPerDate[date][key] ?? 0) + packVariant.quantity;
          shopifySalesCombined[key] = (shopifySalesCombined[key] ?? 0) + packVariant.quantity;
          // Track every variant by ID so a recipe linked to a non-2-pack
          // variant of a product that also has a 2-pack still picks up sales.
          for (const v of p.variants) {
            if (!v.variantId) continue;
            const vid = String(v.variantId);
            variantSalesPerDate[date][vid] = (variantSalesPerDate[date][vid] ?? 0) + v.quantity;
            variantSalesCombined[vid] = (variantSalesCombined[vid] ?? 0) + v.quantity;
          }
        } else if (p.variants.length === 0) {
          const key = p.productTitle.toLowerCase().trim();
          shopifySalesPerDate[date][key] = (shopifySalesPerDate[date][key] ?? 0) + p.totalQuantity;
          shopifySalesCombined[key] = (shopifySalesCombined[key] ?? 0) + p.totalQuantity;
        } else {
          // No matching pack variant — still track by variant ID for mapped recipes
          for (const v of p.variants) {
            if (v.variantId) {
              const vid = String(v.variantId);
              variantSalesPerDate[date][vid] = (variantSalesPerDate[date][vid] ?? 0) + v.quantity;
              variantSalesCombined[vid] = (variantSalesCombined[vid] ?? 0) + v.quantity;
            }
          }
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
  // Merge of Club Special sales into the target recipe is deferred until the
  // variant-ID mapping has loaded, so we can also credit the variant path (not
  // just the name-match fallback).

  const dptRows = await db
    .select({
      recipeId: dptSettingsTable.recipeId,
      recipeName: recipesTable.name,
      recipeCategory: recipesTable.category,
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
      category: recipesTable.category,
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
        recipeCategory: cm.category,
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

  // Load recipe → Shopify variant mappings for precise matching
  const recipeVariantMappings = await db.execute<{ recipe_id: number; shopify_variant_id: string | null; wonky_variant_id: string | null }>(sql`
    SELECT recipe_id, shopify_variant_id, wonky_variant_id FROM recipe_shopify_mappings
  `);
  const recipeToVariantIds = new Map<number, string[]>();
  for (const m of recipeVariantMappings.rows ?? recipeVariantMappings) {
    const existing = recipeToVariantIds.get(m.recipe_id) ?? [];
    if (m.shopify_variant_id) existing.push(String(m.shopify_variant_id));
    if (m.wonky_variant_id) existing.push(String(m.wonky_variant_id));
    if (existing.length > 0) recipeToVariantIds.set(m.recipe_id, existing);
  }

  // Merge Club Special sales into the target ("is_current_special") recipe.
  // We write to BOTH the name-based map (shopifySalesPerDate / Combined) and
  // the variant-ID-based map (variantSalesPerDate / Combined) so whichever
  // matching path resolves the target recipe gets the combined total. Writing
  // only to the name map previously caused the special to vanish whenever the
  // target recipe had a Shopify variant mapping (which is the norm for core
  // calzones), so the dispatch column showed only the base sales despite the
  // "incl. N club special" note.
  if (specialRecipe && hasShopifyData) {
    const specialVariantIds = recipeToVariantIds.get(specialRecipe.id) ?? [];
    const primarySpecialVariant = specialVariantIds[0];
    const specialNorm = specialRecipe.name
      .toLowerCase().trim().replace(/[''`]/g, "'").replace(/&/g, "and").replace(/\s+/g, " ");

    const specialQtyCombined = shopifySalesCombined[CALZONE_CLUB_SPECIAL_KEY] ?? 0;
    if (specialQtyCombined > 0) {
      shopifySalesCombined[specialNorm] = (shopifySalesCombined[specialNorm] ?? 0) + specialQtyCombined;
      if (primarySpecialVariant) {
        variantSalesCombined[primarySpecialVariant] =
          (variantSalesCombined[primarySpecialVariant] ?? 0) + specialQtyCombined;
      }
    }

    for (const date of deliveryDates) {
      const salesForDate = shopifySalesPerDate[date];
      if (!salesForDate) continue;
      const specialQty = salesForDate[CALZONE_CLUB_SPECIAL_KEY] ?? 0;
      if (specialQty > 0) {
        salesForDate[specialNorm] = (salesForDate[specialNorm] ?? 0) + specialQty;
        if (primarySpecialVariant) {
          if (!variantSalesPerDate[date]) variantSalesPerDate[date] = {};
          variantSalesPerDate[date][primarySpecialVariant] =
            (variantSalesPerDate[date][primarySpecialVariant] ?? 0) + specialQty;
        }
        specialCountPerDate[date] = specialQty;
      }
    }
  }

  function normalizeForMatch(s: string): string {
    return s.toLowerCase().trim().replace(/[''`]/g, "'").replace(/&/g, "and").replace(/\s+/g, " ");
  }

  // Match recipe to the BEST Shopify product — pick the closest-length match
  function bestShopifyMatch(recipeNorm: string, salesMap: Record<string, number>): { product: string | null; qty: number } {
    let bestProduct: string | null = null;
    let bestQty = 0;
    let bestLenDiff = Infinity;
    for (const [productTitle, qty] of Object.entries(salesMap)) {
      const productNorm = normalizeForMatch(productTitle);
      if (productNorm.includes(recipeNorm) || recipeNorm.includes(productNorm)) {
        const lenDiff = Math.abs(productNorm.length - recipeNorm.length);
        if (lenDiff < bestLenDiff) {
          bestLenDiff = lenDiff;
          bestProduct = productTitle;
          bestQty = qty;
        }
      }
    }
    return { product: bestProduct, qty: bestQty };
  }

  // Prefer variant-ID-based matching when recipe has a Shopify mapping
  function matchShopifySalesForDate(recipeName: string, date: string, recipeId?: number): number {
    // 1. Try variant ID match first (most accurate)
    if (recipeId && recipeToVariantIds.has(recipeId)) {
      const variantIds = recipeToVariantIds.get(recipeId)!;
      const dateSales = variantSalesPerDate[date] ?? {};
      let total = 0;
      for (const vid of variantIds) total += dateSales[vid] ?? 0;
      if (total > 0) return total;
    }
    // 2. Fall back to name matching
    const recipeNorm = normalizeForMatch(recipeName);
    const salesForDate = shopifySalesPerDate[date] ?? {};
    return bestShopifyMatch(recipeNorm, salesForDate).qty;
  }

  function matchShopifySalesCombined(recipeName: string, recipeId?: number): { qty: number; matchedProduct: string | null } {
    // 1. Try variant ID match first
    if (recipeId && recipeToVariantIds.has(recipeId)) {
      const variantIds = recipeToVariantIds.get(recipeId)!;
      let total = 0;
      for (const vid of variantIds) total += variantSalesCombined[vid] ?? 0;
      if (total > 0) return { qty: total, matchedProduct: `variant:${variantIds[0]}` };
    }
    // 2. Fall back to name matching
    const recipeNorm = normalizeForMatch(recipeName);
    const { product, qty } = bestShopifyMatch(recipeNorm, shopifySalesCombined);
    return { qty, matchedProduct: product };
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

    const shopifyMatch = matchShopifySalesCombined(recipeName, recipeId);
    const hasRecipeMatch = shopifyMatch.matchedProduct !== null;

    function resolveDispatchQty(date: string): number {
      if (!shopifyDatesLoaded.has(date)) return dptDailyPacks;
      if (!hasRecipeMatch) return dptDailyPacks;
      return matchShopifySalesForDate(recipeName, date, recipeId);
    }

    const dispatch1Qty = resolveDispatchQty(deliveryDates[0]);
    const dispatch2Qty = resolveDispatchQty(deliveryDates[1]);
    const dispatch3Qty = resolveDispatchQty(deliveryDates[2]);
    const totalDispatchQty = dispatch1Qty + dispatch2Qty + dispatch3Qty;

    const prevProduction = Math.round(prevProductionPacks[recipeId] ?? 0);

    // Prediction-based factory number (end-of-today). For core recipes this
    // drives the DPT deficit/suggestion math. For non-core recipes while
    // the feature flag is on, we fall back to the legacy formula so those
    // recipes behave identically to before.
    const isCore = r.isCoreMenu ?? false;
    const wrapRemain = remainingWrappingPacksToday[recipeId] ?? 0;
    const fulRemain = remainingFulfilmentPacksToday[recipeId] ?? 0;
    const useNewPrediction = !coreMenuOnly || isCore;
    const predictedFridgeStock = useNewPrediction
      ? Math.max(0, Math.round(fridgeStock + wrapRemain - fulRemain))
      : Math.round(fridgeStock);
    const legacyEstimatedFactoryNumber = fridgeStock - dispatch1Qty + prevProduction;
    const estimatedFactoryNumber = useNewPrediction
      ? predictedFridgeStock
      : Math.round(legacyEstimatedFactoryNumber);

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
      recipeCategory: r.recipeCategory ?? null,
      portionsPerBatch,
      packSize,
      packsPerBatch,
      tinSize: r.tinSize ?? null,
      maxBatchesPerTin: r.maxBatchesPerTin ? Number(r.maxBatchesPerTin) : null,
      sopUrl: r.sopUrl ?? null,
      color: r.color ?? null,
      isCoreMenu: isCore,
      fridgeStock: Math.round(fridgeStock),
      predictedFridgeStock,
      remainingWrappingPacksToday: Math.round(wrapRemain),
      remainingFulfilmentPacksToday: Math.round(fulRemain),
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

// ──────────────────────────────────────────────────────────────────────────────
// GET /production-plans/calculate-mac-cheese?planDate=YYYY-MM-DD
// Returns per-mac-cheese-recipe calculation data (packs-based).
// ──────────────────────────────────────────────────────────────────────────────
router.get("/calculate-mac-cheese", async (req, res) => {
  const planDate = String(req.query.planDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    res.status(400).json({ error: "planDate query param required (YYYY-MM-DD)" });
    return;
  }

  // Holiday-aware (see /calculate above for shared logic).
  const nonDispatchMc = await getNonDispatchDates();
  const getPreviousWorkingDay = (from: string): string => getPreviousDispatchDay(from, nonDispatchMc);
  const getNextWorkingDay = (from: string): string => getNextDispatchDay(from, nonDispatchMc);
  function getNextCalendarDay(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // 3 forward dispatch dates: next day, +1, +2
  const dispatch1Date = planDate;
  const dispatch2Date = getNextWorkingDay(planDate);
  const dispatch3Date = getNextWorkingDay(dispatch2Date);
  const dispatchDates = [dispatch1Date, dispatch2Date, dispatch3Date];
  const deliveryDates = dispatchDates.map(getNextCalendarDay);

  // Fetch mac cheese recipes with active DPT settings
  const macRecipes = await db
    .select({
      recipeId: recipesTable.id,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
      tinSize: recipesTable.tinSize,
      maxBatchesPerTin: recipesTable.maxBatchesPerTin,
      sopUrl: recipesTable.sopUrl,
      color: recipesTable.color,
    })
    .from(recipesTable)
    .where(eq(recipesTable.category, "Macaroni Cheese"));

  if (macRecipes.length === 0) {
    res.json({ planDate, dispatchDates, deliveryDates, recipes: [] });
    return;
  }

  // Fetch fridge stock for mac cheese recipes — production_fridge only,
  // mirroring the calzone /calculate path so the Factory Number is
  // consistent across product categories.
  const macRecipeIds = macRecipes.map(r => r.recipeId);
  const stockRows = await db
    .select({ recipeId: stockEntriesTable.recipeId, quantity: stockEntriesTable.quantity })
    .from(stockEntriesTable)
    .where(and(
      inArray(stockEntriesTable.recipeId, macRecipeIds),
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
    ))
    .orderBy(asc(stockEntriesTable.checkedAt));
  const latestStock: Record<number, number> = {};
  for (const row of stockRows) {
    if (row.recipeId != null) latestStock[row.recipeId] = Number(row.quantity);
  }

  // Load recipe → Shopify variant mappings (same source the calzone endpoint
  // uses) so mac cheese recipes can match by variant ID instead of fuzzy names.
  // Name matching alone fails when two recipes have overlapping titles (e.g.
  // "Big Nanny's Macaroni Cheese" is a substring of "Pigs & Blankets - Big
  // Nanny's Macaroni Cheese"), causing both to resolve to the same Shopify
  // product and return identical sales numbers.
  // Drizzle expands `ANY(${array})` as a row constructor `($1,$2,$3)` rather
  // than an int[], so Postgres rejects it. Fetching all mappings and filtering
  // in JS mirrors what the /calculate endpoint does and avoids the param-cast
  // footgun. A recipe can have multiple rows — the "Shopify Inventory Link"
  // panel lets users attach several variants (e.g. regular, FREE, single-pack),
  // and all of their sales should roll up into the recipe's demand.
  const macRecipeMappings = await db.execute<{ recipe_id: number; shopify_variant_id: string | null; wonky_variant_id: string | null }>(sql`
    SELECT recipe_id, shopify_variant_id, wonky_variant_id FROM recipe_shopify_mappings
  `);
  const macRecipeIdSet = new Set(macRecipeIds);
  const recipeToVariantIds = new Map<number, string[]>();
  for (const m of macRecipeMappings.rows ?? macRecipeMappings) {
    if (!macRecipeIdSet.has(m.recipe_id)) continue;
    const existing = recipeToVariantIds.get(m.recipe_id) ?? [];
    if (m.shopify_variant_id) existing.push(String(m.shopify_variant_id));
    if (m.wonky_variant_id) existing.push(String(m.wonky_variant_id));
    if (existing.length > 0) recipeToVariantIds.set(m.recipe_id, existing);
  }

  // Fetch Shopify sales for 3 delivery dates
  function normalizeForMatch(s: string): string {
    return s.toLowerCase().trim().replace(/[''`]/g, "'").replace(/&/g, "and").replace(/\s+/g, " ");
  }
  const shopifySalesPerDate: Record<string, Record<string, number>> = {};
  const variantSalesPerDate: Record<string, Record<string, number>> = {};
  let shopifyError: string | null = null;
  try {
    const results = await Promise.allSettled(
      deliveryDates.map(date => countProductsByTag(date).then(products => ({ date, products })))
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.warn(`[calculate-mac-cheese] Shopify fetch for ${deliveryDates[i]} failed:`, result.reason?.message ?? result.reason);
        continue;
      }
      const { date, products } = result.value;
      shopifySalesPerDate[date] = {};
      variantSalesPerDate[date] = {};
      for (const p of products) {
        // Mac cheese sold as 2-packs same as calzones
        const twoPackVariant = p.variants.find(v => {
          const t = v.title.toLowerCase();
          return t.includes("2 pack") || t.includes("2-pack") || t === "2pack" || t.includes("serves 2");
        });
        if (twoPackVariant) {
          const key = normalizeForMatch(p.productTitle);
          shopifySalesPerDate[date][key] = (shopifySalesPerDate[date][key] ?? 0) + twoPackVariant.quantity;
          if (twoPackVariant.variantId) {
            const vid = String(twoPackVariant.variantId);
            variantSalesPerDate[date][vid] = (variantSalesPerDate[date][vid] ?? 0) + twoPackVariant.quantity;
          }
        }
        // Also record non-2-pack variants by ID so mapped recipes can still
        // resolve sales if the mapping points at a different variant shape.
        for (const v of p.variants) {
          if (v !== twoPackVariant && v.variantId) {
            const vid = String(v.variantId);
            variantSalesPerDate[date][vid] = (variantSalesPerDate[date][vid] ?? 0) + v.quantity;
          }
        }
      }
    }
  } catch (err: any) {
    shopifyError = err.message ?? "Unknown error";
  }

  // Variant ID match is authoritative when available; otherwise fall back to
  // closest-length name matching (preserves prior behaviour for unmapped mac
  // recipes).
  function matchSalesForDate(recipeId: number, recipeName: string, date: string): number {
    const variantIds = recipeToVariantIds.get(recipeId);
    if (variantIds && variantIds.length > 0) {
      const dateSales = variantSalesPerDate[date] ?? {};
      let total = 0;
      for (const vid of variantIds) total += dateSales[vid] ?? 0;
      if (total > 0) return total;
    }
    const recipeNorm = normalizeForMatch(recipeName);
    const salesForDate = shopifySalesPerDate[date] ?? {};
    let bestQty = 0;
    let bestLenDiff = Infinity;
    for (const [productTitle, qty] of Object.entries(salesForDate)) {
      const productNorm = normalizeForMatch(productTitle);
      if (productNorm.includes(recipeNorm) || recipeNorm.includes(productNorm)) {
        const lenDiff = Math.abs(productNorm.length - recipeNorm.length);
        if (lenDiff < bestLenDiff) {
          bestLenDiff = lenDiff;
          bestQty = qty;
        }
      }
    }
    return bestQty;
  }

  // Fetch per-recipe extra-to-make defaults from app_settings
  const extraSettingKeys = macRecipeIds.map(id => `mac_cheese_extra_packs_${id}`);
  const extraSettings = extraSettingKeys.length > 0
    ? await db.select().from(appSettingsTable).where(inArray(appSettingsTable.key, extraSettingKeys))
    : [];
  const extraMap: Record<number, number> = {};
  for (const s of extraSettings) {
    const match = s.key.match(/mac_cheese_extra_packs_(\d+)/);
    if (match) extraMap[Number(match[1])] = Number(s.value) || 0;
  }

  // Thursday = 4 (day of week). On Thursday, default extra to 0 (last prod day before weekend)
  const planDayOfWeek = new Date(`${planDate}T12:00:00Z`).getUTCDay();
  const isThursday = planDayOfWeek === 4;

  const recipes = macRecipes.map(r => {
    const portionsPerBatch = Number(r.portionsPerBatch) || 10;
    const packSize = Number(r.packSize) || 1;
    const packsPerBatch = portionsPerBatch / packSize;
    const leftOverStock = latestStock[r.recipeId] ?? 0;

    const salesNextDay = matchSalesForDate(r.recipeId, r.recipeName ?? "", deliveryDates[0]);
    const salesNextDayPlus1 = matchSalesForDate(r.recipeId, r.recipeName ?? "", deliveryDates[1]);
    const salesNextDayPlus2 = matchSalesForDate(r.recipeId, r.recipeName ?? "", deliveryDates[2]);

    const neededForDispatch = Math.max(0, salesNextDay - leftOverStock);
    const defaultExtra = extraMap[r.recipeId] ?? 5;
    const extraToMake = isThursday ? 0 : defaultExtra;

    const toMakePacks = neededForDispatch + salesNextDayPlus1 + salesNextDayPlus2 + extraToMake;
    const toMakeBatches = packsPerBatch > 0 ? Math.ceil(toMakePacks / packsPerBatch) : 0;

    return {
      recipeId: r.recipeId,
      recipeName: r.recipeName ?? "",
      color: r.color ?? null,
      portionsPerBatch,
      packSize,
      packsPerBatch,
      tinSize: r.tinSize ?? null,
      maxBatchesPerTin: r.maxBatchesPerTin ? Number(r.maxBatchesPerTin) : null,
      sopUrl: r.sopUrl ?? null,
      leftOverStock: Math.round(leftOverStock),
      salesNextDay,
      salesNextDayPlus1,
      salesNextDayPlus2,
      neededForDispatch,
      extraToMake,
      toMakePacks,
      toMakeBatches,
    };
  });

  res.json({ planDate, dispatchDates, deliveryDates, shopifyError, recipes });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /production-plans/:id/add-mac-cheese
// Add macaroni cheese items to an already-locked production plan.
// ──────────────────────────────────────────────────────────────────────────────
const AddMacCheeseBody = z.object({
  items: z.array(z.object({
    recipeId: z.number(),
    packsToMake: z.number().int().min(0),
  })),
});

router.post("/:id/add-mac-cheese", validate(AddMacCheeseBody), async (req, res) => {
  const planId = Number(req.params.id);
  const { items } = req.body;

  // 1. Verify plan exists and is in a modifiable locked status
  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  const allowedStatuses = ["draft", "active", "prep", "building"];
  if (!allowedStatuses.includes(plan.status)) {
    res.status(409).json({ error: `Plan status '${plan.status}' does not allow adding mac cheese items. Must be active, prep, or building.` });
    return;
  }

  // 2. Verify all recipes are Macaroni Cheese
  const recipeIds = items.map(i => i.recipeId);
  if (recipeIds.length === 0) { res.status(400).json({ error: "No items provided" }); return; }

  const recipeRows = await db
    .select({ id: recipesTable.id, category: recipesTable.category, portionsPerBatch: recipesTable.portionsPerBatch, packSize: recipesTable.packSize, tinSize: recipesTable.tinSize, maxBatchesPerTin: recipesTable.maxBatchesPerTin, sopUrl: recipesTable.sopUrl })
    .from(recipesTable)
    .where(inArray(recipesTable.id, recipeIds));

  const recipeMap = new Map(recipeRows.map(r => [r.id, r]));
  for (const item of items) {
    const recipe = recipeMap.get(item.recipeId);
    if (!recipe) { res.status(400).json({ error: `Recipe ${item.recipeId} not found` }); return; }
    if (recipe.category !== "Macaroni Cheese") {
      res.status(400).json({ error: `Recipe ${item.recipeId} is not a Macaroni Cheese recipe` });
      return;
    }
  }

  // 3. Reconcile against existing Macaroni Cheese items in this plan.
  // We treat the submitted list as the desired final state for mac cheese
  // items in this plan (so the Edit flow works — user edits counts, removes
  // recipes, and the plan ends up matching exactly what they submitted).
  //
  //   • Existing mac cheese item + submitted  → UPDATE batches_target
  //   • Submitted recipe not yet in plan      → INSERT new item
  //   • Existing mac cheese item NOT submitted → DELETE if no work in
  //     progress (batches_complete = 0 AND status = 'pending'); otherwise
  //     leave alone and report back to the client.
  const existingMacItems = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      batchesComplete: productionPlanItemsTable.batchesComplete,
      status: productionPlanItemsTable.status,
    })
    .from(productionPlanItemsTable)
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(
      eq(productionPlanItemsTable.planId, planId),
      eq(recipesTable.category, "Macaroni Cheese"),
    ));

  const existingByRecipeId = new Map(existingMacItems.map(e => [e.recipeId, e]));
  const submittedRecipeIds = new Set(items.map(i => i.recipeId));

  // 4. Newly inserted mac cheese rows default to the top of the production
  //    queue because the kitchen makes mac cheese before calzones. Shift
  //    every existing row down by the number of new inserts so positions
  //    1..N are free for the new mac cheese rows. Existing rows (including
  //    existing mac cheese) keep their relative order and can still be
  //    reordered by hand afterwards.
  const newInsertCount = items.filter(
    i => i.packsToMake > 0 && !existingByRecipeId.has(i.recipeId),
  ).length;
  if (newInsertCount > 0) {
    await db
      .update(productionPlanItemsTable)
      .set({ orderPosition: sql`${productionPlanItemsTable.orderPosition} + ${newInsertCount}` })
      .where(eq(productionPlanItemsTable.planId, planId));
  }
  let nextPos = 1;

  const skippedInProgress: number[] = [];

  // 5a. UPDATE existing items and INSERT new ones based on submitted list
  for (const item of items.filter(i => i.packsToMake > 0)) {
    const recipe = recipeMap.get(item.recipeId)!;
    const portionsPerBatch = Number(recipe.portionsPerBatch) || 10;
    const packSize = Number(recipe.packSize) || 1;
    const packsPerBatch = portionsPerBatch / packSize;
    const batchesTarget = packsPerBatch > 0 ? Math.ceil(item.packsToMake / packsPerBatch) : 0;

    const existing = existingByRecipeId.get(item.recipeId);
    if (existing) {
      // Don't lower the target below what's already been built — that would
      // silently invalidate completed work. If user entered a lower target,
      // clamp to batches_complete.
      const safeTarget = Math.max(batchesTarget, existing.batchesComplete ?? 0);
      await db
        .update(productionPlanItemsTable)
        .set({ batchesTarget: safeTarget })
        .where(eq(productionPlanItemsTable.id, existing.id));
    } else {
      await db.insert(productionPlanItemsTable).values({
        planId,
        recipeId: item.recipeId,
        batchesTarget,
        orderPosition: nextPos++,
        tinSize: recipe.tinSize ?? null,
        maxBatchesPerTin: recipe.maxBatchesPerTin ?? null,
        sopUrl: recipe.sopUrl ?? null,
        status: "pending",
      });
    }
  }

  // 5b. DELETE existing mac cheese items that were removed from the list.
  // Only safe to delete if no batches have been built yet.
  for (const existing of existingMacItems) {
    if (submittedRecipeIds.has(existing.recipeId)) continue; // still present
    if ((existing.batchesComplete ?? 0) === 0 && existing.status === "pending") {
      await db.delete(productionPlanItemsTable).where(eq(productionPlanItemsTable.id, existing.id));
    } else {
      skippedInProgress.push(existing.recipeId);
    }
  }

  // 6. Return updated plan
  const updatedItems = await db
    .select({
      id: productionPlanItemsTable.id,
      planId: productionPlanItemsTable.planId,
      recipeId: productionPlanItemsTable.recipeId,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
      targetBuildSeconds: recipesTable.targetBuildSeconds,
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
      builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt,
      leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
      eightPackBagCount: productionPlanItemsTable.eightPackBagCount,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
      mixingTinOverride: productionPlanItemsTable.mixingTinOverride,
      fillWeightGrams: recipesTable.fillWeightGrams,
      baseType: recipesTable.baseType,
      baseWeightGrams: recipesTable.baseWeightGrams,
      recipeColor: recipesTable.color,
      recipeCategory: recipesTable.category,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId))
    .orderBy(productionPlanItemsTable.orderPosition);

  const itemIds = updatedItems.map(it => it.id);
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

  res.status(201).json({
    ...mapPlan(plan),
    items: updatedItems.map(it => mapItem(it, completionsByItem[it.id] ?? {})),
    skippedInProgress,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /production-plans/:id/mac-cheese-items
// Remove all macaroni cheese items from a production plan (even locked ones).
// ──────────────────────────────────────────────────────────────────────────────
router.delete("/:id/mac-cheese-items", async (req, res) => {
  const planId = Number(req.params.id);
  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

  if (plan.status === "complete") {
    res.status(409).json({ error: "Cannot modify a completed plan." });
    return;
  }

  // Find mac cheese recipe IDs
  const macRecipes = await db
    .select({ id: recipesTable.id })
    .from(recipesTable)
    .where(eq(recipesTable.category, "Macaroni Cheese"));
  const macRecipeIds = new Set(macRecipes.map(r => r.id));

  if (macRecipeIds.size === 0) { res.json({ removed: 0 }); return; }

  // Delete mac cheese items from the plan
  const macItems = await db
    .select({ id: productionPlanItemsTable.id, recipeId: productionPlanItemsTable.recipeId })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));

  const toDelete = macItems.filter(it => macRecipeIds.has(it.recipeId));
  if (toDelete.length === 0) { res.json({ removed: 0 }); return; }

  await db.delete(productionPlanItemsTable).where(
    inArray(productionPlanItemsTable.id, toDelete.map(it => it.id))
  );

  res.json({ removed: toDelete.length });
});

// GET /production-plans/next-active?afterDate=YYYY-MM-DD&for=plan|prep|dough
// Returns the next active production plan after a given date.
//
// `for` selects which column to walk:
//   - "plan"  (default, legacy behaviour) — ranks by plan_date
//   - "prep"  — ranks by prep_date so prep stations always land on the
//              plan whose prep_date is closest in the future. Means a
//              Monday plan with prep_date=Saturday only surfaces on
//              Saturday's prep view, not Friday's.
//   - "dough" — same idea for dough_date.
// Defensive default: if a row has a NULL prep_date or dough_date, it falls
// back to plan_date so legacy rows still appear somewhere instead of
// vanishing from the prep/dough timeline.
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

  const forParam = (req.query.for === "prep" || req.query.for === "dough") ? req.query.for : "plan";
  // Build the comparison expression: COALESCE(<override>, plan_date).
  // We cast to text inside drizzle's sql since both columns are DATE — the
  // string comparison works the same as date comparison for ISO YYYY-MM-DD.
  const sortExpr = forParam === "prep"
    ? sql`COALESCE(${productionPlansTable.prepDate}, ${productionPlansTable.planDate})`
    : forParam === "dough"
      ? sql`COALESCE(${productionPlansTable.doughDate}, ${productionPlansTable.planDate})`
      : sql`${productionPlansTable.planDate}`;

  // Prep / dough modes use >= so that plans whose prep day equals afterDate
  // still surface — e.g. Tuesday viewer asks "next prep" and Wednesday's plan
  // (prep_date=Tuesday) is what they should be doing today. Plan-mode keeps
  // strict > because a plan can't be "next" to itself.
  const cmpExpr = forParam === "prep" || forParam === "dough"
    ? sql`${sortExpr} >= ${afterDateStr}`
    : sql`${sortExpr} > ${afterDateStr}`;

  const plans = await db
    .select({
      id: productionPlansTable.id,
      planDate: productionPlansTable.planDate,
      prepDate: productionPlansTable.prepDate,
      doughDate: productionPlansTable.doughDate,
      name: productionPlansTable.name,
      status: productionPlansTable.status,
    })
    .from(productionPlansTable)
    .where(and(
      cmpExpr,
      inArray(productionPlansTable.status, ["draft", "active"])
    ))
    .orderBy(sql`${sortExpr} ASC`, asc(productionPlansTable.id));

  if (plans.length === 0) {
    res.json({ planId: null, planDate: null, planName: null, prepDate: null, doughDate: null, sameDayPlans: [] });
    return;
  }

  // Group by the column we walked — same prep_date / dough_date / plan_date
  // depending on `for`. Otherwise two plans whose plan_dates are the same
  // but whose prep_dates differ would get bundled together incorrectly.
  const keyOf = (p: { planDate: string; prepDate: string | null; doughDate: string | null }): string =>
    forParam === "prep" ? (p.prepDate ?? p.planDate)
      : forParam === "dough" ? (p.doughDate ?? p.planDate)
      : p.planDate;
  const firstKey = keyOf(plans[0]);
  const sameDayPlans = plans.filter(p => keyOf(p) === firstKey).map(p => ({ planId: p.id, planName: p.name }));

  res.json({
    planId: plans[0].id,
    planDate: plans[0].planDate,
    planName: plans[0].name,
    prepDate: plans[0].prepDate ?? null,
    doughDate: plans[0].doughDate ?? null,
    status: plans[0].status,
    sameDayPlans: sameDayPlans.length > 1 ? sameDayPlans : [],
  });
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

  const stockIngredientsRaw = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      stockCheckFrequency: ingredientsTable.stockCheckFrequency,
      stockCheckDay: ingredientsTable.stockCheckDay,
      stockInPacks: ingredientsTable.stockInPacks,
      packWeight: ingredientsTable.packWeight,
    })
    .from(ingredientsTable)
    .where(eq(ingredientsTable.stockCheckEnabled, true))
    .orderBy(ingredientsTable.name);

  const stockIngredients = stockIngredientsRaw.map(i => ({
    ...i,
    packWeight: i.packWeight != null ? Number(i.packWeight) : null,
  }));

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

    // Also update stock_entries so storage location stays in sync
    const [ingredient] = await db
      .select({ unit: ingredientsTable.unit, category: ingredientsTable.category })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, ingredientId))
      .limit(1);

    if (ingredient) {
      // Raw materials never go in production_fridge (finished product only) —
      // chilled ingredients route to prep_fridge, raw meat to raw_meat_fridge,
      // dry goods to dry_store. Kept in sync with deliveries.ts and
      // orders.ts /stock-check (see commit 30810ce).
      const locationMap: Record<string, string> = {
        vegetable: "prep_fridge",
        herb: "prep_fridge",
        base: "prep_fridge",
        dairy: "prep_fridge",
        cheese: "prep_fridge",
        cooked_meat: "prep_fridge",
        raw_meat: "raw_meat_fridge",
        meat: "raw_meat_fridge",
        sauce: "dry_store",
        spice: "dry_store",
        seasoning: "dry_store",
        other: "dry_store",
        dough: "dry_store",
        frozen: "production_freezer",
        dry: "dry_store",
      };
      const location = locationMap[ingredient.category ?? ""] ?? "prep_fridge";

      await db.insert(stockEntriesTable).values({
        ingredientId,
        itemType: "ingredient",
        quantity: String(quantity),
        unit: ingredient.unit ?? "kg",
        location,
        checkedAt: new Date(),
      });
    }

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
      targetBuildSeconds: recipesTable.targetBuildSeconds,
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
      builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt,
      leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
      eightPackBagCount: productionPlanItemsTable.eightPackBagCount,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
      mixingTinOverride: productionPlanItemsTable.mixingTinOverride,
      fillWeightGrams: recipesTable.fillWeightGrams,
      baseType: recipesTable.baseType,
      baseWeightGrams: recipesTable.baseWeightGrams,
      recipeColor: recipesTable.color,
      recipeCategory: recipesTable.category,
      dietaryCategory: recipesTable.dietaryCategory,
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
  const { planDate, prepDate, doughDate, name, notes, status, items } = req.body;

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
  if (prepDate !== undefined) setPlan.prepDate = prepDate ?? null;
  if (doughDate !== undefined) setPlan.doughDate = doughDate ?? null;
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

  // Lock enforcement: fetch current items and verify no completed item changes position (unless admin).
  // "in-progress" items are still moveable to match the frontend's locking behaviour
  // (only building-started and complete items are pinned).
  if (sessionUserRole !== "admin") {
    const existingItems = await db.select({ id: productionPlanItemsTable.id, orderPosition: productionPlanItemsTable.orderPosition, status: productionPlanItemsTable.status })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, id));

    for (const locked of existingItems.filter(it => it.status === "complete")) {
      const newPos = order.find(o => o.itemId === locked.id)?.orderPosition;
      if (newPos !== undefined && newPos !== locked.orderPosition) {
        res.status(409).json({ error: `Completed recipe cannot be repositioned` });
        return;
      }
    }
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
  const { planItemId, stationType, startedAt, completedAt, actualWeightG } = req.body;
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }

  // Verify that the planItemId belongs to this plan (prevent cross-plan contamination)
  const [planItem] = await db.select({
    id: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
    batchesComplete: productionPlanItemsTable.batchesComplete,
    batchesTarget: productionPlanItemsTable.batchesTarget,
    extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt,
    shortCount: productionPlanItemsTable.shortCount,
    builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt,
    leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
    portionsPerBatch: recipesTable.portionsPerBatch,
    packSize: recipesTable.packSize,
    recipeCategory: recipesTable.category,
  })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  // Oven-station batches require an actual pack weight (g) so HACCP cooling
  // data and weight variance can be tracked per batch — except Macaroni
  // Cheese, which doesn't go through the calzone weighing flow at all
  // (HACCP anchor comes from the post-cheese-sauce temperature record).
  const isMacCheeseRecipe = planItem.recipeCategory === "Macaroni Cheese";
  if (stationType === "ovens" && !isMacCheeseRecipe) {
    const w = Number(actualWeightG);
    if (!Number.isFinite(w) || w < 100 || w > 2000) {
      res.status(400).json({ error: "actualWeightG is required for oven batches and must be between 100–2000g" });
      return;
    }
  }

  // Once the builder has marked this recipe complete, the building pipeline
  // is locked. Downstream stations (ovens, wrapping) must still be allowed to
  // catch up to the truncated output — their effective cap is enforced by the
  // cascade check below (prevCount from building stations).
  if (planItem.builderMarkedCompleteAt && stationType !== "ovens" && stationType !== "wrapping") {
    res.status(409).json({ error: "Recipe was marked complete by the builder" });
    return;
  }

  // Effective target: raw plan target (the ceiling-math path is deprecated —
  // builders now use the Mark Recipe Complete override for under-runs).
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

    // Combined building count check: building_1 + building_2 must not exceed target
    if (stationType === "building_1" || stationType === "building_2") {
      const combinedResult = await db.execute(sql`
        SELECT COUNT(*)::int as cnt FROM batch_completions
        WHERE plan_item_id = ${Number(planItemId)}
          AND station_type IN ('building_1', 'building_2')
      `);
      const combinedCount = (combinedResult.rows[0] as { cnt: number })?.cnt ?? 0;
      if (combinedCount >= target) {
        res.status(409).json({ error: "Batch target already met" });
        return;
      }
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

  const isBuilding = stationType === "building_1" || stationType === "building_2";

  const result = await db.execute(sql`
    WITH station_check AS (
      SELECT COUNT(*)::int as cnt FROM batch_completions
      WHERE plan_item_id = ${Number(planItemId)}
        AND station_type = ${stationType ?? ''}
    ),
    combined_check AS (
      SELECT COUNT(*)::int as cnt FROM batch_completions
      WHERE plan_item_id = ${Number(planItemId)}
        AND station_type IN ('building_1', 'building_2')
    ),
    incremented AS (
      UPDATE production_plan_items
      SET
        batches_complete = CASE WHEN ${isWrapping}::boolean THEN batches_complete + 1 ELSE batches_complete END,
        status = 'in-progress'
      WHERE id = ${Number(planItemId)}
        AND (${target} = 0 OR (SELECT cnt FROM station_check) < ${target})
        AND (NOT ${isBuilding}::boolean OR ${target} = 0 OR (SELECT cnt FROM combined_check) < ${target})
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

  // Oven-station weight record — written after the batch_completions row lands
  // so failed caps don't create orphan weight rows. Target = pack_size × portion
  // cooked weight + tray weight. `is_last_batch_of_recipe` flips on the batch
  // whose new oven count equals the effective target (post-builder-complete
  // the target is the combined building count).
  if (stationType === "ovens" && planItem.recipeId && !isMacCheeseRecipe) {
    try {
      const settings = await getWeightAppSettings();
      const { portionWeightG } = await computePortionWeightG(planItem.recipeId);
      const packSize = Math.max(1, Math.round(Number(planItem.packSize ?? 2)));
      const targetWeightG = Math.round(packSize * portionWeightG + settings.trayWeightG);
      const actualW = Math.round(Number(actualWeightG) * 100) / 100;
      const varianceG = Math.round((actualW - targetWeightG) * 100) / 100;
      const withinTolerance = varianceG >= -settings.toleranceUnderG && varianceG <= settings.toleranceOverG;

      // Count ovens completions for this plan item (just inserted above).
      const ovenCountRes = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM batch_completions
        WHERE plan_item_id = ${Number(planItemId)} AND station_type = 'ovens'
      `);
      const ovenCount = (ovenCountRes.rows[0] as { cnt: number })?.cnt ?? 0;

      // Effective target mirrors effectiveBatchesTarget() on the client:
      // if the builder marked complete, the ceiling is the combined building count.
      let effectiveTarget = planItem.batchesTarget ?? 0;
      if (planItem.builderMarkedCompleteAt) {
        const buildRes = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM batch_completions
          WHERE plan_item_id = ${Number(planItemId)}
            AND station_type IN ('building_1', 'building_2')
        `);
        effectiveTarget = (buildRes.rows[0] as { cnt: number })?.cnt ?? effectiveTarget;
      }
      const isLastBatchOfRecipe = effectiveTarget > 0 && ovenCount >= effectiveTarget;

      await db.insert(batchWeightRecordsTable).values({
        planId,
        planItemId: Number(planItemId),
        recipeId: planItem.recipeId,
        batchSequence: ovenCount,
        trayWeightG: String(settings.trayWeightG),
        portionWeightG: String(portionWeightG),
        packSize,
        targetWeightG: String(targetWeightG),
        actualWeightG: String(actualW),
        varianceG: String(varianceG),
        toleranceUnderG: String(settings.toleranceUnderG),
        toleranceOverG: String(settings.toleranceOverG),
        withinTolerance,
        isLastBatchOfRecipe,
        userId: sessionUserId,
      });
    } catch (err) {
      console.error("[batch-completions] weight record insert failed:", err);
    }
  }

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
  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  const [planItem] = await db.select({
    id: productionPlanItemsTable.id,
    batchesTarget: productionPlanItemsTable.batchesTarget,
    extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt,
    shortCount: productionPlanItemsTable.shortCount,
    builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt,
    leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
    portionsPerBatch: recipesTable.portionsPerBatch,
  })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  // Builder has locked in a truncated output. Downstream stations (ovens,
  // wrapping) may still catch up to the truncated count; earlier stations are
  // blocked. The cascade check below enforces the ovens/wrapping cap.
  if (planItem.builderMarkedCompleteAt && stationType !== "ovens" && stationType !== "wrapping") {
    res.status(409).json({ error: "Recipe was marked complete by the builder" });
    return;
  }

  // Use batchesTarget directly as the cap. Extra packs don't create extra batch slots.
  const target = planItem.batchesTarget ?? 0;

  if (stationType && target > 0) {
    // For building stations, check COMBINED count across both tables (they share the target).
    // For other stations, check per-station count.
    const isBuildingType = stationType === "building_1" || stationType === "building_2";
    const stationCountResult = await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM batch_completions
      WHERE plan_item_id = ${Number(planItemId)}
        AND ${isBuildingType
          ? sql`station_type IN ('building_1', 'building_2')`
          : sql`station_type = ${stationType}`}
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
  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
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

// POST /:id/station-changeovers — record changeover time when builder finishes checklist
router.post("/:id/station-changeovers", async (req, res) => {
  const planId = Number(req.params.id);
  const { planItemId, stationType, recipeId, startedAt, completedAt, durationMs } = req.body;
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  // Verify planItemId belongs to this plan
  const [planItem] = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, Number(planItemId)), eq(productionPlanItemsTable.planId, planId)));
  if (!planItem) {
    res.status(400).json({ error: "planItemId does not belong to this plan" });
    return;
  }

  const [row] = await db.insert(stationChangeoversTable).values({
    planItemId: Number(planItemId),
    stationType: stationType ?? "",
    userId: sessionUserId,
    recipeId: Number(recipeId),
    startedAt: startedAt ? new Date(startedAt) : new Date(),
    completedAt: completedAt ? new Date(completedAt) : new Date(),
    durationMs: durationMs != null ? Number(durationMs) : null,
  }).returning();

  res.status(201).json(row);
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
  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
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

  // Oven undo — drop the matching weight record too so the HACCP log stays
  // aligned. The highest batch_sequence for this plan item is the one we
  // just rolled back. Also clear is_last_batch_of_recipe (the previous batch
  // may now be the final one, but we don't re-promote retrospectively —
  // the client will re-submit when the operator adds a replacement batch).
  if (stationType === "ovens") {
    await db.execute(sql`
      DELETE FROM batch_weight_records
      WHERE id = (
        SELECT id FROM batch_weight_records
        WHERE plan_item_id = ${Number(planItemId)}
        ORDER BY batch_sequence DESC, recorded_at DESC
        LIMIT 1
      )
    `);
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

// ──────────────────────────────────────────────────────────────────────────────
// Batch weight records — HACCP cooling log + oven-pack weight variance
// ──────────────────────────────────────────────────────────────────────────────

async function getWeightAppSettings(): Promise<{
  trayWeightG: number;
  chillTargetTempC: number;
  toleranceUnderG: number;
  toleranceOverG: number;
}> {
  const rows = await db.select().from(appSettingsTable).where(inArray(appSettingsTable.key, [
    "tray_weight_g",
    "chill_target_temp_c",
    "weight_tolerance_under_g",
    "weight_tolerance_over_g",
  ]));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    trayWeightG: Number(map["tray_weight_g"] ?? 36),
    chillTargetTempC: Number(map["chill_target_temp_c"] ?? 4),
    toleranceUnderG: Number(map["weight_tolerance_under_g"] ?? 0),
    toleranceOverG: Number(map["weight_tolerance_over_g"] ?? 0),
  };
}

/** Convert a quantity to grams based on the ingredient's storage unit.
 *  Weight/volume units normalize to grams; countable units are ignored for
 *  weight-sum purposes since we don't have item-weight data to expand them. */
function quantityToGrams(quantity: number, unit: string | null | undefined): number {
  if (!Number.isFinite(quantity)) return 0;
  const u = (unit ?? "").toLowerCase().trim();
  if (u === "kg" || u === "l" || u === "litre" || u === "liter") return quantity * 1000;
  if (u === "g" || u === "ml") return quantity;
  return 0; // each / unit / unknown
}

/** Compute per-portion cooked weight (g) by summing the recipe's direct
 *  ingredients and sub-recipe links. Recipe ingredient quantities and
 *  sub-recipe link quantities are stored per-portion (matching the "INGREDIENTS
 *  (cooked qty)" view in the recipe editor); each is normalized to grams via
 *  its ingredient.unit / sub_recipe.yield_unit. No further cooking-loss
 *  reduction — the stored values are already cooked quantities. */
async function computePortionWeightG(recipeId: number): Promise<{ portionWeightG: number; portionsPerBatch: number; }> {
  const [recipe] = await db.select({
    portionsPerBatch: recipesTable.portionsPerBatch,
  }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  const portionsPerBatch = recipe?.portionsPerBatch ?? 10;

  let perPortionG = 0;

  const directs = await db.select({
    quantity: recipeIngredientsTable.quantity,
    unit: ingredientsTable.unit,
  })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));

  for (const d of directs) {
    perPortionG += quantityToGrams(Number(d.quantity), d.unit);
  }

  const subs = await db.select({
    quantity: recipeSubRecipesTable.quantity,
    yieldUnit: subRecipesTable.yieldUnit,
  })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(eq(recipeSubRecipesTable.recipeId, recipeId));

  for (const s of subs) {
    perPortionG += quantityToGrams(Number(s.quantity), s.yieldUnit);
  }

  return { portionWeightG: Math.round(perPortionG), portionsPerBatch };
}

// GET /:id/weight-targets — per-recipe target weight for oven-station batch
// weighing, plus all existing batch_weight_records for the plan and current
// app-settings (tray weight + tolerances + chill target temp).
router.get("/:id/weight-targets", async (req, res) => {
  const planId = Number(req.params.id);
  if (!Number.isFinite(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }

  const settings = await getWeightAppSettings();

  const items = await db.select({
    itemId: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
    recipeName: recipesTable.name,
    packSize: recipesTable.packSize,
  })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  const targets: Array<{
    planItemId: number;
    recipeId: number;
    recipeName: string | null;
    packSize: number;
    portionWeightG: number;
    trayWeightG: number;
    targetWeightG: number;
  }> = [];

  for (const it of items) {
    if (!it.recipeId) continue;
    try {
      const { portionWeightG } = await computePortionWeightG(it.recipeId);
      const packSize = Math.max(1, Math.round(Number(it.packSize ?? 2)));
      const targetWeightG = Math.round(packSize * portionWeightG + settings.trayWeightG);
      targets.push({
        planItemId: it.itemId,
        recipeId: it.recipeId,
        recipeName: it.recipeName,
        packSize,
        portionWeightG,
        trayWeightG: settings.trayWeightG,
        targetWeightG,
      });
    } catch (err) {
      console.warn(`[weight-targets] failed for recipe ${it.recipeId}:`, err);
    }
  }

  const records = await db.select().from(batchWeightRecordsTable)
    .where(eq(batchWeightRecordsTable.planId, planId))
    .orderBy(asc(batchWeightRecordsTable.recordedAt));

  res.json({
    settings,
    targets,
    records: records.map(r => ({
      id: r.id,
      planItemId: r.planItemId,
      recipeId: r.recipeId,
      batchSequence: r.batchSequence,
      trayWeightG: Number(r.trayWeightG),
      portionWeightG: Number(r.portionWeightG),
      packSize: r.packSize,
      targetWeightG: Number(r.targetWeightG),
      actualWeightG: Number(r.actualWeightG),
      varianceG: Number(r.varianceG),
      toleranceUnderG: Number(r.toleranceUnderG),
      toleranceOverG: Number(r.toleranceOverG),
      withinTolerance: r.withinTolerance,
      isLastBatchOfRecipe: r.isLastBatchOfRecipe,
      chillEndAt: r.chillEndAt?.toISOString() ?? null,
      chilledByUserId: r.chilledByUserId,
      chilledVia: r.chilledVia,
      userId: r.userId,
      recordedAt: r.recordedAt.toISOString(),
    })),
  });
});

// POST /:id/items/:itemId/mark-chilled — stamp chill_end_at on the last-batch
// record for this recipe/plan. Idempotent: no-op if already chilled. Returns
// { chilled: true, alreadyChilled: boolean, chillEndAt }.
router.post("/:id/items/:itemId/mark-chilled", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { source } = req.body ?? {};
  const chilledVia = source === "wrapping_station" ? "wrapping_station"
    : source === "wrapping_complete_auto" ? "wrapping_complete_auto"
    : "oven_station";
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    recipeId: productionPlanItemsTable.recipeId,
    recipeCategory: recipesTable.category,
  })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  let [lastBatchRow] = await db.select().from(batchWeightRecordsTable)
    .where(and(
      eq(batchWeightRecordsTable.planId, planId),
      eq(batchWeightRecordsTable.recipeId, item.recipeId),
      eq(batchWeightRecordsTable.isLastBatchOfRecipe, true),
    ))
    .limit(1);

  if (!lastBatchRow) {
    // Mac cheese skips the oven weight-log flow, so no batch weight record
    // exists. Anchor the chill timer to the post-cheese sauce temperature
    // (the last hot checkpoint before packs go into the blast chiller) and
    // synthesize a batch weight record so the chill-end stamp and audit
    // trail share the same shape as calzone recipes.
    if (item.recipeCategory !== MAC_CHEESE_CATEGORY) {
      res.status(409).json({ error: "Last batch for this recipe has not been logged yet" });
      return;
    }
    const [postCheese] = await db.select().from(temperatureRecordsTable)
      .where(and(
        eq(temperatureRecordsTable.planId, planId),
        eq(temperatureRecordsTable.recordType, "mac_sauce_post_cheese"),
      ))
      .orderBy(asc(temperatureRecordsTable.recordedAt))
      .limit(1);
    if (!postCheese) {
      res.status(409).json({ error: "Record the post-cheese sauce temperature before marking chilled." });
      return;
    }
    const [created] = await db.insert(batchWeightRecordsTable).values({
      planId,
      planItemId: itemId,
      recipeId: item.recipeId,
      batchSequence: 0,
      trayWeightG: "0",
      portionWeightG: "0",
      packSize: 1,
      targetWeightG: "0",
      actualWeightG: "0",
      varianceG: "0",
      toleranceUnderG: "0",
      toleranceOverG: "0",
      withinTolerance: true,
      isLastBatchOfRecipe: true,
      userId: sessionUserId,
      recordedAt: postCheese.recordedAt,
    }).returning();
    lastBatchRow = created;
  }

  if (lastBatchRow.chillEndAt) {
    res.json({
      chilled: true,
      alreadyChilled: true,
      chillEndAt: lastBatchRow.chillEndAt.toISOString(),
      chilledVia: lastBatchRow.chilledVia,
    });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(batchWeightRecordsTable)
    .set({
      chillEndAt: now,
      chilledByUserId: sessionUserId,
      chilledVia,
    })
    .where(eq(batchWeightRecordsTable.id, lastBatchRow.id))
    .returning();

  res.json({
    chilled: true,
    alreadyChilled: false,
    chillEndAt: updated.chillEndAt?.toISOString() ?? null,
    chilledVia: updated.chilledVia,
  });
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

  // Single record for the station the user is actually on
  const ts = startedAt ? new Date(startedAt) : new Date();
  const [row] = await db.insert(stationBreaksTable).values({
    planId,
    stationType,
    userId: sessionUserId,
    breakType: breakType ?? "morning",
    startedAt: ts,
  }).returning();

  res.status(201).json({ ...row, startedAt: row.startedAt.toISOString(), endedAt: null });
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
    stockCheckEnabled: boolean;
    stockCheckFrequency: string;
    stockCheckDay: string | null;
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
          stockCheckEnabled: ing.stockCheckEnabled ?? false,
          stockCheckFrequency: ing.stockCheckFrequency ?? "daily",
          stockCheckDay: ing.stockCheckDay ?? null,
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

  // Add extra tomato base surplus — resolve sub-recipe #2 ingredients scaled to the extra kg
  const [extraTbSetting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "extra_tomato_base_kg"));
  const extraTbKg = extraTbSetting ? Number(extraTbSetting.value) || 0 : 0;
  if (extraTbKg > 0) {
    const extraIngredients = await resolveSubRecipeIngredients(2, extraTbKg, new Set());
    const extraAgg = aggregateIngredients(extraIngredients);
    for (const [iid, ing] of extraAgg) {
      const totalCookedQty = ing.quantityPerBatch; // already scaled to extraTbKg
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
          stockCheckEnabled: ing.stockCheckEnabled ?? false,
          stockCheckFrequency: ing.stockCheckFrequency ?? "daily",
          stockCheckDay: ing.stockCheckDay ?? null,
          totalCookedQty: 0,
          totalRawQty: 0,
          prepQty: 0,
          trayCount: null,
          recipes: [],
        };
      }
      aggregated[iid].totalCookedQty += totalCookedQty;
      aggregated[iid].totalRawQty += totalRawQty;
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
    res.json({ recipes: [], pastaCooking: { waterLPerKg: 0, saltGPerKg: 0 } });
    return;
  }

  // Pasta cooking rates — same settings Main Prep reads for its synthetic
  // water+salt rows. Per-recipe pasta kg is emitted below; the client
  // multiplies by the rates to show water/salt requirements.
  const pastaSettingsRows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, ["pasta_cooking_water_l_per_kg", "pasta_cooking_salt_g_per_kg"]));
  const pastaSettingsMap = new Map(pastaSettingsRows.map(r => [r.key, r.value]));
  const pastaWaterLPerKg = Number(pastaSettingsMap.get("pasta_cooking_water_l_per_kg") ?? 6);
  const pastaSaltGPerKg = Number(pastaSettingsMap.get("pasta_cooking_salt_g_per_kg") ?? 60);

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
      stockCheckEnabled: boolean;
      stockCheckFrequency: string;
      stockCheckDay: string | null;
      cookedQty: number;
      rawQty: number;
      prepQty: number;
      isRawMeat: boolean;
      isSeasoning: boolean;
      trayCount: number | null;
      prepCountPerPortion: number | null;
      pieceCount: number | null;
      stockInPacks: boolean;
      packWeight: number | null;
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

    let pastaKg = 0;
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

      // Pasta accumulator — raw kg of pasta-category ingredients, per recipe.
      // Used by the client to compute cooking water + salt from the rates.
      if (category === "pasta") {
        const rawKg = ing.unit === "kg" ? roundedRaw : ing.unit === "g" ? roundedRaw / 1000 : 0;
        pastaKg += rawKg;
      }

      // When an ingredient is configured with "Prep count per portion"
      // (e.g. Pigs & Blankets = 2 per portion), the cook doesn't want a kg
      // on the prep sheet — they want a whole-piece count. Match the same
      // logic main-prep already applies: pieceCount = portions × setting,
      // rounded up so half-pieces don't appear.
      const portionsTotal = portionsPerBatch * batchesTarget;
      const pieceCount = ing.prepCountPerPortion != null && ing.prepCountPerPortion > 0
        ? Math.ceil(portionsTotal * ing.prepCountPerPortion)
        : null;

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
        stockCheckEnabled: ing.stockCheckEnabled ?? false,
        stockCheckFrequency: ing.stockCheckFrequency ?? "daily",
        stockCheckDay: ing.stockCheckDay ?? null,
        cookedQty: roundedCooked,
        rawQty: roundedRaw,
        prepQty: ing.prepWeightMode === "processed" ? roundedCooked : roundedRaw,
        isRawMeat: category === "raw_meat",
        isSeasoning: false,
        prepCountPerPortion: ing.prepCountPerPortion,
        pieceCount,
        trayCount: null,
        stockInPacks: ing.stockInPacks,
        packWeight: ing.packWeight,
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
      const marinadeTargetAlias = alias(ingredientsTable, "marinadeTarget");
      const marinadeIngRows = await db
        .select({
          ingredientId: recipeIngredientsTable.ingredientId,
          ingredientName: ingredientsTable.name,
          quantity: recipeIngredientsTable.quantity,
          unit: ingredientsTable.unit,
          marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
          targetCategory: marinadeTargetAlias.category,
        })
        .from(recipeIngredientsTable)
        .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
        .leftJoin(marinadeTargetAlias, eq(recipeIngredientsTable.marinadeForIngredientId, marinadeTargetAlias.id))
        .where(eq(recipeIngredientsTable.recipeId, planItem.recipeId));

      for (const mr of marinadeIngRows) {
        if (!mr.marinadeForIngredientId) continue;
        if (mr.targetCategory !== "raw_meat") continue;
        hasRelevantIngredients = true;
        const totalQty = Number(mr.quantity) * portionsPerBatch * batchesTarget;
        const totalGrams = mr.unit === "kg" ? Math.round(totalQty * 1000) : Math.round(totalQty);
        marinades.push({
          rawMeatIngredientId: mr.marinadeForIngredientId,
          marinadeIngredientId: mr.ingredientId,
          marinadeIngredientName: mr.ingredientName ?? null,
          marinadeSubRecipeId: null,
          marinadeSubRecipeName: null,
          totalGrams,
        });
      }

      const marinadeSubTargetAlias = alias(ingredientsTable, "marinadeSubTarget");
      const marinadeSubRows = await db
        .select({
          subRecipeId: recipeSubRecipesTable.subRecipeId,
          subRecipeName: subRecipesTable.name,
          quantity: recipeSubRecipesTable.quantity,
          marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
          targetCategory: marinadeSubTargetAlias.category,
        })
        .from(recipeSubRecipesTable)
        .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
        .leftJoin(marinadeSubTargetAlias, eq(recipeSubRecipesTable.marinadeForIngredientId, marinadeSubTargetAlias.id))
        .where(eq(recipeSubRecipesTable.recipeId, planItem.recipeId));

      for (const sr of marinadeSubRows) {
        if (!sr.marinadeForIngredientId) continue;
        if (sr.targetCategory !== "raw_meat") continue;
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
        const oldRawMeatAlias = alias(ingredientsTable, "oldRawMeat");
        const oldMarinadeRows = await db
          .select({
            rawMeatIngredientId: recipeMeatMarinadesTable.rawMeatIngredientId,
            marinadeIngredientId: recipeMeatMarinadesTable.marinadeIngredientId,
            marinadeIngredientName: oldMarinadeIngAlias.name,
            marinadeSubRecipeId: recipeMeatMarinadesTable.marinadeSubRecipeId,
            marinadeSubRecipeName: oldMarinadeSubAlias.name,
            gramsPerKg: recipeMeatMarinadesTable.gramsPerKg,
            rawMeatCategory: oldRawMeatAlias.category,
          })
          .from(recipeMeatMarinadesTable)
          .leftJoin(oldMarinadeIngAlias, eq(recipeMeatMarinadesTable.marinadeIngredientId, oldMarinadeIngAlias.id))
          .leftJoin(oldMarinadeSubAlias, eq(recipeMeatMarinadesTable.marinadeSubRecipeId, oldMarinadeSubAlias.id))
          .leftJoin(oldRawMeatAlias, eq(recipeMeatMarinadesTable.rawMeatIngredientId, oldRawMeatAlias.id))
          .where(eq(recipeMeatMarinadesTable.recipeId, planItem.recipeId));

        for (const mr of oldMarinadeRows) {
          if (mr.rawMeatCategory !== "raw_meat") continue;
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
      tinCount: calcTinCount(batchesTarget, planItem.maxBatchesPerTin ?? null),
      trayCount,
      ingredients,
      marinades,
      pastaKg: Math.round(pastaKg * 1000) / 1000,
    });
  }

  res.json({
    recipes: result,
    pastaCooking: { waterLPerKg: pastaWaterLPerKg, saltGPerKg: pastaSaltGPerKg },
  });
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
        packWeight: ingredientsTable.packWeight,
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
        packWeight: i.packWeight ? Number(i.packWeight) : null,
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

  // Add extra tomato base surplus from settings (applies to sub-recipe ID 2 = "Tomato Base")
  const [extraTbSetting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "extra_tomato_base_kg"));
  const extraTbKg = extraTbSetting ? Number(extraTbSetting.value) || 0 : 0;
  if (extraTbKg > 0) {
    const tbEntry = result.find(r => r.subRecipeId === 2);
    if (tbEntry) {
      tbEntry.totalRequired += extraTbKg;
    }
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
           ppi.order_position as "orderPosition",
           ppi.mixing_tin_override as "mixingTinOverride"
    FROM production_plan_items ppi
    LEFT JOIN recipes r ON ppi.recipe_id = r.id
    WHERE ppi.plan_id = ${planId}
    ORDER BY ppi.order_position
  `);
  const planItems = planItemsResult.rows as Array<{ id: number; recipeId: number; recipeName: string | null; batchesTarget: number | null; portionsPerBatch: number | null; maxBatchesPerTin: number | null; tinSize: string | null; orderPosition: number; mixingTinOverride: number | null }>;

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
    const tinsTarget = item.mixingTinOverride ?? calcTinCount(target, bpt) ?? 1;
    const isOverridden = item.mixingTinOverride != null;
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

    // Even-split: total recipe qty across all tins = qty/portion × portions/batch × target.
    // Using batchesPerTin (= ceil(target/tinsTarget)) here would over-portion when target
    // doesn't divide evenly into tinsTarget — e.g. 16 batches across 3 tins would give
    // 6 batches/tin × 3 tins = 18 batches' worth, ~12.5% too much filling.
    const evenBatchesPerTin = tinsTarget > 0 ? target / tinsTarget : target;

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
          qtyPerTin: totalQtyPerPortion * ppb * evenBatchesPerTin + overagePerTin,
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
          qtyPerTin: Number(fs.quantity) * ppb * evenBatchesPerTin + overagePerTin,
          mixingOverage: overage,
        };
      });

    return {
      itemId: item.id,
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      tinSize: item.tinSize,
      tinsTarget,
      isOverridden,
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
             ppi.batches_target as "batchesTarget", r.portions_per_batch as "portionsPerBatch",
             r.filling_assembly_order as "fillingAssemblyOrder"
      FROM production_plan_items ppi
      LEFT JOIN recipes r ON ppi.recipe_id = r.id
      WHERE ppi.plan_id = ${planId}
      ORDER BY ppi.order_position
    `);
    const planItems = planItemsResult.rows as Array<{
      id: number; recipeId: number; recipeName: string | null;
      batchesTarget: number | null; portionsPerBatch: number | null;
      fillingAssemblyOrder: number | null;
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
             ri.assembly_order as "assemblyOrder",
             ri.is_topping as "isTopping"
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
             rs.assembly_order as "assemblyOrder",
             rs.is_topping as "isTopping"
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
    const nfiRows = nonFillingIngRows.rows as Array<{ recipeId: number; ingredientId: number; ingredientName: string; unit: string; quantity: string; assemblyOrder: number | null; isTopping: boolean | null }>;
    const nfsRows = nonFillingSubRows.rows as Array<{ recipeId: number; subRecipeId: number; subRecipeName: string; unit: string; quantity: string; isBase: boolean; assemblyOrder: number | null; isTopping: boolean | null }>;

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

      type AssemblyEntry = { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number; sourceType: "ingredient" | "sub_recipe"; sourceId: number; assemblyOrder: number | null; isTopping: boolean };
      const assemblyItems: AssemblyEntry[] = [];
      const postOvenItems: AssemblyEntry[] = [];

      const isPostOven = (name: string) => /garlic[\s\-]*butter/i.test(name);

      for (const row of nfiRows.filter(r => r.recipeId === item.recipeId)) {
        const wt = toGrams(Number(row.quantity), row.unit) * ppb;
        const entry: AssemblyEntry = { name: row.ingredientName, unit: "g", weightPerBatch: wt, weightHalfBatch: wt / 2, sourceType: "ingredient", sourceId: row.ingredientId, assemblyOrder: row.assemblyOrder, isTopping: row.isTopping ?? false };
        if (isPostOven(row.ingredientName)) {
          postOvenItems.push(entry);
        } else {
          assemblyItems.push(entry);
        }
      }

      for (const row of nfsRows.filter(r => r.recipeId === item.recipeId)) {
        if (row.isBase) continue;
        const wt = toGrams(Number(row.quantity), row.unit) * ppb;
        const entry: AssemblyEntry = { name: row.subRecipeName, unit: "g", weightPerBatch: wt, weightHalfBatch: wt / 2, sourceType: "sub_recipe", sourceId: row.subRecipeId, assemblyOrder: row.assemblyOrder, isTopping: row.isTopping ?? false };
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
        fillingAssemblyOrder: item.fillingAssemblyOrder ?? 0,
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

// GET /:id/kpi?stationType=...&date=YYYY-MM-DD
// Returns server-side KPI computed from batch_completions minus station_breaks for today
// Building stations use team-level BPH: all batches from both lines, longest break per break type
// Mac cheese items are split out: calzone items contribute to batchesPerHour, mac cheese
// items contribute to macPacksPerHour (1 mac batch_completion = 1 pack).
router.get("/:id/kpi", async (req, res) => {
  const planId = Number(req.params.id);
  const stationType = String(req.query.stationType ?? "");
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;
  const isBuilding = stationType === "building_1" || stationType === "building_2";

  if (!stationType) {
    res.status(400).json({ error: "stationType is required" });
    return;
  }

  // Get plan items for this plan, joined with recipe category so we can split
  // calzone vs mac cheese completions. batchesTarget is included so we can
  // detect "all done" and freeze the KPI clock — otherwise activeMinutes
  // keeps growing after production finishes and BPH decays all evening.
  const planItems = await db.select({
    id: productionPlanItemsTable.id,
    category: recipesTable.category,
    batchesTarget: productionPlanItemsTable.batchesTarget,
  })
    .from(productionPlanItemsTable)
    .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));
  const itemIds = planItems.map(i => i.id);
  const macItemIds = new Set(planItems.filter(i => i.category === MAC_CHEESE_CATEGORY).map(i => i.id));
  const calzoneBatchesTarget = planItems
    .filter(i => i.category !== MAC_CHEESE_CATEGORY)
    .reduce((s, i) => s + (Number(i.batchesTarget) || 0), 0);
  const macPacksTarget = planItems
    .filter(i => i.category === MAC_CHEESE_CATEGORY)
    .reduce((s, i) => s + (Number(i.batchesTarget) || 0), 0);
  if (itemIds.length === 0) {
    res.json({ batchesCompleted: 0, activeMinutes: 0, breakMinutes: 0, batchesPerHour: 0, macPacksCompleted: 0, macPacksPerHour: 0 });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isBuilding) {
    // Team-level for building: all batches from both lines, all users.
    // planItemId is included so we can bucket calzone vs mac cheese.
    const completions = await db.select({
      planItemId: batchCompletionsTable.planItemId,
      completedAt: batchCompletionsTable.completedAt,
      startedAt: batchCompletionsTable.startedAt,
    })
      .from(batchCompletionsTable)
      .where(
        and(
          inArray(batchCompletionsTable.planItemId, itemIds),
          sql`${batchCompletionsTable.stationType} IN ('building_1', 'building_2')`,
          sql`completed_at >= ${today.toISOString()} AND completed_at < ${tomorrow.toISOString()}`,
        )
      );

    // All building breaks today (all users) — to find the longest per break type
    const breaksRows = await db.select({
      breakType: stationBreaksTable.breakType,
      startedAt: stationBreaksTable.startedAt,
      endedAt: stationBreaksTable.endedAt,
    })
      .from(stationBreaksTable)
      .where(
        and(
          eq(stationBreaksTable.planId, planId),
          sql`${stationBreaksTable.stationType} IN ('building_1', 'building_2')`,
          sql`started_at >= ${today.toISOString()} AND started_at < ${tomorrow.toISOString()}`,
        )
      );

    // Split by category. 1 mac cheese batch_completion row = 1 pack
    // (mac items have portionsPerBatch=2, packsPerBatch=1).
    let batchesCompleted = 0; // calzone only
    let macPacksCompleted = 0;
    for (const c of completions) {
      if (macItemIds.has(c.planItemId)) macPacksCompleted++;
      else batchesCompleted++;
    }

    // Deduct the admin-configured break durations (Settings → Break / Lunch minutes)
    // for each break type that was recorded. Keeps BPH predictable regardless of
    // how long breaks actually ran over.
    const [breakSetting] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "default_break_minutes"));
    const [lunchSetting] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "default_lunch_minutes"));
    const configuredBreakMins = breakSetting ? Number(breakSetting.value) : 15;
    const configuredLunchMins = lunchSetting ? Number(lunchSetting.value) : 45;
    const hasLunch = breaksRows.some(b => b.breakType === "lunch" && b.endedAt);
    const hasSnackBreak = breaksRows.some(b => b.breakType !== "lunch" && b.endedAt);
    const breakMinutes = (hasLunch ? configuredLunchMins : 0) + (hasSnackBreak ? configuredBreakMins : 0);

    // Shared denominator: earliest completion across both categories — same team
    // is working the line regardless of what's being built. When every planned
    // batch is done, freeze the clock at the last completion so the KPI locks
    // in and doesn't keep decaying while staff tidy up or move on.
    let activeMinutes = 0;
    if (completions.length > 0) {
      const earliest = completions.reduce((min, c) => {
        const ts = c.startedAt ?? c.completedAt;
        return ts < min ? ts : min;
      }, completions[0].startedAt ?? completions[0].completedAt);
      const latest = completions.reduce((max, c) => (
        c.completedAt > max ? c.completedAt : max
      ), completions[0].completedAt);
      const allDone = calzoneBatchesTarget + macPacksTarget > 0
        && batchesCompleted >= calzoneBatchesTarget
        && macPacksCompleted >= macPacksTarget;
      const clockCeiling = allDone ? latest.getTime() : new Date().getTime();
      const totalElapsedMinutes = (clockCeiling - earliest.getTime()) / 60000;
      activeMinutes = Math.max(0, totalElapsedMinutes - breakMinutes);
    }

    const batchesPerHour = activeMinutes > 0 ? (batchesCompleted / (activeMinutes / 60)) : 0;
    const macPacksPerHour = activeMinutes > 0 ? (macPacksCompleted / (activeMinutes / 60)) : 0;

    res.json({
      batchesCompleted,
      activeMinutes: Math.round(activeMinutes),
      breakMinutes: Math.round(breakMinutes),
      batchesPerHour: Math.round(batchesPerHour * 10) / 10,
      macPacksCompleted,
      macPacksPerHour: Math.round(macPacksPerHour * 10) / 10,
    });
    return;
  }

  // Non-building stations: per-user KPI as before
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

  let breakMinutes = 0;
  for (const b of breaksRows) {
    const end = b.endedAt ?? new Date();
    const mins = Math.max(0, (end.getTime() - b.startedAt.getTime()) / 60000);
    breakMinutes += mins;
  }

  // Per-user "all done" target = sum of batchesTarget across the plan items
  // this station owns. When the user finishes their share, freeze the clock
  // at their last completion so BPH stops decaying.
  const userStationTarget = planItems
    .filter(i => i.category !== MAC_CHEESE_CATEGORY)
    .reduce((s, i) => s + (Number(i.batchesTarget) || 0), 0);

  let activeMinutes = 0;
  if (completions.length > 0) {
    const earliest = completions.reduce((min, c) => {
      const ts = c.startedAt ?? c.completedAt;
      return ts < min ? ts : min;
    }, completions[0].startedAt ?? completions[0].completedAt);
    const latest = completions.reduce((max, c) => (
      c.completedAt > max ? c.completedAt : max
    ), completions[0].completedAt);
    const allDone = userStationTarget > 0 && batchesCompleted >= userStationTarget;
    const clockCeiling = allDone ? latest.getTime() : new Date().getTime();
    const totalElapsedMinutes = (clockCeiling - earliest.getTime()) / 60000;
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

// ──────────────────────────────────────────────────────────────────────────────
// POST /:id/items/:itemId/builder-complete — builder marks recipe complete
// early (e.g. ran out of filling). Idempotent: no-op if already set.
//
// Once set, downstream stations (ovens, wrapping) use the builder's current
// combined batch count as the effective target and pack output becomes
// `batchesComplete × packsPerBatch + extraPacksBuilt`.
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/builder-complete", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  if (item.builderMarkedCompleteAt) {
    res.json({ itemId, builderMarkedCompleteAt: item.builderMarkedCompleteAt });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ builderMarkedCompleteAt: new Date() })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt });

  res.json({ itemId, builderMarkedCompleteAt: updated.builderMarkedCompleteAt });
});

// DELETE /:id/items/:itemId/builder-complete — admin-only undo.
router.delete("/:id/items/:itemId/builder-complete", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const admin = await isAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: "Only admins can revert a recipe completion" });
    return;
  }

  const [exists] = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!exists) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  await db
    .update(productionPlanItemsTable)
    .set({ builderMarkedCompleteAt: null })
    .where(eq(productionPlanItemsTable.id, itemId));

  res.json({ itemId, builderMarkedCompleteAt: null });
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
    // HACCP fallback: if the last oven batch for this recipe is still not
    // marked chilled, stamp chill_end_at now. The wrappers have just finished
    // processing this recipe so at worst it's chilled by now. Oven/wrapping
    // operators can mark earlier for a tighter reading.
    await db.execute(sql`
      UPDATE batch_weight_records
      SET chill_end_at = NOW(),
          chilled_by_user_id = ${(req.session as { userId?: number }).userId ?? null},
          chilled_via = 'wrapping_complete_auto'
      WHERE plan_id = ${planId}
        AND recipe_id = ${item.recipeId}
        AND is_last_batch_of_recipe = TRUE
        AND chill_end_at IS NULL
    `);

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
    //
    // Kill switch: getShopifyFreezerSyncEnabled() defaults to false so the
    // upload is paused until an admin explicitly enables it from Settings.
    const shopifyDelta = Number(item.freezerQty) + wonkyFrozen;
    const shopifySyncEnabled = await getShopifyFreezerSyncEnabled();
    if (shopifyDelta > 0 && shopifySyncEnabled) {
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
// PATCH /:id/items/:itemId/leftover-filling — record leftover filling weight
// ──────────────────────────────────────────────────────────────────────────────
router.patch("/:id/items/:itemId/leftover-filling", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { grams, comment } = req.body;
  if (typeof grams !== "number" || grams < 0 || !Number.isFinite(grams)) {
    res.status(400).json({ error: "Body must contain { grams: number } (0 or positive)" });
    return;
  }
  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    res.status(400).json({ error: "comment must be a string if provided" });
    return;
  }
  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  const commentToStore = trimmedComment.length > 0 ? trimmedComment.slice(0, 500) : null;

  const [item] = await db.select({ id: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ leftoverFillingGrams: Math.round(grams), leftoverFillingComment: commentToStore })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({
      leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
      leftoverFillingComment: productionPlanItemsTable.leftoverFillingComment,
    });

  res.json({
    itemId,
    leftoverFillingGrams: updated.leftoverFillingGrams,
    leftoverFillingComment: updated.leftoverFillingComment,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /:id/items/:itemId/eight-pack-bag-count — adjust 8-pack bag allocation
// Works on any plan status (like wonky/short). Each 8-pack bag deducts 4 two-packs.
// ──────────────────────────────────────────────────────────────────────────────
router.patch("/:id/items/:itemId/eight-pack-bag-count", async (req, res) => {
  const role = req.session.userRole;
  if (role !== "admin" && role !== "manager") {
    res.status(403).json({ error: "Admin or manager role required" });
    return;
  }
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { delta } = req.body; // +1 or -1
  if (typeof delta !== "number" || (delta !== 1 && delta !== -1)) {
    res.status(400).json({ error: "Body must contain { delta: 1 | -1 }" });
    return;
  }

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    eightPackBagCount: productionPlanItemsTable.eightPackBagCount,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
  if (delta === -1 && (item.eightPackBagCount ?? 0) <= 0) {
    res.status(409).json({ error: "Eight-pack bag count is already 0" });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ eightPackBagCount: delta === 1
      ? sql`${productionPlanItemsTable.eightPackBagCount} + 1`
      : sql`GREATEST(${productionPlanItemsTable.eightPackBagCount} - 1, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ eightPackBagCount: productionPlanItemsTable.eightPackBagCount });

  res.json({ itemId, eightPackBagCount: updated.eightPackBagCount });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /:id/items/:itemId/batches-target — adjust batches target by ±1
// Used to top up an active plan without resetting prep state. Admin/manager
// only — viewers see the controls disabled until the table is unlocked.
// Floors at the existing batchesComplete so we don't shrink below work
// already recorded for this recipe.
// ──────────────────────────────────────────────────────────────────────────────
router.patch("/:id/items/:itemId/batches-target", async (req, res) => {
  const role = req.session.userRole;
  if (role !== "admin" && role !== "manager") {
    res.status(403).json({ error: "Admin or manager role required" });
    return;
  }
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { delta } = req.body;
  if (typeof delta !== "number" || (delta !== 1 && delta !== -1)) {
    res.status(400).json({ error: "Body must contain { delta: 1 | -1 }" });
    return;
  }

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    batchesTarget: productionPlanItemsTable.batchesTarget,
    batchesComplete: productionPlanItemsTable.batchesComplete,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const floor = item.batchesComplete ?? 0;
  const next = Math.max(floor, (item.batchesTarget ?? 0) + delta);
  if (next === item.batchesTarget) {
    res.status(409).json({ error: `Cannot reduce below batches already completed (${floor})` });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ batchesTarget: next })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ batchesTarget: productionPlanItemsTable.batchesTarget });

  res.json({ itemId, batchesTarget: updated.batchesTarget });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /:id/items/:itemId/fridge — add wrapped packs to fridge stock (atomic increment)
// Also upserts the master stock_entries for the production fridge so Factory Number stays in sync.
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/fridge", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  const packSize = Number(req.body.packSize) || 2;
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
    .set(packSize === 8
      ? { fridgeEightPackQty: sql`${productionPlanItemsTable.fridgeEightPackQty} + ${qty}` }
      : { fridgeQty: sql`${productionPlanItemsTable.fridgeQty} + ${qty}` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({
      fridgeQty: productionPlanItemsTable.fridgeQty,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
    });

  await syncRecipeFridgeStock(item.recipeId, qty, packSize);

  // Upsert batch-level fridge stock tracking
  const [plan] = await db.select({ batchNumber: productionPlansTable.batchNumber, planDate: productionPlansTable.planDate })
    .from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (plan?.batchNumber && plan.planDate) {
    const [recipe] = await db.select({ shelfLifeDays: recipesTable.shelfLifeDays })
      .from(recipesTable).where(eq(recipesTable.id, item.recipeId));
    const shelfDays = recipe?.shelfLifeDays ?? 14;
    const planDateObj = new Date(plan.planDate + "T00:00:00");
    const useByDate = new Date(planDateObj);
    useByDate.setDate(useByDate.getDate() + shelfDays);
    const useByStr = useByDate.toISOString().split("T")[0];

    await db.execute(sql`
      INSERT INTO fridge_stock_batches (recipe_id, batch_number, pack_size, quantity, use_by_date)
      VALUES (${item.recipeId}, ${plan.batchNumber}, ${packSize}, ${qty}, ${useByStr})
      ON CONFLICT (recipe_id, batch_number, pack_size)
      DO UPDATE SET quantity = fridge_stock_batches.quantity + ${qty}
    `);
  }

  res.json({ itemId, fridgeQty: updated.fridgeQty, fridgeEightPackQty: updated.fridgeEightPackQty });
});

// DELETE /:id/items/:itemId/fridge — undo last fridge addition (atomic decrement, floor 0)
router.delete("/:id/items/:itemId/fridge", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const qty = Number(req.body.qty);
  const packSize = Number(req.body.packSize) || 2;
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
    .set(packSize === 8
      ? { fridgeEightPackQty: sql`GREATEST(${productionPlanItemsTable.fridgeEightPackQty} - ${qty}, 0)` }
      : { fridgeQty: sql`GREATEST(${productionPlanItemsTable.fridgeQty} - ${qty}, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({
      fridgeQty: productionPlanItemsTable.fridgeQty,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
    });

  await syncRecipeFridgeStock(item.recipeId, -qty, packSize);

  // Decrement batch-level fridge stock tracking
  const [plan] = await db.select({ batchNumber: productionPlansTable.batchNumber })
    .from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (plan?.batchNumber) {
    await db.execute(sql`
      UPDATE fridge_stock_batches
      SET quantity = GREATEST(quantity - ${qty}, 0)
      WHERE recipe_id = ${item.recipeId} AND batch_number = ${plan.batchNumber} AND pack_size = ${packSize}
    `);
    // Clean up zero-quantity rows
    await db.execute(sql`
      DELETE FROM fridge_stock_batches
      WHERE recipe_id = ${item.recipeId} AND batch_number = ${plan.batchNumber} AND pack_size = ${packSize} AND quantity = 0
    `);
  }

  res.json({ itemId, fridgeQty: updated.fridgeQty, fridgeEightPackQty: updated.fridgeEightPackQty });
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

  let nextPlan: { id: number; planDate: string; doughDate?: string | null; name: string; status: string } | null = null;
  let targetPlanId = planId;

  if (!useCurrentPlan) {
    let afterDate: string;
    if (req.query.afterDate && typeof req.query.afterDate === "string") {
      afterDate = req.query.afterDate;
    } else {
      const currentPlan = await db.select({ planDate: productionPlansTable.planDate }).from(productionPlansTable).where(eq(productionPlansTable.id, planId)).limit(1);
      afterDate = currentPlan.length > 0 ? currentPlan[0].planDate : new Date().toISOString().slice(0, 10);
    }

    // Walk by COALESCE(dough_date, plan_date) so a plan whose dough is
    // explicitly scheduled on a different day surfaces on the dough station
    // for that day — and legacy rows with NULL dough_date still appear.
    const doughSortExpr = sql`COALESCE(${productionPlansTable.doughDate}, ${productionPlansTable.planDate})`;
    // >= so the plan whose dough_date equals afterDate (i.e. dough day is
    // today, when the operator is sitting on yesterday's plan view) still
    // surfaces. Mirrors the next-active resolver's prep/dough mode.
    const nextPlans = await db
      .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, doughDate: productionPlansTable.doughDate, name: productionPlansTable.name, status: productionPlansTable.status })
      .from(productionPlansTable)
      .where(and(sql`${doughSortExpr} >= ${afterDate}`, inArray(productionPlansTable.status, ["draft", "active"])))
      .orderBy(sql`${doughSortExpr} ASC`)
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

  // Scale ingredient totals UP to include extra balls.
  // ingredientTotals are currently based on recipe dough only (recipeDoughKg).
  // We need to scale by (totalDoughKg / recipeDoughKg) to include extra balls.
  const extraScaleFactor = recipeDoughKg > 0 ? totalDoughKg / recipeDoughKg : 1;

  const ingredients = Array.from(ingredientTotals.values()).map(ing => {
    const scaledQty = ing.totalQty * extraScaleFactor;
    const totalKg = ing.unit === "g" ? scaledQty / 1000 : scaledQty;
    const pctRaw = totalDoughKg > 0 ? (totalKg / totalDoughKg) * 100 : 0;
    return {
      ...ing,
      totalQty: scaledQty,
      pctOfDough: Math.round(pctRaw * 10) / 10,
      qtyPerMix: mixCount > 0 ? scaledQty / mixCount : 0,
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
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
      eightPackBagCount: productionPlanItemsTable.eightPackBagCount,
      extraPacksBuilt: productionPlanItemsTable.extraPacksBuilt,
      shortCount: productionPlanItemsTable.shortCount,
      builderMarkedCompleteAt: productionPlanItemsTable.builderMarkedCompleteAt,
      leftoverFillingGrams: productionPlanItemsTable.leftoverFillingGrams,
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
    const extraPacksBuilt = Number(item.extraPacksBuilt) || 0;
    const eightPackBagCount = Number(item.eightPackBagCount) || 0;
    // Once the builder has marked a recipe complete, the legacy shortCount is
    // historical and no longer subtracted from the reported output.
    const shortCount = item.builderMarkedCompleteAt ? 0 : (Number(item.shortCount) || 0);
    const grossPacks = Math.floor((batchesComplete * portionsPerBatch) / 2); // 2 portions per pack
    const netPacks = Math.max(0, grossPacks - (eightPackBagCount * 4) - wonlyCount - shortCount) + extraPacksBuilt;
    const itemDispatches = dispatches.filter(d => d.recipeId === item.recipeId);

    return {
      id: item.id,
      recipeId: item.recipeId,
      recipeName: item.recipeName ?? `Recipe #${item.recipeId}`,
      batchesTarget: Number(item.batchesTarget) || 0,
      batchesComplete,
      portionsPerBatch: Number(item.portionsPerBatch) || 10,
      fridgeQty: Number(item.fridgeQty) || 0,
      fridgeEightPackQty: Number(item.fridgeEightPackQty) || 0,
      eightPackBagCount,
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
      mixingTinOverride: productionPlanItemsTable.mixingTinOverride,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  if (planItems.length === 0) {
    res.json({ ingredients: [], completions: [] });
    return;
  }

  // Load prep tin overrides for this plan
  const tinOverrideRows = await db
    .select()
    .from(prepTinOverridesTable)
    .where(eq(prepTinOverridesTable.planId, planId));
  // Key: "recipeId_ingredientId" → tinCount
  const prepTinOverrideMap = new Map<string, number>();
  for (const ov of tinOverrideRows) {
    if (ov.ingredientId != null) {
      prepTinOverrideMap.set(`${ov.recipeId}_${ov.ingredientId}`, ov.tinCount);
    }
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
    stockInPacks: boolean;
    packWeight: number | null;
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
      isOverridden: boolean;
      isFillingMix: boolean;
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
      isOverridden: boolean;
      isFillingMix: boolean;
    }>;
  }>();

  // Pasta cooking ratios — synthetic rows appended at the end of the prep
  // sheet showing the cooking water + salt needed, scaled to the total kg
  // of pasta-flagged ingredients used by the plan. Defaults are sensible
  // starting points if the admin hasn't tuned them.
  const pastaSettingsRows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, ["pasta_cooking_water_l_per_kg", "pasta_cooking_salt_g_per_kg"]));
  const pastaSettingsMap = new Map(pastaSettingsRows.map(r => [r.key, r.value]));
  const pastaWaterLPerKg = Number(pastaSettingsMap.get("pasta_cooking_water_l_per_kg") ?? 6);
  const pastaSaltGPerKg = Number(pastaSettingsMap.get("pasta_cooking_salt_g_per_kg") ?? 60);
  let pastaTotalKg = 0;
  // Per-ingredient pasta kg so we can attach the synthetic water + salt
  // rows as linked sub-items under the relevant pasta ingredient (e.g.
  // Macaroni) rather than as detached rows at the bottom.
  const pastaKgByIngredient = new Map<number, number>();

  // Expanded sub-recipe ingredients: merged across all recipes sharing the sub-recipe
  const expandedIngMap = new Map<string, {
    ingredientId: number;
    ingredientName: string;
    unit: string;
    category: string | null;
    stockCheckEnabled: boolean;
    stockCheckFrequency: string;
    stockCheckDay: string | null;
    isBottle: boolean;
    bottleSize: number | null;
    stockInPacks: boolean;
    packWeight: number | null;
    totalQty: number;
    subRecipeName: string;
    // The first real recipe that drags this expanded sub-recipe component
    // into the prep sheet. Used so prep-tin completions can resolve a valid
    // (plan_item_id, recipe_id) pair — previously we sent recipeId=0 which
    // the server rejects with 400.
    parentRecipeId: number;
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
        stockInPacks: ingredientsTable.stockInPacks,
        isTopping: recipeIngredientsTable.isTopping,
        showInPrep: recipeIngredientsTable.showInPrep,
        prepCountPerPortion: ingredientsTable.prepCountPerPortion,
        isPasta: ingredientsTable.isPasta,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(and(
        eq(recipeIngredientsTable.recipeId, planItem.recipeId),
        isNull(recipeIngredientsTable.marinadeForIngredientId),
      ));

    const defaultTinCount = calcTinCount(batchesTarget, planItem.maxBatchesPerTin ?? null) ?? 1;

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

      // Determine effective tin count with overrides
      const isFillingMix = row.includeInFillingMix ?? false;
      let tinCount = defaultTinCount;
      let isOverridden = false;
      if (isFillingMix && planItem.mixingTinOverride != null) {
        // Filling mix ingredients use recipe-level mixing override
        tinCount = planItem.mixingTinOverride;
        isOverridden = true;
      } else if (!isFillingMix) {
        // Non-filling ingredients check per-ingredient override
        const overrideKey = `${planItem.recipeId}_${row.ingredientId}`;
        const override = prepTinOverrideMap.get(overrideKey);
        if (override != null) {
          tinCount = override;
          isOverridden = true;
        }
      }

      const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
      const qtyPerPortion = Number(row.quantity) || 0;
      const cookedQty = qtyPerPortion * portionsPerBatch * batchesTarget;
      const ratio = row.processingRatio ? Number(row.processingRatio) : null;
      const rawQty = ratio ? cookedQty / ratio : cookedQty;
      const originalUnit = row.unit ?? "g";
      const mode = row.prepWeightMode ?? "raw";
      const baseEffectiveQty = mode === "processed" ? cookedQty : rawQty;

      // Pasta accumulator — sum this ingredient's kg contribution whenever
      // its category is "pasta". Uses the RAW quantity (matches what
      // actually gets boiled) rather than the processed one.
      if ((row.category ?? "") === "pasta") {
        const rawKg = originalUnit === "kg" ? rawQty : originalUnit === "g" ? rawQty / 1000 : 0;
        pastaTotalKg += rawKg;
        pastaKgByIngredient.set(row.ingredientId, (pastaKgByIngredient.get(row.ingredientId) ?? 0) + rawKg);
      }

      // Prep-display override — when the ingredient has a count-per-portion,
      // render on the prep sheet as a piece count (e.g. 48 pigs & blankets)
      // with unit "pieces". The underlying quantity used for ordering,
      // stock, and cost lives elsewhere and is unaffected.
      const portionsTotal = portionsPerBatch * batchesTarget;
      const useCount = row.prepCountPerPortion != null && row.prepCountPerPortion > 0;
      const unit = useCount ? "pieces" : originalUnit;
      const effectiveQty = useCount ? portionsTotal * Number(row.prepCountPerPortion) : baseEffectiveQty;
      const roundedQty = useCount ? effectiveQty : roundByUnit(effectiveQty, unit);
      if (roundedQty <= 0) continue;
      const qtyPerTin = tinCount > 0
        ? (useCount ? Math.ceil(roundedQty / tinCount) : roundByUnit(roundedQty / tinCount, unit))
        : roundedQty;

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
          isOverridden,
          isFillingMix,
        });
      } else {
        const isBottle = row.isBottle ?? false;
        const bottleSizeVal = row.bottleSize ? Number(row.bottleSize) : (row.packWeight ? Number(row.packWeight) : null);
        const packWeightVal = row.packWeight != null ? Number(row.packWeight) : null;
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
          stockInPacks: (row.stockInPacks ?? false) && packWeightVal != null && packWeightVal > 0,
          packWeight: packWeightVal,
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
            isOverridden,
            isFillingMix,
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
          subRecipeYield: subRecipesTable.yield,
          isBase: subRecipesTable.isBase,
          expandInPrep: subRecipesTable.expandInPrep,
          isTopping: recipeSubRecipesTable.isTopping,
          showInPrep: recipeSubRecipesTable.showInPrep,
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
        if (sr.includeInFillingMix && !sr.showInPrep) continue;

        // Determine effective tin count with overrides for sub-recipes
        const srIsFillingMix = sr.includeInFillingMix ?? false;
        let srTinCount = defaultTinCount;
        let srIsOverridden = false;
        if (srIsFillingMix && planItem.mixingTinOverride != null) {
          srTinCount = planItem.mixingTinOverride;
          srIsOverridden = true;
        }

        const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
        const qtyPerPortion = Number(sr.quantity) || 0;
        const totalQty = qtyPerPortion * portionsPerBatch * batchesTarget;
        const unit = sr.yieldUnit ?? "kg";
        const roundedQty = roundByUnit(totalQty, unit);
        if (roundedQty <= 0) continue;

        // If expandInPrep is enabled, break down into individual ingredients.
        // All recipes sharing the same expanded sub-recipe get their quantities
        // merged into a single combined entry per ingredient (one prep task, not per-recipe).
        if (sr.expandInPrep) {
          const srYield = Number(sr.subRecipeYield) || 1;
          const scaleFactor = roundedQty / srYield;

          const componentRows = await db
            .select({
              ingredientId: subRecipeIngredientsTable.ingredientId,
              ingredientName: ingredientsTable.name,
              unit: ingredientsTable.unit,
              category: ingredientsTable.category,
              quantity: subRecipeIngredientsTable.quantity,
              processingRatio: ingredientsTable.processingRatio,
              stockCheckEnabled: ingredientsTable.stockCheckEnabled,
              stockCheckFrequency: ingredientsTable.stockCheckFrequency,
              isBottle: ingredientsTable.isBottle,
              bottleSize: ingredientsTable.bottleSize,
              stockInPacks: ingredientsTable.stockInPacks,
              packWeight: ingredientsTable.packWeight,
              hideFromPrep: subRecipeIngredientsTable.hideFromPrep,
              prepCountPerPortion: ingredientsTable.prepCountPerPortion,
              isPasta: ingredientsTable.isPasta,
            })
            .from(subRecipeIngredientsTable)
            .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
            .where(eq(subRecipeIngredientsTable.subRecipeId, sr.subRecipeId));

          for (const comp of componentRows) {
            if (comp.ingredientId == null) continue;
            // Hidden components stay in the sub-recipe data (so ratio maths
            // still scale correctly) but don't appear on the prep sheet.
            if (comp.hideFromPrep) continue;
            const compQty = Number(comp.quantity) || 0;
            const compUnit = comp.unit ?? "g";
            const rawScaled = compQty * scaleFactor;
            if (rawScaled <= 0) continue;
            // Pasta coming in via a sub-recipe expansion (e.g. macaroni
            // inside a cheese-sauce sub-recipe) counts toward the synthetic
            // cooking-water / salt rows too.
            if ((comp.category ?? "") === "pasta") {
              const kg = compUnit === "kg" ? rawScaled : compUnit === "g" ? rawScaled / 1000 : 0;
              pastaTotalKg += kg;
              pastaKgByIngredient.set(comp.ingredientId, (pastaKgByIngredient.get(comp.ingredientId) ?? 0) + kg);
            }
            // Use higher-precision rounding for kg/l so small amounts (e.g. a
            // pinch of dried parsley scaled through a sub-recipe) don't round
            // to zero and vanish. Grams/ml already stay as whole numbers.
            const scaledQty = (compUnit === "kg" || compUnit === "l")
              ? Math.round(rawScaled * 1000) / 1000
              : roundByUnit(rawScaled, compUnit);
            if (scaledQty <= 0) continue;

            // Use a special key so expanded sub-recipe ingredients merge together
            // across recipes, but don't merge with direct recipe ingredients
            const expandKey = `expand_${sr.subRecipeId}_${comp.ingredientId}`;
            const existing = expandedIngMap.get(expandKey);
            if (existing) {
              existing.totalQty += scaledQty;
            } else {
              const compPackWeight = comp.packWeight != null ? Number(comp.packWeight) : null;
              expandedIngMap.set(expandKey, {
                ingredientId: comp.ingredientId,
                ingredientName: comp.ingredientName ?? `Ingredient #${comp.ingredientId}`,
                unit: compUnit,
                category: comp.category ?? null,
                stockCheckEnabled: comp.stockCheckEnabled ?? false,
                stockCheckFrequency: comp.stockCheckFrequency ?? "daily",
                stockCheckDay: null as string | null,
                totalQty: scaledQty,
                isBottle: comp.isBottle ?? false,
                bottleSize: comp.bottleSize != null ? Number(comp.bottleSize) : null,
                stockInPacks: (comp.stockInPacks ?? false) && compPackWeight != null && compPackWeight > 0,
                packWeight: compPackWeight,
                subRecipeName: sr.subRecipeName ?? `Sub-recipe #${sr.subRecipeId}`,
                parentRecipeId: planItem.recipeId!,
              });
            }
          }

          // When the parent sub-recipe is expandInPrep, its NESTED sub-recipe
          // components (e.g. mac cheese seasoning inside the macaroni cheese
          // sub-recipe) still need to appear as prep tasks. We add them as
          // sub-recipe prep items — the team prepares them as their own
          // batch-of-seasoning, not ingredient-by-ingredient.
          const nestedRows = await db
            .select({
              componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
              quantity: subRecipeSubRecipesTable.quantity,
              componentName: subRecipesTable.name,
              componentYieldUnit: subRecipesTable.yieldUnit,
            })
            .from(subRecipeSubRecipesTable)
            .leftJoin(subRecipesTable, eq(subRecipeSubRecipesTable.componentSubRecipeId, subRecipesTable.id))
            .where(eq(subRecipeSubRecipesTable.subRecipeId, sr.subRecipeId));

          for (const nested of nestedRows) {
            if (nested.componentSubRecipeId == null) continue;
            const nestedQtyPerParent = Number(nested.quantity) || 0;
            const nestedTotalQty = nestedQtyPerParent * scaleFactor;
            const nestedUnit = nested.componentYieldUnit ?? "kg";
            const nestedRounded = (nestedUnit === "kg" || nestedUnit === "l")
              ? Math.round(nestedTotalQty * 1000) / 1000
              : roundByUnit(nestedTotalQty, nestedUnit);
            if (nestedRounded <= 0) continue;
            const nestedTinCount = srTinCount;
            const nestedQtyPerTin = nestedTinCount > 0
              ? roundByUnit(nestedRounded / nestedTinCount, nestedUnit)
              : nestedRounded;
            // Nested sub-recipes inside an expand-in-prep parent are one
            // shared batch — collapse across parent recipes into a single
            // combined entry labelled with the sub-recipe's own name. Tin
            // count defaults to 1 (one big batch); the operator can bump it
            // via the per-tin edit control if they want to split.
            const nestedKey = `sr_${nested.componentSubRecipeId}`;
            const nestedName = nested.componentName ?? `Sub-recipe #${nested.componentSubRecipeId}`;
            const existing = subRecipeMap.get(nestedKey);
            if (existing && existing.recipes.length > 0) {
              existing.totalQty += nestedRounded;
              const combined = existing.recipes[0];
              combined.qtyForRecipe += nestedRounded;
              combined.qtyPerTin = combined.tinCount > 0
                ? ((nestedUnit === "kg" || nestedUnit === "l")
                    ? Math.round((combined.qtyForRecipe / combined.tinCount) * 1000) / 1000
                    : roundByUnit(combined.qtyForRecipe / combined.tinCount, nestedUnit))
                : combined.qtyForRecipe;
            } else {
              subRecipeMap.set(nestedKey, {
                subRecipeId: nested.componentSubRecipeId,
                ingredientName: nestedName,
                unit: nestedUnit,
                totalQty: nestedRounded,
                recipes: [{
                  recipeId: planItem.recipeId!,
                  recipeName: nestedName,
                  batchesTarget: 0,
                  qtyForRecipe: nestedRounded,
                  tinSize: null,
                  maxBatchesPerTin: null,
                  tinCount: 1,
                  qtyPerTin: nestedRounded,
                  isOverridden: false,
                  isFillingMix: false,
                }],
              });
            }
          }

          continue; // skip adding to subRecipeMap
        }

        const qtyPerTin = srTinCount > 0 ? roundByUnit(roundedQty / srTinCount, unit) : roundedQty;

        // Sub-recipes used by multiple parent recipes get one entry per
        // parent recipe (same shape as direct ingredients), so e.g. Garlic
        // Butter used by both Garlic Cheese and Garlic Korma calzones shows
        // a separate prep line for each recipe with its own batches target.
        // The totalTinCount derived downstream sums across recipes, so the
        // header quantity still reflects the combined weighing.
        const srName = sr.subRecipeName ?? `Sub-recipe #${sr.subRecipeId}`;
        const mapKey = `sr_${sr.subRecipeId}`;
        const existing = subRecipeMap.get(mapKey);
        const recipeEntry = {
          recipeId: planItem.recipeId!,
          recipeName: planItem.recipeName ?? srName,
          batchesTarget,
          qtyForRecipe: roundedQty,
          tinSize: planItem.tinSize ?? null,
          maxBatchesPerTin: planItem.maxBatchesPerTin ?? null,
          tinCount: srTinCount,
          qtyPerTin,
          isOverridden: srIsOverridden,
          isFillingMix: srIsFillingMix,
        };
        if (existing) {
          existing.totalQty += roundedQty;
          existing.recipes.push(recipeEntry);
        } else {
          subRecipeMap.set(mapKey, {
            subRecipeId: sr.subRecipeId,
            ingredientName: srName,
            unit,
            totalQty: roundedQty,
            recipes: [recipeEntry],
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

  // Merge expanded sub-recipe ingredients into ingredientMap as single combined entries
  for (const [, exp] of expandedIngMap) {
    const existing = ingredientMap.get(exp.ingredientId);
    if (existing) {
      // Ingredient already exists from a direct recipe link — add expanded qty
      existing.totalQty += exp.totalQty;
      existing.recipes.push({
        recipeId: exp.parentRecipeId,
        recipeName: exp.subRecipeName,
        batchesTarget: 0,
        qtyForRecipe: exp.totalQty,
        tinSize: null,
        maxBatchesPerTin: null,
        tinCount: 1,
        qtyPerTin: exp.totalQty,
        isOverridden: false,
        isFillingMix: false,
      });
    } else {
      // Strip parentRecipeId from the spread — private marker, not response.
      const { parentRecipeId: _pRid, ...expRest } = exp;
      void _pRid;
      ingredientMap.set(exp.ingredientId, {
        ...expRest,
        recipes: [{
          recipeId: exp.parentRecipeId,
          recipeName: exp.subRecipeName,
          batchesTarget: 0,
          qtyForRecipe: exp.totalQty,
          tinSize: null,
          maxBatchesPerTin: null,
          tinCount: 1,
          qtyPerTin: exp.totalQty,
          isOverridden: false,
          isFillingMix: false,
        }],
      });
    }
  }

  // Ingredients that always get 1 tin per recipe (no splitting within a recipe)
  const SINGLE_TIN_PER_RECIPE_IDS = new Set([18, 19, 202]); // Basil, Basil puree, Garlic Butter
  for (const [ingId, ing] of ingredientMap) {
    if (!SINGLE_TIN_PER_RECIPE_IDS.has(ingId)) continue;
    for (const r of ing.recipes) {
      r.tinCount = 1;
      r.qtyPerTin = roundByUnit(r.qtyForRecipe, ing.unit);
    }
  }

  // Same rule for sub-recipes — when Garlic Butter (or Basil/Basil Puree) is
  // pulled in as a sub-recipe rather than a direct ingredient, the loop above
  // misses it because subRecipeIngredients is keyed by sub-recipe id, not
  // ingredient id. Match by name (case-insensitive) so it stays a single
  // weighing per parent recipe regardless of how it was wired up.
  const SINGLE_TIN_PER_RECIPE_SUB_RECIPE_NAMES = new Set(["garlic butter", "basil", "basil puree"]);
  for (const sr of subRecipeIngredients) {
    if (!SINGLE_TIN_PER_RECIPE_SUB_RECIPE_NAMES.has(sr.ingredientName.toLowerCase())) continue;
    for (const r of sr.recipes) {
      r.tinCount = 1;
      r.qtyPerTin = roundByUnit(r.qtyForRecipe, sr.unit);
    }
    sr.totalTinCount = sr.recipes.reduce((s, r) => s + r.tinCount, 0);
  }

  const FIXED_TWO_TIN_IDS = new Set<number>();
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

  // ── Linked ingredients: fetch items where marinadeForIngredientId points to
  // a parent ingredient that appears in this station's ingredient list.
  // These are displayed as sub-rows under the parent ingredient, with per-recipe
  // tin breakdowns matching the parent's tin structure.
  type LinkedItemDetail = {
    ingredientName: string;
    unit: string;
    totalQty: number;
    recipes: Array<{
      recipeId: number;
      recipeName: string;
      qtyForRecipe: number;
      tinCount: number;
      qtyPerTin: number;
    }>;
  };
  const linkedItemsMap: Record<number, LinkedItemDetail[]> = {};
  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const linkedRows = await db
      .select({
        ingredientId: recipeIngredientsTable.ingredientId,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        quantity: recipeIngredientsTable.quantity,
        marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(and(
        eq(recipeIngredientsTable.recipeId, planItem.recipeId),
        isNotNull(recipeIngredientsTable.marinadeForIngredientId),
      ));

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const tinCount = calcTinCount(batchesTarget, planItem.maxBatchesPerTin ?? null) ?? 1;

    for (const lr of linkedRows) {
      const parentId = lr.marinadeForIngredientId!;
      if (!ingredientMap.has(parentId)) continue;
      const qtyPerPortion = Number(lr.quantity) || 0;
      const totalQty = qtyPerPortion * portionsPerBatch * batchesTarget;
      const unit = lr.unit ?? "g";
      const roundedQty = roundByUnit(totalQty, unit);
      if (roundedQty <= 0) continue;
      const qtyPerTin = tinCount > 0 ? roundByUnit(roundedQty / tinCount, unit) : roundedQty;

      if (!linkedItemsMap[parentId]) linkedItemsMap[parentId] = [];
      const ingName = lr.ingredientName ?? `Ingredient #${lr.ingredientId}`;
      const existing = linkedItemsMap[parentId].find(x => x.ingredientName === ingName);
      if (existing) {
        existing.totalQty += roundedQty;
        existing.recipes.push({
          recipeId: planItem.recipeId!,
          recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
          qtyForRecipe: roundedQty,
          tinCount,
          qtyPerTin,
        });
      } else {
        linkedItemsMap[parentId].push({
          ingredientName: ingName,
          unit,
          totalQty: roundedQty,
          recipes: [{
            recipeId: planItem.recipeId!,
            recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
            qtyForRecipe: roundedQty,
            tinCount,
            qtyPerTin,
          }],
        });
      }
    }
  }

  // Pasta cooking water + salt — attached as linked sub-rows under each
  // pasta-category ingredient (e.g. Macaroni) on the main-prep station so
  // the prep team sees the cooking requirements grouped with the pasta
  // they're going to boil. Rates come from app settings.
  if (station === "main_prep") {
    for (const [ingId, kg] of pastaKgByIngredient) {
      if (kg <= 0) continue;
      if (!ingredientMap.has(ingId)) continue;
      const kgRounded = Math.round(kg * 1000) / 1000;
      const waterL = Math.round(kg * pastaWaterLPerKg * 100) / 100;
      const saltG = Math.round(kg * pastaSaltGPerKg);
      if (!linkedItemsMap[ingId]) linkedItemsMap[ingId] = [];
      linkedItemsMap[ingId].push({
        ingredientName: `Cooking water (for ${kgRounded} kg)`,
        unit: "L",
        totalQty: waterL,
        recipes: [],
      });
      linkedItemsMap[ingId].push({
        ingredientName: `Salt for pasta water (for ${kgRounded} kg)`,
        unit: "g",
        totalQty: saltG,
        recipes: [],
      });
    }
  }

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

  res.json({ ingredients: allItems, completions, linkedItems: linkedItemsMap });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /:id/prep-tin-override — set or clear a tin count override for prep
// ──────────────────────────────────────────────────────────────────────────────
router.put("/:id/prep-tin-override", async (req, res) => {
  const planId = Number(req.params.id);
  const { recipeId, ingredientId, isFillingMix, tinCount } = req.body as {
    recipeId: number;
    ingredientId: number | null;
    isFillingMix: boolean;
    tinCount: number | null;
  };

  if (!recipeId) { res.status(400).json({ error: "recipeId is required" }); return; }
  if (tinCount !== null && (typeof tinCount !== "number" || tinCount < 1 || !Number.isInteger(tinCount))) {
    res.status(400).json({ error: "tinCount must be a positive integer or null" });
    return;
  }

  console.log(`[prep-tin-override] planId=${planId} recipeId=${recipeId} ingredientId=${ingredientId} isFillingMix=${isFillingMix} tinCount=${tinCount}`);

  try {
    if (isFillingMix) {
      // Filling mix override → set mixing_tin_override on the plan item
      console.log(`[prep-tin-override] Setting mixing_tin_override=${tinCount} for planId=${planId} recipeId=${recipeId}`);
      const [item] = await db
        .update(productionPlanItemsTable)
        .set({ mixingTinOverride: tinCount })
        .where(and(
          eq(productionPlanItemsTable.planId, planId),
          eq(productionPlanItemsTable.recipeId, recipeId),
        ))
        .returning({ id: productionPlanItemsTable.id, mixingTinOverride: productionPlanItemsTable.mixingTinOverride });

      if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }
      res.json({ ok: true, tinCount: item.mixingTinOverride });
    } else {
      // Non-filling override → upsert into prep_tin_overrides
      if (!ingredientId) { res.status(400).json({ error: "ingredientId is required for non-filling overrides" }); return; }

      if (tinCount === null) {
        await db.delete(prepTinOverridesTable).where(and(
          eq(prepTinOverridesTable.planId, planId),
          eq(prepTinOverridesTable.recipeId, recipeId),
          eq(prepTinOverridesTable.ingredientId, ingredientId),
        ));
        res.json({ ok: true, tinCount: null });
      } else {
        await db.execute(sql`
          INSERT INTO prep_tin_overrides (plan_id, recipe_id, ingredient_id, tin_count)
          VALUES (${planId}, ${recipeId}, ${ingredientId}, ${tinCount})
          ON CONFLICT (plan_id, recipe_id, ingredient_id)
          DO UPDATE SET tin_count = ${tinCount}
        `);
        res.json({ ok: true, tinCount });
      }
    }
  } catch (err) {
    console.error("prep-tin-override error:", err);
    res.status(500).json({ error: "Failed to set tin override" });
  }
});

router.post("/:id/prep-completions", async (req, res) => {
  const planId = Number(req.params.id);
  const { ingredientId, recipeId, tinNumber, isSubRecipe } = req.body;
  if (!recipeId) { res.status(400).json({ error: "recipeId is required" }); return; }
  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
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
  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
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
  if (await planDraftStatus(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
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

// GET /:id/prep-progress — tin-based prep completion summary for plan overview.
// Counts how many tins across all main-prep ingredients have been ticked off
// vs the total number of tins required.
router.get("/:id/prep-progress", async (req, res) => {
  const planId = Number(req.params.id);
  try {
    const planItems = await db
      .select({
        recipeId: productionPlanItemsTable.recipeId,
        batchesTarget: productionPlanItemsTable.batchesTarget,
        maxBatchesPerTin: productionPlanItemsTable.maxBatchesPerTin,
        mixingTinOverride: productionPlanItemsTable.mixingTinOverride,
      })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, planId));

    const overrides = await db.select().from(prepTinOverridesTable).where(eq(prepTinOverridesTable.planId, planId));
    const overrideMap = new Map<string, number>();
    for (const ov of overrides) {
      if (ov.ingredientId != null) overrideMap.set(`${ov.recipeId}_${ov.ingredientId}`, ov.tinCount);
    }

    // Build the set of (recipeId, ingredientId) pairs that appear on main prep,
    // applying the same filters main-prep uses so the progress bar matches the
    // tins the kitchen actually sees on the station page.
    const tinMap = new Map<string, number>(); // key -> tinCount
    let totalTins = 0;

    for (const item of planItems) {
      const bt = Number(item.batchesTarget) || 0;
      if (!item.recipeId || bt === 0) continue;
      const defaultTinCount = calcTinCount(bt, item.maxBatchesPerTin ?? null) ?? 1;

      const rows = await db.execute(sql`
        SELECT ri.ingredient_id, ri.include_in_filling_mix, ri.is_topping,
               i.name AS ingredient_name, i.category
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON ri.ingredient_id = i.id
        WHERE ri.recipe_id = ${item.recipeId}
          AND ri.marinade_for_ingredient_id IS NULL
      `);

      for (const row of rows.rows as any[]) {
        if (row.is_topping) continue;
        const cat = row.category ?? "";
        if (["raw_meat", "base", "sauce", "dough"].includes(cat)) continue;
        const nameLc = (row.ingredient_name ?? "").toLowerCase();
        const isMozz = nameLc.includes("mozzarella") || nameLc.includes("fior di latte");
        if (isMozz && !row.include_in_filling_mix) continue;

        const isFillingMix = row.include_in_filling_mix ?? false;
        let tinCount = defaultTinCount;
        if (isFillingMix && item.mixingTinOverride != null) {
          tinCount = item.mixingTinOverride;
        } else if (!isFillingMix) {
          const ov = overrideMap.get(`${item.recipeId}_${row.ingredient_id}`);
          if (ov != null) tinCount = ov;
        }
        if (tinCount <= 0) continue;

        const key = `${row.ingredient_id}_${item.recipeId}`;
        // Same (recipe, ingredient) pair can appear in multiple filling-mix lookups;
        // take the first tinCount we compute and move on.
        if (!tinMap.has(key)) {
          tinMap.set(key, tinCount);
          totalTins += tinCount;
        }
      }
    }

    // Count ticked-off tins, ignoring stale completions that point at a tin
    // number beyond the current tinCount (e.g. after an override shrank it).
    const completionRows = await db.execute(sql`
      SELECT ingredient_id, recipe_id, tin_number FROM prep_completions WHERE plan_id = ${planId}
    `);
    let completedTins = 0;
    for (const c of completionRows.rows as any[]) {
      const key = `${c.ingredient_id}_${c.recipe_id}`;
      const tinCount = tinMap.get(key);
      if (tinCount != null && c.tin_number >= 1 && c.tin_number <= tinCount) {
        completedTins += 1;
      }
    }

    const pct = totalTins > 0 ? Math.round((Math.min(completedTins, totalTins) / totalTins) * 100) : 0;
    res.json({ totalTins, completedTins, pct });
  } catch (err) {
    console.error("prep-progress error:", err);
    res.status(500).json({ error: "Failed to calculate prep progress" });
  }
});

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
          shortCount: 0,
          extraPacksBuilt: 0,
          eightPackBagCount: 0,
          wrappingComplete: false,
          fridgeQty: 0,
          fridgeEightPackQty: 0,
          freezerQty: 0,
          prepFridgeQty: 0,
          status: "pending",
        })
        .where(eq(productionPlanItemsTable.planId, planId));

      await tx.update(productionPlansTable)
        .set({ status: "draft" })
        .where(eq(productionPlansTable.id, planId));

      // Clear building station checklist lock states (keyed by plan+item ID)
      await tx.delete(appSettingsTable)
        .where(sql`${appSettingsTable.key} LIKE ${"checklist_done_" + planId + "_%"}`);

      // Clear building station assignments
      await tx.delete(appSettingsTable)
        .where(sql`${appSettingsTable.key} LIKE ${"station_assignment_" + planId + "_%"}`);
    });

    res.json({ message: "Production plan has been reset to draft with all progress cleared." });
  } catch (err) {
    console.error("[reset] Error:", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "Reset failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
