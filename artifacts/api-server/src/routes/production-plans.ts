import { Router, type IRouter } from "express";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable, batchCompletionsTable, stationBreaksTable, recipeIngredientsTable, ingredientsTable, recipeSubRecipesTable, subRecipesTable, subRecipeIngredientsTable, dispatchOrdersTable, appSettingsTable } from "@workspace/db";
import { eq, and, desc, sql, gt, asc, inArray } from "drizzle-orm";
import { validate } from "../middleware/validate";
import * as z from "zod";

const router: IRouter = Router();

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

function mapItem(i: typeof productionPlanItemsTable.$inferSelect & { recipeName?: string | null; portionsPerBatch?: number | null; fillWeightGrams?: string | null; baseType?: string | null; baseWeightGrams?: string | null }) {
  return {
    ...i,
    recipeName: i.recipeName ?? "",
    portionsPerBatch: i.portionsPerBatch ?? 10,
    fillWeightGrams: i.fillWeightGrams ? Number(i.fillWeightGrams) : null,
    baseType: i.baseType ?? null,
    baseWeightGrams: i.baseWeightGrams ? Number(i.baseWeightGrams) : null,
  };
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
    await db.insert(productionPlanItemsTable).values(
      items.map((i: { recipeId: number; batchesTarget?: number; orderPosition?: number; tinSize?: string | null; maxBatchesPerTin?: number | null; sopUrl?: string | null; notes?: string | null }) => ({
        planId: plan.id,
        recipeId: i.recipeId,
        batchesTarget: i.batchesTarget ?? 0,
        orderPosition: i.orderPosition ?? 0,
        tinSize: i.tinSize ?? null,
        maxBatchesPerTin: i.maxBatchesPerTin ?? null,
        sopUrl: i.sopUrl ?? null,
        notes: i.notes ?? null,
        status: "pending",
      }))
    );
  }
  res.status(201).json(mapPlan(plan));
});

// GET /production-plans/next-active — returns the next Mon–Fri that has an active production plan.
// Searches from tomorrow up to 7 calendar days ahead (exclusive today).
// Only matches plans with status = 'active'.
// Used by prep stations to show "Prep for [Day], [Date]" banners.
router.get("/next-active", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Search from tomorrow up to 7 calendar days ahead for an active plan on a weekday
  const candidates: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      // Format as YYYY-MM-DD
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      candidates.push(`${yyyy}-${mm}-${dd}`);
    }
  }

  if (candidates.length === 0) {
    res.json({ planId: null, planDate: null, planName: null });
    return;
  }

  const plans = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, name: productionPlansTable.name, status: productionPlansTable.status })
    .from(productionPlansTable)
    .where(and(
      inArray(productionPlansTable.planDate, candidates),
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
      tinSize: productionPlanItemsTable.tinSize,
      maxBatchesPerTin: productionPlanItemsTable.maxBatchesPerTin,
      sopUrl: productionPlanItemsTable.sopUrl,
      fillWeightGrams: recipesTable.fillWeightGrams,
      baseType: recipesTable.baseType,
      baseWeightGrams: recipesTable.baseWeightGrams,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, id))
    .orderBy(productionPlanItemsTable.orderPosition);

  res.json({ ...mapPlan(plan), items: items.map(mapItem) });
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
          tinSize: i.tinSize ?? null,
          maxBatchesPerTin: i.maxBatchesPerTin ?? null,
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

  // Cap check before transaction (fast fail)
  const target = planItem.batchesTarget ?? 0;
  if (target > 0 && (planItem.batchesComplete ?? 0) >= target) {
    res.status(409).json({ error: "Batch target already met" });
    return;
  }

  // Atomic: lock the item row, increment only if still below target, then insert completion
  // Using a single CTE transaction so increment and insert are either both committed or both rolled back
  const completedAtDate = completedAt ? new Date(completedAt) : new Date();
  const startedAtDate = startedAt ? new Date(startedAt) : null;

  const result = await db.execute(sql`
    WITH incremented AS (
      UPDATE production_plan_items
      SET
        batches_complete = batches_complete + 1,
        status = CASE
          WHEN batches_complete + 1 >= batches_target THEN 'complete'
          ELSE 'in-progress'
        END
      WHERE id = ${Number(planItemId)}
        AND (batches_target = 0 OR batches_complete < batches_target)
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
  if ((planItem.batchesComplete ?? 0) === 0) {
    res.status(409).json({ error: "No completions to undo" });
    return;
  }

  // Build ownership filter: non-admins can only undo their own completions
  const conditions = [eq(batchCompletionsTable.planItemId, Number(planItemId))];
  if (stationType) conditions.push(eq(batchCompletionsTable.stationType, stationType));
  if (!isAdmin && sessionUserId) conditions.push(eq(batchCompletionsTable.userId, sessionUserId));

  // Atomic CTE: find the most recent matching completion, delete it, and ONLY THEN decrement the counter.
  // If no matching row is found the DELETE returns 0 rows, so the UPDATE is skipped entirely,
  // ensuring batches_complete is never decremented without a corresponding deletion.
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
      batches_complete = GREATEST(batches_complete - 1, 0),
      status = CASE
        WHEN GREATEST(batches_complete - 1, 0) = 0 THEN 'pending'
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
    .where(sql`plan_item_id = ANY(${itemIds})`)
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
      sql`plan_item_id = ANY(${itemIds})`,
      eq(batchCompletionsTable.stationType, String(stationType))
    ));

  const countByItem: Record<number, number> = {};
  for (const c of completions) {
    countByItem[c.planItemId] = (countByItem[c.planItemId] ?? 0) + 1;
  }

  res.json(items.map(i => ({ planItemId: i.id, batchesComplete: countByItem[i.id] ?? 0 })));
});

// Station breaks sub-routes

// GET active (open) break for current user + station — used by BreakTracker to hydrate on mount/refresh
router.get("/:id/station-breaks/active", async (req, res) => {
  const planId = Number(req.params.id);
  const { stationType } = req.query;
  const sessionUserId = (req.session as { userId?: number }).userId ?? null;

  const conditions = [eq(stationBreaksTable.planId, planId), sql`ended_at IS NULL`];
  if (stationType) conditions.push(sql`station_type = ${String(stationType)}`);
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

  // Enforce single-open-break per user+station: if one already exists, return it instead of creating a duplicate
  const conditions = [eq(stationBreaksTable.planId, planId), sql`ended_at IS NULL`];
  if (stationType) conditions.push(sql`station_type = ${String(stationType)}`);
  if (sessionUserId) conditions.push(eq(stationBreaksTable.userId, sessionUserId));
  const [existing] = await db.select().from(stationBreaksTable)
    .where(and(...conditions))
    .orderBy(desc(stationBreaksTable.startedAt))
    .limit(1);

  if (existing) {
    // Return existing open break — idempotent, client can resume
    res.status(200).json({ ...existing, startedAt: existing.startedAt.toISOString(), endedAt: null });
    return;
  }

  const [row] = await db.insert(stationBreaksTable).values({
    planId,
    stationType,
    userId: sessionUserId,
    breakType: breakType ?? "morning",
    startedAt: startedAt ? new Date(startedAt) : new Date(),
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

  const [updated] = await db.update(stationBreaksTable)
    .set({ endedAt: endedAt ? new Date(endedAt) : new Date() })
    .where(eq(stationBreaksTable.id, breakId))
    .returning();

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

  const recipeIds = planItems.map(p => p.recipeId).filter(Boolean) as number[];

  const allIngredientRows: {
    recipeId: number;
    ingredientId: number;
    quantityPerBatch: string;
    ingredientName: string | null;
    unit: string | null;
    category: string | null;
    processingRatio: string | null;
    rawMeatTrayCapacityKg: string | null;
  }[] = [];

  for (const rid of recipeIds) {
    const rows = await db
      .select({
        recipeId: recipeIngredientsTable.recipeId,
        ingredientId: recipeIngredientsTable.ingredientId,
        quantityPerBatch: recipeIngredientsTable.quantity,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        category: ingredientsTable.category,
        processingRatio: ingredientsTable.processingRatio,
        rawMeatTrayCapacityKg: ingredientsTable.rawMeatTrayCapacityKg,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, rid));
    allIngredientRows.push(...rows);
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
    const itemIngredients = allIngredientRows.filter(i => i.recipeId === planItem.recipeId);

    for (const ing of itemIngredients) {
      if (!ing.ingredientId) continue;
      const iid = ing.ingredientId;
      const qtyPerBatch = Number(ing.quantityPerBatch) || 0;
      const totalCookedQty = qtyPerBatch * batchesTarget;
      const processingRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const totalRawQty = processingRatio ? totalCookedQty / processingRatio : totalCookedQty;

      if (!aggregated[iid]) {
        aggregated[iid] = {
          ingredientId: iid,
          ingredientName: ing.ingredientName ?? `Ingredient #${iid}`,
          unit: ing.unit ?? "g",
          category: ing.category ?? null,
          processingRatio,
          rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg ? Number(ing.rawMeatTrayCapacityKg) : null,
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
      const totalRawKg = item.totalRawQty / 1000;
      item.trayCount = Math.ceil(totalRawKg / item.rawMeatTrayCapacityKg);
    }
  }

  let items = Object.values(aggregated);
  if (station === "prep_meat") {
    items = items.filter(i => i.category === "raw_meat" || i.rawMeatTrayCapacityKg != null);
  } else if (station === "prep_veg") {
    items = items.filter(i => i.category === "vegetable");
  } else if (station === "prep_bases") {
    items = items.filter(i => ["base", "sauce", "cheese"].includes(i.category ?? ""));
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
// Returns per-recipe per-ingredient breakdown for prep stations.
// Each recipe entry includes: recipeId, recipeName, batchesTarget, sopUrl, tinSize, maxBatchesPerTin
// and an ingredients array with per-ingredient cooked/raw qty, category, processingRatio, trayCapacity.
// The Raw Meat view uses this to compute combined (raw_meat+seasoning) tray counts per recipe.
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

  const recipeIds = planItems.map(p => p.recipeId).filter(Boolean) as number[];

  // Fetch all ingredient rows for all recipes
  const allIngredientRows: {
    recipeId: number;
    ingredientId: number;
    quantityPerBatch: string;
    ingredientName: string | null;
    unit: string | null;
    category: string | null;
    processingRatio: string | null;
    rawMeatTrayCapacityKg: string | null;
  }[] = [];

  for (const rid of recipeIds) {
    const rows = await db
      .select({
        recipeId: recipeIngredientsTable.recipeId,
        ingredientId: recipeIngredientsTable.ingredientId,
        quantityPerBatch: recipeIngredientsTable.quantity,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        category: ingredientsTable.category,
        processingRatio: ingredientsTable.processingRatio,
        rawMeatTrayCapacityKg: ingredientsTable.rawMeatTrayCapacityKg,
      })
      .from(recipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, rid));
    allIngredientRows.push(...rows);
  }

  // Station category filters
  const categoryMatchesStation = (category: string | null): boolean => {
    if (station === "prep_meat") return category === "raw_meat";
    if (station === "prep_veg") return category === "vegetable";
    if (station === "prep_bases") return ["base", "sauce", "cheese"].includes(category ?? "");
    return true; // "all"
  };

  // "Seasoning" for raw meat station: dry ingredients in same recipe that are NOT raw_meat
  // (but are relevant to the recipe weight for tray calculation)
  const isSeasoningForMeat = (category: string | null): boolean => {
    return station === "prep_meat" && !["raw_meat", "vegetable", "base", "sauce", "cheese"].includes(category ?? "") && category != null;
  };

  const result = [];
  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    const itemIngredients = allIngredientRows.filter(i => i.recipeId === planItem.recipeId);

    const ingredients: Array<{
      ingredientId: number;
      ingredientName: string;
      unit: string;
      category: string | null;
      processingRatio: number | null;
      rawMeatTrayCapacityKg: number | null;
      cookedQty: number;
      rawQty: number;
      isRawMeat: boolean;
      isSeasoning: boolean;
    }> = [];

    let hasRelevantIngredients = false;

    for (const ing of itemIngredients) {
      if (!ing.ingredientId) continue;
      const category = ing.category ?? null;
      const isMainStation = categoryMatchesStation(category);
      const isSeasoning = isSeasoningForMeat(category);

      // For raw_meat station: include raw_meat ingredients + seasonings used in same recipe
      if (station === "prep_meat") {
        if (!isMainStation && !isSeasoning) continue;
      } else {
        if (!isMainStation) continue;
      }

      hasRelevantIngredients = true;
      const qtyPerBatch = Number(ing.quantityPerBatch) || 0;
      const cookedQty = qtyPerBatch * batchesTarget;
      const processingRatio = ing.processingRatio ? Number(ing.processingRatio) : null;
      const rawQty = processingRatio ? cookedQty / processingRatio : cookedQty;

      ingredients.push({
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName ?? `Ingredient #${ing.ingredientId}`,
        unit: ing.unit ?? "g",
        category,
        processingRatio,
        rawMeatTrayCapacityKg: ing.rawMeatTrayCapacityKg ? Number(ing.rawMeatTrayCapacityKg) : null,
        cookedQty,
        rawQty,
        isRawMeat: category === "raw_meat",
        isSeasoning: isSeasoning && category !== "raw_meat",
      });
    }

    // Skip recipes with no relevant ingredients
    if (!hasRelevantIngredients) continue;

    // For raw meat station: compute combined tray count (raw meat + seasoning)
    let trayCount: number | null = null;
    if (station === "prep_meat") {
      const rawMeatIngredients = ingredients.filter(i => i.isRawMeat);
      // Use the tray capacity from the first raw_meat ingredient (they should all be the same)
      const trayCapacityKg = rawMeatIngredients.find(i => i.rawMeatTrayCapacityKg)?.rawMeatTrayCapacityKg ?? null;
      if (trayCapacityKg) {
        const totalRawMeatKg = rawMeatIngredients.reduce((sum, i) => sum + i.rawQty, 0) / 1000;
        const totalSeasoningKg = ingredients.filter(i => i.isSeasoning).reduce((sum, i) => sum + i.rawQty, 0) / 1000;
        const totalCombinedKg = totalRawMeatKg + totalSeasoningKg;
        trayCount = Math.ceil(totalCombinedKg / trayCapacityKg);
      }
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
    });
  }

  res.json({ recipes: result });
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
    .where(sql`plan_item_id = ANY(${itemIds})`);

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
        sql`plan_item_id = ANY(${itemIds})`,
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
            sql`plan_item_id = ANY(${itemIds})`,
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
// POST /:id/items/:itemId/wonly — increment wonlyCount by 1 (quality reject)
// ──────────────────────────────────────────────────────────────────────────────
router.post("/:id/items/:itemId/wonly", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    wonlyCount: productionPlanItemsTable.wonlyCount,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ wonlyCount: (item.wonlyCount ?? 0) + 1 })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning();

  res.json({ itemId, wonlyCount: updated.wonlyCount });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /:id/items/:itemId/wonly — undo last Wonly (decrement if > 0)
// ──────────────────────────────────────────────────────────────────────────────
router.delete("/:id/items/:itemId/wonly", async (req, res) => {
  const planId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const [item] = await db.select({
    id: productionPlanItemsTable.id,
    wonlyCount: productionPlanItemsTable.wonlyCount,
  })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));

  if (!item) {
    res.status(404).json({ error: "Plan item not found" });
    return;
  }
  if ((item.wonlyCount ?? 0) <= 0) {
    res.status(409).json({ error: "Wonly count is already 0" });
    return;
  }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ wonlyCount: (item.wonlyCount ?? 1) - 1 })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning();

  res.json({ itemId, wonlyCount: updated.wonlyCount });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /:id/dough-prep — computes dough requirements for the plan
// Returns: total dough per ingredient, mixing schedule, per-recipe ball weights
// ──────────────────────────────────────────────────────────────────────────────
router.get("/:id/dough-prep", async (req, res) => {
  const planId = Number(req.params.id);

  // Get the plan items with recipe info
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
    .where(eq(productionPlanItemsTable.planId, planId))
    .orderBy(productionPlanItemsTable.orderPosition);

  if (planItems.length === 0) {
    res.json({ ingredients: [], recipes: [], totalDoughKg: 0, mixerCapacityKg: 25, mixCount: 0 });
    return;
  }

  // Get mixer capacity from app settings
  const [mixerSetting] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "mixer_capacity_kg"));
  const mixerCapacityKg = mixerSetting ? Number(mixerSetting.value) : 25;

  // For each recipe, find linked dough sub-recipes
  // recipeSubRecipesTable.quantity = number of sub-recipe batches per recipe batch
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

  // Find dough sub-recipes (any sub-recipe with "dough" in the name)
  const doughSubRecipeIds = [...new Set(
    subRecipeLinks
      .filter(l => l.subRecipeName?.toLowerCase().includes("dough"))
      .map(l => l.subRecipeId)
  )];

  if (doughSubRecipeIds.length === 0) {
    res.json({ ingredients: [], recipes: [], totalDoughKg: 0, mixerCapacityKg, mixCount: 0 });
    return;
  }

  // Fetch ingredients for all dough sub-recipes
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

  // Per-recipe dough info
  interface RecipeDoughInfo {
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    orderPosition: number;
    doughBatchesNeeded: number;
    doughKgTotal: number;
    ballWeightG: number;
    doughSubRecipeName: string;
    subRecipeYieldKg: number;
  }

  const recipeResults: RecipeDoughInfo[] = [];

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;

    // Find dough sub-recipe link for this recipe
    const doughLink = subRecipeLinks.find(
      l => l.recipeId === planItem.recipeId && doughSubRecipeIds.includes(l.subRecipeId)
    );
    if (!doughLink) continue;

    // quantityPerBatch = number of sub-recipe batches per recipe batch
    const quantityPerBatch = Number(doughLink.quantityPerBatch) || 0;
    const subRecipeYieldKg = Number(doughLink.subRecipeYield) || 0;

    // Total dough batches needed for this recipe
    const doughBatchesNeeded = quantityPerBatch * batchesTarget;
    // Total dough kg from this recipe
    const doughKgTotal = doughBatchesNeeded * subRecipeYieldKg;
    // Ball weight = (dough kg per recipe batch) / portionsPerBatch
    const doughKgPerRecipeBatch = quantityPerBatch * subRecipeYieldKg;
    const ballWeightG = portionsPerBatch > 0 ? Math.round((doughKgPerRecipeBatch / portionsPerBatch) * 1000) : 0;

    recipeResults.push({
      recipeId: planItem.recipeId!,
      recipeName: planItem.recipeName ?? `Recipe #${planItem.recipeId}`,
      batchesTarget,
      portionsPerBatch,
      orderPosition: planItem.orderPosition,
      doughBatchesNeeded,
      doughKgTotal,
      ballWeightG,
      doughSubRecipeName: doughLink.subRecipeName ?? "Dough",
      subRecipeYieldKg,
    });
  }

  // Aggregate ingredient totals across all recipes
  // Total dough batches (in sub-recipe batches) = sum of doughBatchesNeeded per recipe
  const totalDoughSubRecipeBatches = recipeResults.reduce((sum, r) => sum + r.doughBatchesNeeded, 0);
  const totalDoughKg = recipeResults.reduce((sum, r) => sum + r.doughKgTotal, 0);

  // Aggregate ingredient quantities: quantity from sub-recipe × total dough batches
  // (Use first found dough sub-recipe ID — they should all be the same for a calzone kitchen)
  const primaryDoughSubRecipeId = doughSubRecipeIds[0];
  const primaryIngredients = doughIngredientRows.filter(r => r.subRecipeId === primaryDoughSubRecipeId);

  const ingredients = primaryIngredients.map(ing => {
    const qtyPerBatch = Number(ing.quantity) || 0;
    const totalQty = qtyPerBatch * totalDoughSubRecipeBatches;
    return {
      ingredientId: ing.ingredientId,
      ingredientName: ing.ingredientName ?? `Ingredient #${ing.ingredientId}`,
      unit: ing.unit ?? "kg",
      qtyPerBatch,
      totalQty,
    };
  });

  // Mixing schedule
  const mixCount = mixerCapacityKg > 0 ? Math.ceil(totalDoughKg / mixerCapacityKg) : 0;
  const kgPerMix = mixCount > 0 ? (totalDoughKg / mixCount) : 0;

  // Per-mix ingredient quantities
  const mixIngredients = ingredients.map(ing => ({
    ...ing,
    qtyPerMix: mixCount > 0 ? ing.totalQty / mixCount : 0,
  }));

  res.json({
    totalDoughKg: Math.round(totalDoughKg * 100) / 100,
    mixerCapacityKg,
    mixCount,
    kgPerMix: Math.round(kgPerMix * 100) / 100,
    ingredients: mixIngredients,
    recipes: recipeResults,
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
      wonlyCount,
      grossPacks,
      netPacks,
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

  res.json({
    planId,
    planDate: plan.planDate,
    items: packItems,
    totalNetPacks: packItems.reduce((sum, p) => sum + p.netPacks, 0),
    totalGrossPacks: packItems.reduce((sum, p) => sum + p.grossPacks, 0),
    totalWonly: packItems.reduce((sum, p) => sum + p.wonlyCount, 0),
  });
});

export default router;
