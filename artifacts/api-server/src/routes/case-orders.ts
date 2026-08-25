// Case orders — bulk frozen 8-pack-bag orders (e.g. Waterdean: 100 cases,
// 2,400 portions) produced across several days on top of normal production.
//
// The whole feature is arithmetic-first: required bags per recipe fall out of
// (cases × bags-per-case), progress is a SUM over an append-only ledger of
// freezer-bag counts from the wrapping station, and the schedule suggestion
// spreads what's left over the days before the target collection date without
// starving the online 2-pack demand.
//
// Capacity model (confirmed 2026-07-28):
//   - 110 batches/day with a "Dough Prep" person on the Planday rota, 80
//     without. Read live from Planday positions when configured; when Planday
//     is unreachable or the position is unknown the day falls back to the
//     SAFE ceiling (80) — under-promising beats scheduling production that
//     can't happen.
//   - recipes.max_batches_per_day (e.g. BBQ pulled pork: 30) warns and allows
//     override, never hard-blocks.
//
// A bag is 8 portions; a batch is recipes.portions_per_batch (10). Bags never
// come from fridge 8-pack stock — they're a separate classification, frozen
// for the customer, counted into the walk-in product freezer at wrapping.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  caseTypesTable,
  caseTypeLinesTable,
  caseOrdersTable,
  caseOrderLinesTable,
  caseOrderProductionTable,
  productionPlansTable,
  productionPlanItemsTable,
  recipesTable,
  suppliersTable,
  usersTable,
  appSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc, sql } from "drizzle-orm";
import * as z from "zod";
import { londonDateString } from "../lib/london-time";
import { earliestProductionDay } from "../lib/production-cutoff";
import { datesWithPosition } from "../services/planday";

const router: IRouter = Router();

const PORTIONS_PER_BAG = 8;

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

async function sessionUser(req: Request) {
  const userId = req.session?.userId ?? null;
  if (!userId) return { id: null as number | null, name: null as string | null };
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return { id: userId, name: u?.name ?? null };
}

// ── Case types ─────────────────────────────────────────────────────────────

router.get("/case-types", async (_req: Request, res: Response) => {
  const types = await db.select().from(caseTypesTable).orderBy(asc(caseTypesTable.name));
  const lines = await db
    .select({
      id: caseTypeLinesTable.id,
      caseTypeId: caseTypeLinesTable.caseTypeId,
      recipeId: caseTypeLinesTable.recipeId,
      bagsPerCase: caseTypeLinesTable.bagsPerCase,
      recipeName: recipesTable.name,
    })
    .from(caseTypeLinesTable)
    .leftJoin(recipesTable, eq(caseTypeLinesTable.recipeId, recipesTable.id));
  res.json(types.map(t => ({
    ...t,
    lines: lines.filter(l => l.caseTypeId === t.id),
    bagsPerCaseTotal: lines.filter(l => l.caseTypeId === t.id).reduce((s, l) => s + l.bagsPerCase, 0),
  })));
});

const CaseTypeInput = z.object({
  name: z.string().trim().min(1).max(120),
  lines: z.array(z.object({
    recipeId: z.number().int(),
    bagsPerCase: z.number().int().min(1).max(50),
  })).min(1, "A case needs at least one recipe"),
});

router.post("/case-types", async (req: Request, res: Response) => {
  const parsed = CaseTypeInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", issues: parsed.error.issues }); return; }
  const [created] = await db.insert(caseTypesTable).values({ name: parsed.data.name }).returning();
  await db.insert(caseTypeLinesTable).values(
    parsed.data.lines.map(l => ({ caseTypeId: created.id, recipeId: l.recipeId, bagsPerCase: l.bagsPerCase })),
  );
  res.json(created);
});

router.patch("/case-types/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = CaseTypeInput.extend({ active: z.boolean().optional() }).partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", issues: parsed.error.issues }); return; }
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (Object.keys(patch).length > 0) {
    await db.update(caseTypesTable).set(patch).where(eq(caseTypesTable.id, id));
  }
  if (parsed.data.lines) {
    await db.delete(caseTypeLinesTable).where(eq(caseTypeLinesTable.caseTypeId, id));
    await db.insert(caseTypeLinesTable).values(
      parsed.data.lines.map(l => ({ caseTypeId: id, recipeId: l.recipeId, bagsPerCase: l.bagsPerCase })),
    );
  }
  res.json({ ok: true });
});

// ── Recipe daily limits (max_batches_per_day) ──────────────────────────────
// Surfaced here rather than on the giant recipes form: it's a scheduling
// concern and this page is where scheduling lives.

router.get("/recipe-limits", async (_req: Request, res: Response) => {
  const rows = await db
    .select({ id: recipesTable.id, name: recipesTable.name, maxBatchesPerDay: recipesTable.maxBatchesPerDay })
    .from(recipesTable)
    .orderBy(asc(recipesTable.name));
  res.json(rows);
});

router.put("/recipe-limits/:recipeId", async (req: Request, res: Response) => {
  const recipeId = Number(req.params.recipeId);
  if (!Number.isFinite(recipeId)) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const parsed = z.object({ maxBatchesPerDay: z.number().int().min(1).max(500).nullable() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", issues: parsed.error.issues }); return; }
  const [updated] = await db
    .update(recipesTable)
    .set({ maxBatchesPerDay: parsed.data.maxBatchesPerDay })
    .where(eq(recipesTable.id, recipeId))
    .returning({ id: recipesTable.id, maxBatchesPerDay: recipesTable.maxBatchesPerDay });
  if (!updated) { res.status(404).json({ error: "Recipe not found" }); return; }
  res.json(updated);
});

// ── Orders ─────────────────────────────────────────────────────────────────

/** required / made / remaining per recipe, derived not counted. */
async function computeProgress(orderId: number) {
  const lines = await db
    .select({
      caseTypeId: caseOrderLinesTable.caseTypeId,
      casesOrdered: caseOrderLinesTable.casesOrdered,
      caseTypeName: caseTypesTable.name,
    })
    .from(caseOrderLinesTable)
    .leftJoin(caseTypesTable, eq(caseOrderLinesTable.caseTypeId, caseTypesTable.id))
    .where(eq(caseOrderLinesTable.caseOrderId, orderId));

  const typeIds = lines.map(l => l.caseTypeId);
  const typeLines = typeIds.length
    ? await db
        .select({
          caseTypeId: caseTypeLinesTable.caseTypeId,
          recipeId: caseTypeLinesTable.recipeId,
          bagsPerCase: caseTypeLinesTable.bagsPerCase,
          recipeName: recipesTable.name,
          portionsPerBatch: recipesTable.portionsPerBatch,
          maxBatchesPerDay: recipesTable.maxBatchesPerDay,
        })
        .from(caseTypeLinesTable)
        .leftJoin(recipesTable, eq(caseTypeLinesTable.recipeId, recipesTable.id))
        .where(inArray(caseTypeLinesTable.caseTypeId, typeIds))
    : [];

  const requiredByRecipe = new Map<number, { recipeName: string | null; portionsPerBatch: number; maxBatchesPerDay: number | null; bags: number }>();
  for (const ol of lines) {
    for (const tl of typeLines.filter(t => t.caseTypeId === ol.caseTypeId)) {
      const entry = requiredByRecipe.get(tl.recipeId) ?? {
        recipeName: tl.recipeName,
        portionsPerBatch: tl.portionsPerBatch ?? 10,
        maxBatchesPerDay: tl.maxBatchesPerDay ?? null,
        bags: 0,
      };
      entry.bags += ol.casesOrdered * tl.bagsPerCase;
      requiredByRecipe.set(tl.recipeId, entry);
    }
  }

  const made = await db
    .select({
      recipeId: caseOrderProductionTable.recipeId,
      bags: sql<number>`COALESCE(SUM(${caseOrderProductionTable.bags}), 0)::int`,
    })
    .from(caseOrderProductionTable)
    .where(eq(caseOrderProductionTable.caseOrderId, orderId))
    .groupBy(caseOrderProductionTable.recipeId);
  const madeByRecipe = new Map(made.map(m => [m.recipeId, m.bags]));

  const recipes = Array.from(requiredByRecipe.entries()).map(([recipeId, r]) => {
    const bagsMade = madeByRecipe.get(recipeId) ?? 0;
    return {
      recipeId,
      recipeName: r.recipeName,
      portionsPerBatch: r.portionsPerBatch,
      maxBatchesPerDay: r.maxBatchesPerDay,
      bagsRequired: r.bags,
      bagsMade,
      bagsRemaining: Math.max(0, r.bags - bagsMade),
      portionsRequired: r.bags * PORTIONS_PER_BAG,
    };
  }).sort((a, b) => (a.recipeName ?? "").localeCompare(b.recipeName ?? ""));

  return {
    caseLines: lines,
    recipes,
    totals: {
      cases: lines.reduce((s, l) => s + l.casesOrdered, 0),
      bagsRequired: recipes.reduce((s, r) => s + r.bagsRequired, 0),
      bagsMade: recipes.reduce((s, r) => s + r.bagsMade, 0),
      bagsRemaining: recipes.reduce((s, r) => s + r.bagsRemaining, 0),
      portionsRequired: recipes.reduce((s, r) => s + r.portionsRequired, 0),
    },
  };
}

router.get("/", async (_req: Request, res: Response) => {
  const orders = await db
    .select({ o: caseOrdersTable, supplierName: suppliersTable.name })
    .from(caseOrdersTable)
    .leftJoin(suppliersTable, eq(caseOrdersTable.supplierId, suppliersTable.id))
    .orderBy(desc(caseOrdersTable.targetCollectionDate));
  const result = [];
  for (const row of orders) {
    const progress = await computeProgress(row.o.id);
    result.push({ ...row.o, supplierName: row.supplierName, ...progress });
  }
  res.json(result);
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await db
    .select({ o: caseOrdersTable, supplierName: suppliersTable.name })
    .from(caseOrdersTable)
    .leftJoin(suppliersTable, eq(caseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(caseOrdersTable.id, id));
  if (!row) { res.status(404).json({ error: "Case order not found" }); return; }
  const progress = await computeProgress(id);
  const ledger = await db
    .select()
    .from(caseOrderProductionTable)
    .where(eq(caseOrderProductionTable.caseOrderId, id))
    .orderBy(desc(caseOrderProductionTable.createdAt));
  res.json({ ...row.o, supplierName: row.supplierName, ...progress, ledger });
});

const CreateCaseOrder = z.object({
  supplierId: z.number().int(),
  reference: z.string().trim().max(200).optional(),
  targetCollectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({
    caseTypeId: z.number().int(),
    casesOrdered: z.number().int().min(1).max(10000),
  })).min(1, "A case order needs at least one case line"),
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = CreateCaseOrder.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const user = await sessionUser(req);
  const [created] = await db.insert(caseOrdersTable).values({
    supplierId: d.supplierId,
    reference: d.reference || null,
    targetCollectionDate: d.targetCollectionDate,
    notes: d.notes || null,
    createdByUserId: user.id,
  }).returning();
  await db.insert(caseOrderLinesTable).values(
    d.lines.map(l => ({ caseOrderId: created.id, caseTypeId: l.caseTypeId, casesOrdered: l.casesOrdered })),
  );
  res.json(created);
});

router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = CreateCaseOrder.partial().extend({
    status: z.enum(["open", "complete", "cancelled"]).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", issues: parsed.error.issues }); return; }
  const d = parsed.data;
  const patch: Record<string, unknown> = {};
  if (d.reference !== undefined) patch.reference = d.reference || null;
  if (d.targetCollectionDate !== undefined) patch.targetCollectionDate = d.targetCollectionDate;
  if (d.notes !== undefined) patch.notes = d.notes || null;
  if (d.status !== undefined) patch.status = d.status;
  if (Object.keys(patch).length > 0) {
    await db.update(caseOrdersTable).set(patch).where(eq(caseOrdersTable.id, id));
  }
  if (d.lines) {
    await db.delete(caseOrderLinesTable).where(eq(caseOrderLinesTable.caseOrderId, id));
    await db.insert(caseOrderLinesTable).values(
      d.lines.map(l => ({ caseOrderId: id, caseTypeId: l.caseTypeId, casesOrdered: l.casesOrdered })),
    );
  }
  res.json({ ok: true });
});

// ── Capacity for a date range ──────────────────────────────────────────────

async function resolveCapacity(from: string, to: string): Promise<{
  withDough: number;
  withoutDough: number;
  doughDates: Set<string> | null;
}> {
  const withDough = Number(await getSetting("capacity_batches_with_dough_prep")) || 110;
  const withoutDough = Number(await getSetting("capacity_batches_without_dough_prep")) || 80;
  const positionName = (await getSetting("capacity_dough_prep_position_name")) || "Dough Prep";
  let doughDates: Set<string> | null = null;
  try {
    doughDates = await datesWithPosition(positionName, from, to);
  } catch (err) {
    // Planday flaking must degrade to the safe ceiling, not fail the request.
    console.warn("[case-orders] Planday capacity lookup failed:", err instanceof Error ? err.message : err);
  }
  return { withDough, withoutDough, doughDates };
}

// ── Schedule suggestion ────────────────────────────────────────────────────
// For each production day from the earliest allowed day (today before the
// 07:00 cutoff, else tomorrow) to the day before collection: how many
// bags of each recipe to make, given existing planned batches, the daily
// ceiling, and per-recipe limits. Even spread with clamping — remaining work
// rolls forward to later days; whatever can't fit anywhere is reported as an
// explicit shortfall, never silently dropped.
router.get("/:id/schedule-suggestion", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(caseOrdersTable).where(eq(caseOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Case order not found" }); return; }

  const progress = await computeProgress(id);

  // Production days: earliest allowed day .. target-1. Collection day itself is
  // excluded — the bags must already be frozen when the driver arrives. Today
  // only counts before the 07:00 London cutoff (Graeme, 2026-08-25): after
  // that the day's plan is already running, so the spread starts tomorrow.
  const startDay = earliestProductionDay();
  const days: string[] = [];
  for (let d = new Date(`${startDay}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    if (ds >= order.targetCollectionDate) break;
    days.push(ds);
    if (days.length > 60) break; // sanity cap
  }
  if (days.length === 0) {
    res.json({ days: [], shortfall: progress.recipes.filter(r => r.bagsRemaining > 0), message: "No production days left before the collection date." });
    return;
  }

  const capacity = await resolveCapacity(days[0], days[days.length - 1]);

  // Existing plans + per-recipe batches already planned on each day.
  const plans = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate })
    .from(productionPlansTable)
    .where(inArray(productionPlansTable.planDate, days));
  const planByDate = new Map(plans.map(p => [p.planDate, p.id]));
  const items = plans.length
    ? await db
        .select({
          planId: productionPlanItemsTable.planId,
          recipeId: productionPlanItemsTable.recipeId,
          batchesTarget: productionPlanItemsTable.batchesTarget,
        })
        .from(productionPlanItemsTable)
        .where(inArray(productionPlanItemsTable.planId, plans.map(p => p.id)))
    : [];
  const planDateById = new Map(plans.map(p => [p.id, p.planDate]));

  const existingBatchesByDate = new Map<string, number>();
  const existingRecipeBatches = new Map<string, number>(); // `${date}|${recipeId}`
  for (const it of items) {
    const date = planDateById.get(it.planId)!;
    existingBatchesByDate.set(date, (existingBatchesByDate.get(date) ?? 0) + it.batchesTarget);
    const k = `${date}|${it.recipeId}`;
    existingRecipeBatches.set(k, (existingRecipeBatches.get(k) ?? 0) + it.batchesTarget);
  }

  // Mutable remaining state per recipe.
  const remaining = new Map(progress.recipes.map(r => [r.recipeId, r.bagsRemaining]));

  const dayRows = days.map((date, dayIndex) => {
    const doughPrep = capacity.doughDates ? capacity.doughDates.has(date) : null;
    // Unknown rota (null) → the SAFE ceiling.
    const ceiling = doughPrep ? capacity.withDough : capacity.withoutDough;
    const existing = existingBatchesByDate.get(date) ?? 0;
    let headroomBatches = Math.max(0, ceiling - existing);
    const daysLeft = days.length - dayIndex;

    const suggestions: Array<{
      recipeId: number; recipeName: string | null; bags: number;
      batchEquivalent: number; warnings: string[];
    }> = [];

    for (const r of progress.recipes) {
      const left = remaining.get(r.recipeId) ?? 0;
      if (left <= 0) continue;
      // Even spread of what's left across the remaining days.
      let bags = Math.ceil(left / daysLeft);
      const warnings: string[] = [];

      const batchesFor = (b: number) => Math.ceil((b * PORTIONS_PER_BAG) / (r.portionsPerBatch || 10));

      // Per-recipe daily ceiling (existing planned batches count against it).
      if (r.maxBatchesPerDay != null) {
        const already = existingRecipeBatches.get(`${date}|${r.recipeId}`) ?? 0;
        const recipeHeadroom = Math.max(0, r.maxBatchesPerDay - already);
        const maxBags = Math.floor((recipeHeadroom * (r.portionsPerBatch || 10)) / PORTIONS_PER_BAG);
        if (bags > maxBags) {
          bags = maxBags;
          warnings.push(`Capped by ${r.recipeName}'s ${r.maxBatchesPerDay}-batch daily limit (${already} already planned).`);
        }
      }

      // Day ceiling.
      if (batchesFor(bags) > headroomBatches) {
        bags = Math.floor((headroomBatches * (r.portionsPerBatch || 10)) / PORTIONS_PER_BAG);
        warnings.push("Capped by the day's total batch capacity.");
      }
      if (bags <= 0) continue;

      const batchEquivalent = batchesFor(bags);
      headroomBatches -= batchEquivalent;
      remaining.set(r.recipeId, left - bags);
      suggestions.push({ recipeId: r.recipeId, recipeName: r.recipeName, bags, batchEquivalent, warnings });
    }

    return {
      date,
      doughPrep, // true | false | null (rota unknown)
      capacity: ceiling,
      existingBatches: existing,
      headroomAfter: headroomBatches,
      planId: planByDate.get(date) ?? null,
      suggestions,
    };
  });

  const shortfall = progress.recipes
    .map(r => ({ ...r, bagsUnplaced: remaining.get(r.recipeId) ?? 0 }))
    .filter(r => r.bagsUnplaced > 0);

  res.json({
    orderId: id,
    targetCollectionDate: order.targetCollectionDate,
    plandayAvailable: capacity.doughDates != null,
    days: dayRows,
    shortfall,
  });
});

// ── Apply one day's allocation onto the plan ───────────────────────────────
// Follows the wholesale-bags rule: NEVER add a recipe to a plan. If the
// recipe isn't on that day's plan the allocation is skipped with a reason and
// the planner adds it through normal planning first.
const ApplyDay = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allocations: z.array(z.object({
    recipeId: z.number().int(),
    bags: z.number().int().min(1),
  })).min(1),
  // Also bump batchesTarget by the batch-equivalent. Default true: case bags
  // are on TOP of DPT-driven 2-pack demand, so the batches don't exist yet.
  addBatches: z.boolean().default(true),
});

router.post("/:id/apply-day", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [order] = await db.select().from(caseOrdersTable).where(eq(caseOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Case order not found" }); return; }
  const parsed = ApplyDay.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data", issues: parsed.error.issues }); return; }
  const { date, allocations, addBatches } = parsed.data;

  const [plan] = await db
    .select({ id: productionPlansTable.id })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.planDate, date));
  if (!plan) {
    res.status(422).json({ error: `No production plan exists for ${date}. Create the plan first, then apply.` });
    return;
  }

  const items = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      caseOrderId: productionPlanItemsTable.caseOrderId,
    })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, plan.id));
  const recipeRows = await db
    .select({ id: recipesTable.id, name: recipesTable.name, portionsPerBatch: recipesTable.portionsPerBatch })
    .from(recipesTable)
    .where(inArray(recipesTable.id, allocations.map(a => a.recipeId)));
  const recipeById = new Map(recipeRows.map(r => [r.id, r]));

  const applied: Array<{ recipeId: number; bags: number; batchesAdded: number }> = [];
  const skipped: Array<{ recipeId: number; reason: string }> = [];

  for (const a of allocations) {
    const item = items.find(i => i.recipeId === a.recipeId);
    const recipe = recipeById.get(a.recipeId);
    if (!item) {
      skipped.push({ recipeId: a.recipeId, reason: `${recipe?.name ?? `Recipe ${a.recipeId}`} is not on the ${date} plan — add it there first.` });
      continue;
    }
    if (item.caseOrderId != null && item.caseOrderId !== id) {
      skipped.push({ recipeId: a.recipeId, reason: `${recipe?.name ?? `Recipe ${a.recipeId}`} on ${date} is already carrying freezer bags for case order #${item.caseOrderId}.` });
      continue;
    }
    const batchesAdded = addBatches
      ? Math.ceil((a.bags * PORTIONS_PER_BAG) / (recipe?.portionsPerBatch || 10))
      : 0;
    await db.update(productionPlanItemsTable).set({
      eightPackBagCount: sql`${productionPlanItemsTable.eightPackBagCount} + ${a.bags}`,
      freezerEightPackBagCount: sql`${productionPlanItemsTable.freezerEightPackBagCount} + ${a.bags}`,
      caseOrderId: id,
      ...(batchesAdded > 0 ? { batchesTarget: sql`${productionPlanItemsTable.batchesTarget} + ${batchesAdded}` } : {}),
    }).where(eq(productionPlanItemsTable.id, item.id));
    applied.push({ recipeId: a.recipeId, bags: a.bags, batchesAdded });
  }

  res.json({ ok: true, planId: plan.id, applied, skipped });
});

// ── Wrapping station: count freezer bags in/out ────────────────────────────
// Bumps the plan item's freezer progress AND writes the case-order ledger row
// in one call, so "in the freezer for this order" can never drift from what
// wrapping actually recorded. delta may be negative (a correction).
router.post("/plan-items/:itemId/freezer-bags", async (req: Request, res: Response) => {
  const itemId = Number(req.params.itemId);
  const parsed = z.object({ delta: z.number().int().min(-50).max(50).refine(d => d !== 0) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "delta (non-zero integer) required" }); return; }
  const { delta } = parsed.data;

  const [item] = await db
    .select({
      id: productionPlanItemsTable.id,
      planId: productionPlanItemsTable.planId,
      recipeId: productionPlanItemsTable.recipeId,
      caseOrderId: productionPlanItemsTable.caseOrderId,
      freezerEightPackQty: productionPlanItemsTable.freezerEightPackQty,
      freezerEightPackBagCount: productionPlanItemsTable.freezerEightPackBagCount,
    })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.id, itemId));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const next = item.freezerEightPackQty + delta;
  if (next < 0) { res.status(400).json({ error: "Freezer bag count can't go below zero." }); return; }

  const [updated] = await db.update(productionPlanItemsTable)
    .set({ freezerEightPackQty: next })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ freezerEightPackQty: productionPlanItemsTable.freezerEightPackQty });

  if (item.caseOrderId != null) {
    const [plan] = await db
      .select({ planDate: productionPlansTable.planDate })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.id, item.planId));
    const user = await sessionUser(req);
    await db.insert(caseOrderProductionTable).values({
      caseOrderId: item.caseOrderId,
      recipeId: item.recipeId,
      planId: item.planId,
      productionDate: plan?.planDate ?? londonDateString(),
      bags: delta,
      countedByUserId: user.id,
      countedByName: user.name,
    });
  }

  res.json({ ok: true, freezerEightPackQty: updated.freezerEightPackQty, caseOrderId: item.caseOrderId });
});

export default router;
